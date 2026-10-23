-- Dá a um usuário do ambiente de DEV o papel "Admin" com todas as permissões que as rotas já exigem
-- (@RequirePermission). As rotas protegidas falham fechado: sem isto, respondem 403 para todo mundo,
-- enquanto ninguém tiver o papel Admin. Depois do primeiro Admin, use a tela Configurações → Acessos.
--
-- Multi-tenant: o usuário e o papel pertencem a UMA organização (:'org'). Rode com um papel que ignora RLS (o dono do banco
-- em dev), ou o INSERT é barrado pela política da tabela. Idempotente. O usuário precisa já ter feito login uma vez
-- nessa organização, para existir em "User".
--
--   docker compose -f infra/dev/docker-compose.yml exec -T postgres \
--     psql -U fixer_app -d fixer -v email=dev@fixer.local -v org=<uuid-da-organizacao> < infra/dev/grant-admin.sql
--
-- Ao criar uma nova rota com @RequirePermission, acrescente a chave na lista abaixo.

BEGIN;

-- Permission é referência compartilhada (sem organização).
INSERT INTO "Permission" ("id", "key", "label") VALUES
  ('perm-fiscal-manage',     'fiscal.manage',     'Configurar a importação fiscal (certificado, CNPJ, automações)'),
  ('perm-fiscal-verify',     'fiscal.verify',     'Confirmar dados fiscais (contador)'),
  ('perm-invoices-read',     'invoices.read',     'Ver notas de compra'),
  ('perm-invoices-reconcile','invoices.reconcile','Conciliar e lançar notas de compra'),
  ('perm-learning-manage',   'learning.manage',   'Gerenciar o aprendizado de tempos'),
  ('perm-access-read',       'access.read',       'Ver pessoas, papéis e o histórico de acessos'),
  ('perm-access-manage',     'access.manage',     'Convidar pessoas, editar papéis e permissões')
ON CONFLICT ("key") DO NOTHING;

-- Dali em diante tudo é da organização informada.
SELECT set_config('app.org_id', :'org', true);

-- Um papel "Admin" por organização (o id leva o prefixo da organização para não colidir).
INSERT INTO "Role" ("id", "orgId", "name", "description", "isSystem")
VALUES ('role-admin-' || :'org', :'org'::uuid, 'Admin', 'Acesso total', true)
ON CONFLICT ("orgId", "name") DO NOTHING;

INSERT INTO "RolePermission" ("orgId", "roleId", "permissionId")
SELECT r."orgId", r."id", p."id" FROM "Role" r CROSS JOIN "Permission" p WHERE r."name" = 'Admin' AND r."orgId" = :'org'::uuid
ON CONFLICT DO NOTHING;

INSERT INTO "UserRole" ("orgId", "userId", "roleId")
SELECT u."orgId", u."id", r."id" FROM "User" u JOIN "Role" r ON r."orgId" = u."orgId"
WHERE u."email" = :'email' AND u."orgId" = :'org'::uuid AND r."name" = 'Admin'
ON CONFLICT DO NOTHING;

-- Confere: quantas permissões o usuário passou a ter (0 = e-mail não encontrado nessa organização; faça login e rode de novo).
SELECT u."email", count(rp."permissionId") AS permissoes
FROM "User" u
LEFT JOIN "UserRole" ur ON ur."userId" = u."id"
LEFT JOIN "RolePermission" rp ON rp."roleId" = ur."roleId"
WHERE u."email" = :'email' AND u."orgId" = :'org'::uuid
GROUP BY u."email";

COMMIT;
