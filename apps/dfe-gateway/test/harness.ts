import { Test } from '@nestjs/testing';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Client } from 'pg';
import { AppModule } from '../src/app.module.js';
import type { DistResult } from '../src/core/parser/dist-response.parser.js';
import type { EnvEventoResponse } from '../src/core/parser/event-response.parser.js';
import type { CredentialMaterial, DfeSource, DistributeParams, ManifestParams } from '../src/core/sefaz/dfe-source.js';
import { DFE_SOURCE } from '../src/sync/tokens.js';
import { TenantService } from '../src/tenants/tenant.service.js';

export const TEST_DB = process.env.DFE_TEST_DATABASE_URL ?? 'postgresql://fixer_app:password@localhost:5432/dfe_gateway_test';
/** CNPJ válido (dígitos verificadores corretos) usado como empresa nos testes. */
export const CNPJ = '11222333000181';
export const OTHER_CNPJ = '11444777000161';

/** Fonte da SEFAZ com roteiro: devolve as respostas em ordem e registra as chamadas. */
export class ScriptedSource implements DfeSource {
  calls: DistributeParams[] = [];
  manifests: ManifestParams[] = [];
  manifestReply: EnvEventoResponse | Error = { batchStatus: 128, batchMotivo: 'ok', events: [] };
  constructor(public script: (DistResult | Error)[] = []) {}
  async distribute(_m: CredentialMaterial, params: DistributeParams): Promise<DistResult> {
    this.calls.push(params);
    const next = this.script.shift();
    if (!next) throw new Error('roteiro esgotado');
    if (next instanceof Error) throw next;
    return next;
  }
  async manifest(_m: CredentialMaterial, params: ManifestParams): Promise<EnvEventoResponse> {
    this.manifests.push(params);
    if (this.manifestReply instanceof Error) throw this.manifestReply;
    return this.manifestReply;
  }
}

/** Sobe o app inteiro contra um Postgres de teste zerado. DFE_ROLE=api: nenhum loop de fundo, os testes dirigem tudo. */
export async function boot(source: DfeSource = new ScriptedSource(), env: Record<string, string> = {}) {
  const admin = new Client({ connectionString: TEST_DB });
  await admin.connect();
  await admin.query('DROP SCHEMA IF EXISTS dfe CASCADE');
  await admin.end();

  Object.assign(process.env, {
    DFE_DATABASE_URL: TEST_DB,
    DFE_ROLE: 'api',
    DFE_ENC_KEYS: JSON.stringify({ k1: Buffer.alloc(32, 7).toString('base64') }),
    DFE_ACTIVE_KEY_ID: 'k1',
    DFE_ALLOW_INSECURE_WEBHOOKS: 'true',
    ...env,
  });
  const mod = await Test.createTestingModule({ imports: [AppModule] }).overrideProvider(DFE_SOURCE).useValue(source).compile();
  const app = mod.createNestApplication<NestExpressApplication>();
  app.useBodyParser('json', { limit: '1mb' });
  await app.listen(0);
  const base = `http://127.0.0.1:${(app.getHttpServer().address() as { port: number }).port}`;

  const tenants = app.get(TenantService);
  const makeTenant = async (slug: string, kind: 'FIXER' | 'ROCKET' = 'FIXER') => {
    const t = await tenants.createTenant(slug, kind);
    const { key } = await tenants.createApiKey(t.id);
    return { tenant: t, key };
  };

  const call = async (key: string | null, method: string, path: string, body?: unknown, headers: Record<string, string> = {}) => {
    const res = await fetch(`${base}${path}`, {
      method,
      headers: { ...(body === undefined ? {} : { 'content-type': 'application/json' }), ...(key ? { authorization: `Bearer ${key}` } : {}), ...headers },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await res.text();
    return { status: res.status, body: text ? (JSON.parse(text) as Record<string, any>) : null, headers: res.headers };
  };

  return { app, base, call, makeTenant, source };
}
