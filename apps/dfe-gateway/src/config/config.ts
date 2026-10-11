import { hostname } from 'node:os';
import { readFileSync } from 'node:fs';
import { z } from 'zod';
import type { SefazConfig } from '../core/sefaz/sefaz.config.js';

const bool = z
  .enum(['true', 'false'])
  .optional()
  .transform((v) => v === 'true');

const EnvSchema = z.object({
  PORT: z.coerce.number().int().default(3010),
  DFE_DATABASE_URL: z.string().min(1),
  /** `api` só atende HTTP; `worker` só sincroniza e entrega; `all` faz tudo (dev e instalação pequena). */
  DFE_ROLE: z.enum(['all', 'api', 'worker']).default('all'),

  DFE_ENC_KEYS: z.string().optional(),
  DFE_ACTIVE_KEY_ID: z.string().optional(),

  DFE_DIST_URL_PRODUCTION: z.string().url().optional(),
  DFE_DIST_URL_HOMOLOGATION: z.string().url().optional(),
  DFE_EVENT_URL_PRODUCTION: z.string().url().optional(),
  DFE_EVENT_URL_HOMOLOGATION: z.string().url().optional(),
  DFE_EVENT_SOAP: z.enum(['1.1', '1.2']).default('1.2'),
  DFE_CA_BUNDLE: z.string().optional(),
  DFE_REQUEST_TIMEOUT_MS: z.coerce.number().int().positive().default(60_000),

  DFE_TICK_MS: z.coerce.number().int().positive().default(30_000),
  /** CNPJs sincronizando ao mesmo tempo por worker. */
  DFE_CONCURRENCY: z.coerce.number().int().positive().max(64).default(8),

  REDIS_URL: z.string().optional(),
  RABBITMQ_URL: z.string().optional(),
  RABBITMQ_EXCHANGE: z.string().default('dfe.documents'),
  REDIS_STREAM_MAXLEN: z.coerce.number().int().positive().default(10_000),

  /** Só para desenvolvimento: aceita webhook http/IP privado. Nunca ligar em produção. */
  DFE_ALLOW_INSECURE_WEBHOOKS: bool,
  DFE_DOCUMENT_RETENTION_DAYS: z.coerce.number().int().positive().default(90),
});

export type AppConfig = ReturnType<typeof loadConfig>;

/** Valida o ambiente uma única vez no boot: config errada derruba o processo na hora. */
export function loadConfig(env: NodeJS.ProcessEnv = process.env) {
  const e = EnvSchema.parse(env);
  const sefaz: SefazConfig = {
    requestTimeoutMs: e.DFE_REQUEST_TIMEOUT_MS,
    distUrl: { PRODUCTION: e.DFE_DIST_URL_PRODUCTION, HOMOLOGATION: e.DFE_DIST_URL_HOMOLOGATION },
    eventUrl: { PRODUCTION: e.DFE_EVENT_URL_PRODUCTION, HOMOLOGATION: e.DFE_EVENT_URL_HOMOLOGATION },
    eventSoap: e.DFE_EVENT_SOAP,
    // Falha na subida se o arquivo não existe: melhor que a primeira consulta morrer com erro de TLS.
    caPem: e.DFE_CA_BUNDLE ? readFileSync(e.DFE_CA_BUNDLE, 'utf8') : undefined,
  };
  return {
    port: e.PORT,
    databaseUrl: e.DFE_DATABASE_URL,
    runApi: e.DFE_ROLE !== 'worker',
    runWorker: e.DFE_ROLE !== 'api',
    sefaz,
    tickMs: e.DFE_TICK_MS,
    concurrency: e.DFE_CONCURRENCY,
    owner: `${hostname()}-${process.pid}`,
    redisUrl: e.REDIS_URL,
    rabbit: e.RABBITMQ_URL ? { url: e.RABBITMQ_URL, exchange: e.RABBITMQ_EXCHANGE } : null,
    streamMaxLen: e.REDIS_STREAM_MAXLEN,
    allowInsecureWebhooks: e.DFE_ALLOW_INSECURE_WEBHOOKS,
    retentionDays: e.DFE_DOCUMENT_RETENTION_DAYS,
  };
}

export const CONFIG = Symbol('CONFIG');
