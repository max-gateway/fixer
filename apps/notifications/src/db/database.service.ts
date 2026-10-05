import { readdir, readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Inject, Injectable, Logger, OnApplicationShutdown, OnModuleInit } from '@nestjs/common';
import { Pool, type PoolClient, type QueryResultRow } from 'pg';
import { CONFIG, type AppConfig } from '../config/config.js';

const SCHEMA = 'notifications';
/** Serializa as migrações quando várias réplicas sobem juntas (rolling deploy). */
const MIGRATION_LOCK_KEY = 7_201_002;
const MIGRATIONS_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'migrations');

/** Pool Postgres + migrador. Tudo vive no schema "notifications": nada se mistura com as tabelas da API. */
@Injectable()
export class Database implements OnModuleInit, OnApplicationShutdown {
  private readonly logger = new Logger(Database.name);
  readonly pool: Pool;

  constructor(@Inject(CONFIG) cfg: AppConfig) {
    this.pool = new Pool({
      connectionString: cfg.databaseUrl,
      options: `-c search_path=${SCHEMA}`,
      max: 10,
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 10_000,
      statement_timeout: 15_000,
    });
    this.pool.on('error', (err) => this.logger.error(`Conexão ociosa do pool falhou: ${err.message}`));
  }

  async onModuleInit(): Promise<void> {
    await this.migrate();
  }

  async onApplicationShutdown(): Promise<void> {
    await this.pool.end();
  }

  query<R extends QueryResultRow = QueryResultRow>(sql: string, params: unknown[] = []) {
    return this.pool.query<R>(sql, params);
  }

  /** BEGIN/COMMIT com ROLLBACK em qualquer exceção. */
  async tx<T>(fn: (c: PoolClient) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const out = await fn(client);
      await client.query('COMMIT');
      return out;
    } catch (err) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw err;
    } finally {
      client.release();
    }
  }

  private async migrate(): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query('SELECT pg_advisory_lock($1)', [MIGRATION_LOCK_KEY]);
      await client.query(`CREATE SCHEMA IF NOT EXISTS ${SCHEMA}`);
      await client.query(
        `CREATE TABLE IF NOT EXISTS ${SCHEMA}.schema_migrations (version TEXT PRIMARY KEY, applied_at TIMESTAMPTZ NOT NULL DEFAULT now())`,
      );
      const applied = new Set(
        (await client.query<{ version: string }>(`SELECT version FROM ${SCHEMA}.schema_migrations`)).rows.map((r) => r.version),
      );
      const files = (await readdir(MIGRATIONS_DIR)).filter((f) => f.endsWith('.sql')).sort();
      for (const file of files) {
        if (applied.has(file)) continue;
        const sql = await readFile(join(MIGRATIONS_DIR, file), 'utf8');
        await client.query('BEGIN');
        try {
          await client.query(sql);
          await client.query(`INSERT INTO ${SCHEMA}.schema_migrations (version) VALUES ($1)`, [file]);
          await client.query('COMMIT');
        } catch (err) {
          await client.query('ROLLBACK');
          throw new Error(`Migração ${file} falhou: ${(err as Error).message}`);
        }
        this.logger.log(`Migração aplicada: ${file}`);
      }
    } finally {
      await client.query('SELECT pg_advisory_unlock($1)', [MIGRATION_LOCK_KEY]).catch(() => undefined);
      client.release();
    }
  }
}
