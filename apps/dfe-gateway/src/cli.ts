import { existsSync } from 'node:fs';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module.js';
import { AuditService } from './audit/audit.service.js';
import { parseCnpj } from './companies/company.service.js';
import { Database } from './db/database.service.js';
import { TenantService } from './tenants/tenant.service.js';

/**
 * Administração do gateway, por SSH no servidor (não há API administrativa exposta):
 *   node dist/cli.js tenant:create <slug> <FIXER|ROCKET|OTHER>
 *   node dist/cli.js key:create <slug> [rótulo]       (a chave aparece UMA vez)
 *   node dist/cli.js key:revoke <idDaChave>
 *   node dist/cli.js tenant:suspend <slug> | tenant:activate <slug>
 *   node dist/cli.js grant <cnpj> <slug>              (dá a outro tenant acesso de leitura ao CNPJ)
 *   node dist/cli.js status                           (CNPJs, certificado e sincronização)
 */
async function main() {
  if (existsSync('.env')) process.loadEnvFile('.env');
  process.env.DFE_ROLE = 'api'; // contexto de CLI nunca sincroniza nem entrega
  const [cmd, ...args] = process.argv.slice(2);
  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error', 'warn'] });
  const db = app.get(Database);
  const tenants = app.get(TenantService);
  const audit = app.get(AuditService);
  const who = `cli:${process.env.USER ?? process.env.USERNAME ?? 'operador'}`;

  try {
    switch (cmd) {
      case 'tenant:create': {
        const [slug, kind] = args;
        if (!slug || !['FIXER', 'ROCKET', 'OTHER'].includes(kind ?? '')) throw new Error('uso: tenant:create <slug> <FIXER|ROCKET|OTHER>');
        const t = await tenants.createTenant(slug, kind as 'FIXER');
        await audit.record(who, 'tenant.create', null, { slug, kind });
        console.log(`tenant criado: ${t.slug} (${t.id})`);
        break;
      }
      case 'key:create': {
        const t = await tenants.findBySlug(args[0] ?? '');
        if (!t) throw new Error('tenant não encontrado');
        const k = await tenants.createApiKey(t.id, args[1] ?? '');
        await audit.record(who, 'apikey.create', null, { tenant: t.slug, id: k.id });
        console.log(`Chave de API do tenant ${t.slug} (guarde agora, não será mostrada de novo):\n${k.key}`);
        break;
      }
      case 'key:revoke': {
        const ok = await tenants.revokeApiKey(args[0] ?? '');
        await audit.record(who, 'apikey.revoke', null, { id: args[0] });
        console.log(ok ? 'chave revogada' : 'chave não encontrada ou já revogada');
        break;
      }
      case 'tenant:suspend':
      case 'tenant:activate': {
        const status = cmd === 'tenant:suspend' ? 'SUSPENDED' : 'ACTIVE';
        const { rowCount } = await db.query('UPDATE tenants SET status = $2 WHERE slug = $1', [args[0], status]);
        await audit.record(who, cmd, null, { slug: args[0] });
        console.log(rowCount ? `tenant ${args[0]}: ${status}` : 'tenant não encontrado');
        break;
      }
      case 'grant': {
        const cnpj = parseCnpj(args[0] ?? '');
        const t = await tenants.findBySlug(args[1] ?? '');
        if (!t) throw new Error('tenant não encontrado');
        const co = await db.query<{ id: string }>('SELECT id FROM companies WHERE cnpj = $1', [cnpj]);
        if (!co.rows[0]) throw new Error('empresa não encontrada');
        await db.query('INSERT INTO subscriptions (company_id, tenant_id) VALUES ($1,$2) ON CONFLICT DO NOTHING', [co.rows[0].id, t.id]);
        await audit.record(who, 'grant', co.rows[0].id, { tenant: t.slug });
        console.log(`${t.slug} agora lê os documentos de ${cnpj} (PULL; ele escolhe o transporte)`);
        break;
      }
      case 'status': {
        const { rows } = await db.query(
          `SELECT co.cnpj, t.slug AS dono, c.status AS cert, c.enabled, c.not_after::date AS vence,
                  s.last_nsu, s.max_nsu, s.last_status_code AS cstat, s.next_poll_at, s.consecutive_failures AS falhas, left(s.last_error, 60) AS erro
             FROM companies co JOIN tenants t ON t.id = co.owner_id
             LEFT JOIN credentials c ON c.company_id = co.id LEFT JOIN sync_state s ON s.company_id = co.id ORDER BY co.cnpj`,
        );
        console.table(rows);
        break;
      }
      default:
        throw new Error('comando desconhecido. Veja o cabeçalho de src/cli.ts');
    }
  } finally {
    await app.close();
  }
}

main().catch((err: Error) => {
  console.error(`erro: ${err.message}`);
  process.exit(1);
});
