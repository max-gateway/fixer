import { hostname } from 'node:os';
import { z } from 'zod';

const WebhookSchema = z.object({
  url: z.string().url(),
  secret: z.string().min(8),
  events: z.array(z.string()).default(['order.*']),
});
export type WebhookEndpoint = z.infer<typeof WebhookSchema>;

const webhooksJson = z
  .string()
  .optional()
  .transform((raw, ctx): WebhookEndpoint[] => {
    if (!raw) return [];
    try {
      return z.array(WebhookSchema).parse(JSON.parse(raw));
    } catch (err) {
      ctx.addIssue({ code: 'custom', message: `WEBHOOKS inválido: ${(err as Error).message}` });
      return z.NEVER;
    }
  });

const EnvSchema = z.object({
  PORT: z.coerce.number().int().default(3005),
  NOTIFICATIONS_DATABASE_URL: z.string().min(1),
  REDIS_URL: z.string().default('redis://localhost:6379/0'),
  ORDER_EVENTS_STREAM: z.string().default('fixer:order-events'),
  NOTIFICATIONS_CONSUMER_GROUP: z.string().default('notifications'),
  NOTIFICATIONS_CONSUMER_NAME: z.string().default(`${hostname()}-${process.pid}`),

  TENANT_DISPLAY_NAME: z.string().default('Fixer'),
  BRAND_PRIMARY_COLOR: z.string().default('#1F6BFF'),

  EMAIL_TRANSPORT: z.enum(['smtp', 'log']).default('log'),
  EMAIL_FROM: z.string().default('Fixer <no-reply@fixer.local>'),
  SMTP_URL: z.string().optional(),
  WEBHOOKS: webhooksJson,

  // Serviço apps/whatsapp. O canal só existe se as duas variáveis estiverem definidas.
  WHATSAPP_SERVICE_URL: z.string().url().optional(),
  WHATSAPP_API_KEY: z.string().min(16).optional(),

  // Mesmo Keycloak do tenant: valida o JWT dos usuários da equipe nas rotas /v1.
  KEYCLOAK_AUTH_SERVER_URL: z.string().url(),
  KEYCLOAK_REALM: z.string().min(1),
});

export type AppConfig = ReturnType<typeof loadConfig>;

/** Valida o ambiente uma única vez no boot: config errada derruba o processo na hora, não na primeira entrega. */
export function loadConfig(env: NodeJS.ProcessEnv = process.env) {
  const e = EnvSchema.parse(env);
  const issuer = `${e.KEYCLOAK_AUTH_SERVER_URL.replace(/\/+$/, '')}/realms/${e.KEYCLOAK_REALM}`;
  if (e.EMAIL_TRANSPORT === 'smtp' && !e.SMTP_URL) throw new Error('EMAIL_TRANSPORT=smtp exige SMTP_URL');
  if (!!e.WHATSAPP_SERVICE_URL !== !!e.WHATSAPP_API_KEY) {
    throw new Error('WHATSAPP_SERVICE_URL e WHATSAPP_API_KEY devem ser definidas juntas');
  }
  return {
    port: e.PORT,
    databaseUrl: e.NOTIFICATIONS_DATABASE_URL,
    redisUrl: e.REDIS_URL,
    stream: {
      name: e.ORDER_EVENTS_STREAM,
      dlq: `${e.ORDER_EVENTS_STREAM}:dlq`,
      group: e.NOTIFICATIONS_CONSUMER_GROUP,
      consumer: e.NOTIFICATIONS_CONSUMER_NAME,
      batchSize: 20,
      blockMs: 2_000,
      /** Mensagem pendente há mais que isso (consumer morreu) é reivindicada por outra réplica. */
      claimIdleMs: 60_000,
      /** Entregas além disso vão para a DLQ em vez de travar o grupo. */
      maxDeliveries: 5,
    },
    brand: { name: e.TENANT_DISPLAY_NAME, color: e.BRAND_PRIMARY_COLOR },
    email: { transport: e.EMAIL_TRANSPORT, from: e.EMAIL_FROM, smtpUrl: e.SMTP_URL },
    webhooks: e.WEBHOOKS,
    whatsapp: e.WHATSAPP_SERVICE_URL && e.WHATSAPP_API_KEY ? { url: e.WHATSAPP_SERVICE_URL, apiKey: e.WHATSAPP_API_KEY } : null,
    dispatch: {
      batchSize: 20,
      pollMs: 1_000,
      leaseMs: 60_000,
      backoffBaseMs: 30_000,
      backoffCapMs: 3_600_000,
      maxAttempts: { email: 8, webhook: 10, whatsapp: 8 } as Record<string, number>,
      breaker: { threshold: 5, cooldownMs: 30_000, maxCooldownMs: 300_000 },
    },
    inboxRetentionDays: 30,
    /** Notificações finalizadas (SENT/DEAD/SUPPRESSED) são apagadas depois disso. */
    notificationRetentionDays: 90,
    auth: { issuer, jwksUrl: `${issuer}/protocol/openid-connect/certs` },
  };
}

/** Token de injeção da config validada. */
export const CONFIG = Symbol('CONFIG');
