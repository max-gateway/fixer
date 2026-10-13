-- Papéis do Fixer multi-tenant (idempotente). Rode CONECTADO ao banco alvo, com um superusuário:
--   docker exec -i fixer-postgres-1 psql -U fixer_app -d <banco> < infra/dev/rls-roles.sql
--
-- fixer_rls     : o que a API usa (DATABASE_URL). Sujeito a RLS: só enxerga a organização da transação.
-- fixer_system  : o que os jobs de sistema usam (SYSTEM_DATABASE_URL). Ignora RLS de propósito: relay da outbox,
--                 agendadores fiscais e resolução de token público (portal/WhatsApp) varrem todas as organizações.
-- Em produção, crie os papéis com senhas próprias (secret manager), nunca com as deste arquivo.

DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'fixer_rls') THEN
    CREATE ROLE fixer_rls LOGIN PASSWORD 'password' NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE;
  END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'fixer_system') THEN
    CREATE ROLE fixer_system LOGIN PASSWORD 'password' NOSUPERUSER BYPASSRLS NOCREATEDB NOCREATEROLE;
  END IF;
END $$;

DO $$
BEGIN
  EXECUTE format('GRANT CONNECT ON DATABASE %I TO fixer_rls, fixer_system', current_database());
END $$;

GRANT USAGE ON SCHEMA public TO fixer_rls, fixer_system;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO fixer_rls, fixer_system;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO fixer_rls, fixer_system;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO fixer_rls, fixer_system;
-- Tabelas criadas por migrações futuras já nascem com os privilégios.
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO fixer_rls, fixer_system;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO fixer_rls, fixer_system;
