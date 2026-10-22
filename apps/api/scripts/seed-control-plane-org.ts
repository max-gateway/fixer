/**
 * Semeia no banco LOCAL do Fixer uma organização criada no control plane, reproduzindo os eventos que o RabbitMQ entregaria
 * (`organization.created` e `identity.member_ready`) pelo PRÓPRIO consumidor do Fixer: mesmo código, mesma RLS, mesmo papel Admin.
 * Serve para desenvolvimento, quando o broker do control plane não é alcançável da máquina. Idempotente (pode repetir).
 *
 * Uso (na pasta apps/api, com o Postgres local no ar e as migrações aplicadas):
 *   npx tsx --env-file=.env scripts/seed-control-plane-org.ts
 * Sobrescreva com variáveis, se for outra organização:
 *   SEED_ORG_ID, SEED_ORG_SLUG, SEED_ORG_NAME, SEED_OWNER_EMAIL, SEED_OWNER_SUB, SEED_OWNER_ROLE
 *
 * Usa DATABASE_URL (papel `fixer_rls`, sujeito a RLS) e SYSTEM_DATABASE_URL (papel `fixer_system`), os mesmos do .env da API.
 */
import { PrismaClient } from '@fixer/db';
import { ControlPlaneEventsConsumer, type ControlPlaneEvent } from '../src/control-plane/control-plane-events.consumer.js';
import { ProvisioningService } from '../src/control-plane/provisioning.service.js';
import { tenantScoped } from '../src/prisma/prisma.service.js';
import { MembershipService } from '../src/tenancy/membership.service.js';

const env = (name: string, fallback?: string): string => {
  const v = process.env[name] ?? fallback;
  if (!v) throw new Error(`Variável ${name} é obrigatória`);
  return v;
};

// Padrões = a organização "MAX GATEWAY (DEV)" criada em 2026-10-22 no control plane de produção.
const org = {
  id: env('SEED_ORG_ID', '09c06197-6f6e-4fdf-9456-1d601901b188'),
  slug: env('SEED_ORG_SLUG', 'max-gateway-dev-9ac258'),
  name: env('SEED_ORG_NAME', 'MAX GATEWAY (DEV)'),
  ownerEmail: env('SEED_OWNER_EMAIL', 'gustavo@maxgateway.com.br'),
  ownerSub: env('SEED_OWNER_SUB', '0478654a-5520-435d-a9b9-3a0ae8778d1c'),
  ownerRole: env('SEED_OWNER_ROLE', 'owner'),
};

const prisma = tenantScoped(new PrismaClient({ datasourceUrl: env('DATABASE_URL') }));
const system = new PrismaClient({ datasourceUrl: env('SYSTEM_DATABASE_URL') });

// A licença não entra (sem control plane alcançável; LICENSE_REQUIRED=false em dev): o consumidor só a usa nos eventos de assinatura.
const license = { refresh: async () => undefined };
const consumer = new ControlPlaneEventsConsumer(
  { product: 'fixer', licenseRequired: false, enabled: false } as never,
  new ProvisioningService(prisma as never),
  license as never,
  new MembershipService(prisma as never, system as never),
);

const event = (type: string, data: Record<string, unknown>): ControlPlaneEvent => ({ id: `seed-${type}-${org.id}`, type, tenantId: org.id, data });

try {
  const a = await consumer.handle(event('organization.created.v1', { slug: org.slug, legalName: org.name, ownerEmail: org.ownerEmail }));
  const b = await consumer.handle(event('identity.member_ready.v1', { keycloakSub: org.ownerSub, email: org.ownerEmail, role: org.ownerRole }));
  console.log(`organização ${org.slug} (${org.id}): ${a}; membro ${org.ownerEmail}: ${b}`);
  const rows = await system.orgMembership.findMany({ where: { keycloakId: org.ownerSub }, select: { orgId: true, email: true, role: true } });
  console.log('registro de participação:', JSON.stringify(rows));
} finally {
  await prisma.$disconnect();
  await system.$disconnect();
}
