import { z } from 'zod';

const EnvSchema = z.object({
  PORT: z.coerce.number().int().default(3006),
  WHATSAPP_DATABASE_URL: z.string().min(1),
  WHATSAPP_API_KEYS: z
    .string()
    .min(1)
    .transform((v) =>
      v
        .split(',')
        .map((k) => k.trim())
        .filter(Boolean),
    )
    .refine(
      (keys) => keys.length > 0 && keys.every((k) => k.length >= 16),
      'cada chave precisa de 16+ caracteres',
    ),

  WHATSAPP_PROVIDER: z.enum(['log', 'cloud']).default('log'),
  META_ACCESS_TOKEN: z.string().optional(),
  META_PHONE_NUMBER_ID: z.string().optional(),
  META_APP_SECRET: z.string().optional(),
  META_WEBHOOK_VERIFY_TOKEN: z.string().optional(),
  META_GRAPH_VERSION: z
    .string()
    .regex(/^v\d+\.\d+$/)
    .default('v21.0'),
  META_MAX_MPS: z.coerce.number().int().min(1).max(80).default(20),

  // Eventos para o resto do sistema (código de OS recebido -> apps/api), via Redis Stream.
  REDIS_URL: z.string().optional(),
  TENANT_SLUG: z.string().min(1).default('local'),
  INBOUND_EVENTS_STREAM: z.string().min(1).default('fixer:whatsapp-inbound'),
  INBOUND_EVENTS_STREAM_MAXLEN: z.coerce.number().int().min(1000).default(100_000),
  /** Tentativas de código por remetente numa janela; passou disso, a mensagem deixa de contar como vínculo. */
  ORDER_CODE_MAX_PER_WINDOW: z.coerce.number().int().min(1).default(5),
  ORDER_CODE_WINDOW_MS: z.coerce.number().int().min(1000).default(600_000),
});

export type AppConfig = ReturnType<typeof loadConfig>;

/** Valida o ambiente uma única vez no boot: config errada derruba o processo na hora, não no primeiro envio. */
export function loadConfig(env: NodeJS.ProcessEnv = process.env) {
  const e = EnvSchema.parse(env);
  if (e.WHATSAPP_PROVIDER === 'cloud') {
    const missing = (
      [
        'META_ACCESS_TOKEN',
        'META_PHONE_NUMBER_ID',
        'META_APP_SECRET',
        'META_WEBHOOK_VERIFY_TOKEN',
      ] as const
    ).filter((k) => !e[k]);
    if (missing.length)
      throw new Error(`WHATSAPP_PROVIDER=cloud exige: ${missing.join(', ')}`);
  }
  return {
    port: e.PORT,
    databaseUrl: e.WHATSAPP_DATABASE_URL,
    apiKeys: e.WHATSAPP_API_KEYS,
    provider: e.WHATSAPP_PROVIDER,
    meta: {
      accessToken: e.META_ACCESS_TOKEN ?? '',
      phoneNumberId: e.META_PHONE_NUMBER_ID ?? '',
      appSecret: e.META_APP_SECRET ?? '',
      verifyToken: e.META_WEBHOOK_VERIFY_TOKEN ?? '',
      graphVersion: e.META_GRAPH_VERSION,
      maxMps: e.META_MAX_MPS,
    },
    dispatch: {
      batchSize: 20,
      pollMs: 1_000,
      leaseMs: 60_000,
      backoffBaseMs: 30_000,
      backoffCapMs: 3_600_000,
      maxAttempts: 8,
      breaker: { threshold: 5, cooldownMs: 30_000, maxCooldownMs: 300_000 },
    },
    events: {
      redisUrl: e.REDIS_URL ?? '',
      stream: e.INBOUND_EVENTS_STREAM,
      maxLen: e.INBOUND_EVENTS_STREAM_MAXLEN,
      tenant: e.TENANT_SLUG,
      batchSize: 100,
      retentionHours: 72,
      codeRateLimit: {
        max: e.ORDER_CODE_MAX_PER_WINDOW,
        windowMs: e.ORDER_CODE_WINDOW_MS,
      },
    },
    /** Janela de atendimento da Meta: texto livre só até 24h depois da última mensagem do cliente. */
    serviceWindowMs: 24 * 3_600_000,
    retentionDays: { messages: 90, webhookEvents: 7, inbound: 90 },
  };
}

export const CONFIG = Symbol('CONFIG');
