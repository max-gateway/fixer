# access — controle de acesso

Pessoas, papéis, permissões e auditoria da oficina (tela **Configurações → Acessos**, `apps/web/src/features/access`).

```
access.controller ──▶ access.service ──┬─▶ domain/policy.ts      regras puras (sem banco/Keycloak/Nest)
                                       ├─▶ Prisma (RLS)          User, Role, RolePermission, UserRole, AccessAuditLog
                                       └─▶ MemberDirectory       porta; ControlPlaneDirectory é o adaptador
```

- **Permissões**: catálogo em `auth/permissions.catalog.ts` (com grupo e risco). Rota nova com `@RequirePermission` → acrescente lá.
- **Regras** (`domain/policy.ts`): o Admin (papel de sistema) tem sempre o catálogo inteiro e não é apagado; ninguém tira o próprio
  `access.manage`; a oficina nunca fica sem administrador ativo. Avaliadas numa transação com `pg_advisory_xact_lock` por organização.
- **Diretório** (`directory/`): pessoas, convites e contas são do **control plane** (o Fixer não tem credencial de administração do Keycloak).
  A leitura vem de `OrgMembership`, a projeção que o próprio control plane alimenta (evento `identity.member_ready` e sync do diretório); a escrita
  (`addMember`, `removeMember`, `resendSetupEmail`) vai ao control plane com a chave `product` presa ao Fixer. Sem `CONTROL_PLANE_URL` e
  `CONTROL_PLANE_API_KEY` fica desligado: a tela segue funcionando para quem já entrou, sem convites.
- **Convite**: o control plane cria a conta de forma ASSÍNCRONA (fila de identidade), então o `sub` só nasce depois. Quem ainda não existe vira
  `PendingInvite` (só a intenção: e-mail e papéis da oficina, que são dado do Fixer) e aparece como "Convidado"; quando chega
  `identity.member_ready`, o `User` é criado com esses papéis e o convite some (`control-plane/pending-invite.service.ts`). O e-mail de definir
  senha sai do control plane nesse momento. Quem já está na organização (conta e vínculo existentes) ganha o usuário na hora. Cancelar o convite
  (`DELETE /access/invites/:id`) apaga só a intenção; a pessoa que o control plane já criou continua na organização, sem acesso ao Fixer.
- **Limite do plano** (`users`): convite, reativação e "dar acesso" a quem só está no diretório conferem os assentos.

Rotas (`/access`): `GET me`, `GET catalog`, `GET|POST roles`, `PATCH|DELETE roles/:id`, `GET|POST members`,
`PUT members/:sub/roles`, `POST members/:sub/{deactivate,reactivate,setup-email}`, `DELETE members/:sub`, `DELETE invites/:id`, `GET audit`.
Erros de regra: `{ statusCode, error: <código estável>, message }` (409 `last_manager`/`self_lockout`/`system_role`/`duplicate_role_name`,
422 `unknown_permission`, 503 `directory_*`, 402 `plan_limit_reached`).
