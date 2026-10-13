import { PrismaClient } from '@fixer/db';
import { tenantScoped } from '../src/prisma/prisma.service.js';

/**
 * Ajudas dos testes de integração. A URL recebida é a do DONO do banco de teste (superusuário, ignora RLS); os testes
 * conectam como `fixer_rls` (sujeito a RLS, igual à produção) e usam o dono só para preparar papéis e inspecionar.
 */

/** Mesma URL, trocando o usuário. Os papéis do infra/dev/rls-roles.sql usam a senha "password" em dev. */
export function urlAs(ownerUrl: string, role: 'fixer_rls' | 'fixer_system', password = 'password'): string {
  const u = new URL(ownerUrl);
  u.username = role;
  u.password = password;
  return u.toString();
}

/** Cliente sujeito a RLS, no mesmo formato do PrismaService (organização vem do TenantContext). */
export function tenantClient(ownerUrl: string): PrismaClient {
  return tenantScoped(new PrismaClient({ datasourceUrl: urlAs(ownerUrl, 'fixer_rls') }));
}

/** Cliente que ignora RLS, como o SystemPrismaService. */
export function systemClient(ownerUrl: string): PrismaClient {
  return new PrismaClient({ datasourceUrl: urlAs(ownerUrl, 'fixer_system') });
}

const ROLE_SQL = [
  `DO $$ BEGIN
     IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'fixer_rls') THEN
       CREATE ROLE fixer_rls LOGIN PASSWORD 'password' NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE;
     END IF;
     IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'fixer_system') THEN
       CREATE ROLE fixer_system LOGIN PASSWORD 'password' NOSUPERUSER BYPASSRLS NOCREATEDB NOCREATEROLE;
     END IF;
   END $$`,
  `DO $$ BEGIN EXECUTE format('GRANT CONNECT ON DATABASE %I TO fixer_rls, fixer_system', current_database()); END $$`,
  'GRANT USAGE ON SCHEMA public TO fixer_rls, fixer_system',
  'GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO fixer_rls, fixer_system',
  'GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO fixer_rls, fixer_system',
  'GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO fixer_rls, fixer_system',
];

/** Cria os papéis e concede os privilégios no banco de teste (espelha infra/dev/rls-roles.sql). Idempotente. */
export async function ensureRoles(ownerUrl: string): Promise<void> {
  const owner = new PrismaClient({ datasourceUrl: ownerUrl });
  try {
    for (const sql of ROLE_SQL) await owner.$executeRawUnsafe(sql);
  } finally {
    await owner.$disconnect();
  }
}
