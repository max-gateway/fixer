#!/bin/sh
# Papéis de RLS do Fixer com senhas do ambiente (equivale a infra/dev/rls-roles.sql, que fixa 'password').
# Idempotente: reaplica senha e privilégios a cada subida. Conecta como o dono do banco (PG* do compose).
set -eu

psql -v ON_ERROR_STOP=1 \
  -v rls_pw="$FIXER_RLS_PASSWORD" -v sys_pw="$FIXER_SYSTEM_PASSWORD" <<'SQL'
SELECT format('CREATE ROLE fixer_rls LOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE')
WHERE NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'fixer_rls') \gexec
SELECT format('CREATE ROLE fixer_system LOGIN NOSUPERUSER BYPASSRLS NOCREATEDB NOCREATEROLE')
WHERE NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'fixer_system') \gexec

ALTER ROLE fixer_rls PASSWORD :'rls_pw';
ALTER ROLE fixer_system PASSWORD :'sys_pw';

SELECT format('GRANT CONNECT ON DATABASE %I TO fixer_rls, fixer_system', current_database()) \gexec
GRANT USAGE ON SCHEMA public TO fixer_rls, fixer_system;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO fixer_rls, fixer_system;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO fixer_rls, fixer_system;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO fixer_rls, fixer_system;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO fixer_rls, fixer_system;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO fixer_rls, fixer_system;
SQL
