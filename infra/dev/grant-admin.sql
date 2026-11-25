-- Dá a um usuário do ambiente de DEV o papel "Admin" com todas as permissões que as rotas já exigem
-- (@RequirePermission). As rotas protegidas falham fechado: sem isto, respondem 403 para todo mundo,
-- porque ainda não existe tela nem seed de provisionamento para papéis e permissões.
--
-- Idempotente. Uso (o usuário precisa já ter feito login uma vez, para existir em "User"):
--   docker compose -f infra/dev/docker-compose.yml exec -T postgres \
--     psql -U fixer_app -d fixer -v email=dev@fixer.local < infra/dev/grant-admin.sql
--
-- Ao criar uma nova rota com @RequirePermission, acrescente a chave na lista abaixo.

BEGIN;

INSERT INTO "Permission" ("id", "key", "label") VALUES
  ('perm-fiscal-manage',     'fiscal.manage',     'Configurar a importação fiscal (certificado, CNPJ, automações)'),
  ('perm-fiscal-verify',     'fiscal.verify',     'Confirmar dados fiscais (contador)'),
  ('perm-invoices-read',     'invoices.read',     'Ver notas de compra'),
  ('perm-invoices-reconcile','invoices.reconcile','Conciliar e lançar notas de compra'),
  ('perm-learning-manage',   'learning.manage',   'Gerenciar o aprendizado de tempos')
ON CONFLICT ("key") DO NOTHING;

INSERT INTO "Role" ("id", "name", "description", "isSystem")
VALUES ('role-admin', 'Admin', 'Acesso total', true)
ON CONFLICT ("name") DO NOTHING;

INSERT INTO "RolePermission" ("roleId", "permissionId")
SELECT r."id", p."id" FROM "Role" r CROSS JOIN "Permission" p WHERE r."name" = 'Admin'
ON CONFLICT DO NOTHING;

INSERT INTO "UserRole" ("userId", "roleId")
SELECT u."id", r."id" FROM "User" u CROSS JOIN "Role" r WHERE u."email" = :'email' AND r."name" = 'Admin'
ON CONFLICT DO NOTHING;

-- Confere: quantas permissões o usuário passou a ter (0 = e-mail não encontrado; faça login e rode de novo).
SELECT u."email", count(rp."permissionId") AS permissoes
FROM "User" u
LEFT JOIN "UserRole" ur ON ur."userId" = u."id"
LEFT JOIN "RolePermission" rp ON rp."roleId" = ur."roleId"
WHERE u."email" = :'email'
GROUP BY u."email";

COMMIT;
