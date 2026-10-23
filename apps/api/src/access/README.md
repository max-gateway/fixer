# access — controle de acesso

Pessoas, papéis, permissões e auditoria da oficina (tela **Configurações → Acessos**, `apps/web/src/features/access`).

```
access.controller ──▶ access.service ──┬─▶ domain/policy.ts      regras puras (sem banco/Keycloak/Nest)
                                       ├─▶ Prisma (RLS)          User, Role, RolePermission, UserRole, AccessAuditLog
                                       └─▶ MemberDirectory       porta; KeycloakDirectory é o adaptador
```

- **Permissões**: catálogo em `auth/permissions.catalog.ts` (com grupo e risco). Rota nova com `@RequirePermission` → acrescente lá.
- **Regras** (`domain/policy.ts`): o Admin (papel de sistema) tem sempre o catálogo inteiro e não é apagado; ninguém tira o próprio
  `access.manage`; a oficina nunca fica sem administrador ativo. Avaliadas numa transação com `pg_advisory_xact_lock` por organização.
- **Diretório** (`directory/`): `ACCESS_DIRECTORY_MODE=organization` (realm único, Organization com alias = UUID da oficina) ou `realm`
  (instalação dedicada; remover = desabilitar a conta). Sem `KEYCLOAK_ADMIN_CLIENT_ID/SECRET` fica desligado: a tela segue funcionando
  para quem já entrou, sem convites. Client: `node scripts/keycloak-access-client.mjs --realm <realm> --mode <modo>`.
- **Convite**: cria/reaproveita a conta, põe na organização, cria o `User` já com os papéis (`lastSeenAt` nulo = convidado) e manda o
  e-mail de definir senha. Sem SMTP no realm o acesso vale e a resposta traz `emailSent: false`.
- **Limite do plano** (`users`): convite, reativação e "dar acesso" a quem só está no diretório conferem os assentos.

Rotas (`/access`): `GET me`, `GET catalog`, `GET|POST roles`, `PATCH|DELETE roles/:id`, `GET|POST members`,
`PUT members/:sub/roles`, `POST members/:sub/{deactivate,reactivate,setup-email}`, `DELETE members/:sub`, `GET audit`.
Erros de regra: `{ statusCode, error: <código estável>, message }` (409 `last_manager`/`self_lockout`/`system_role`/`duplicate_role_name`,
422 `unknown_permission`, 503 `directory_*`, 402 `plan_limit_reached`).
