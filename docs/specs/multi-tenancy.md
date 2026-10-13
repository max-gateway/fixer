# Fixer multi-tenant: um banco compartilhado, isolamento por organização

Status: implementado na branch `feat/multi-tenant` (fase 4 do plano do control plane, `max-gateway/platform/docs/specs/control-plane.md`).
Substitui "um banco por oficina" como modelo padrão. A instalação dedicada (um banco por oficina) continua suportada como caminho
`dedicated`, com o mesmo código.

## 1. Modelo

- **Organização** = uma oficina cliente, identificada pelo UUID que o control plane da Max Gateway criou. É o tenant.
- **Usuário** é por organização: a mesma pessoa em duas oficinas tem duas linhas em `User` (mesmo `keycloakId`), com papéis independentes.
- Toda tabela de dados da oficina tem a coluna `orgId UUID NOT NULL`. Quem a preenche é o **banco**, com `DEFAULT app_org()`;
  o código de negócio não precisa passar `orgId` nos `create`.
- Tabelas **sem** `orgId` são referência compartilhada: `Permission`, `PlateLookup` (cache pago da consulta de placa, vale para todos),
  `VehicleComponent`, `ServiceFiscalProfile`, `ServiceDefinition`, `ServiceSuggestedPart`, `VehicleVariant`, `CatalogState`.

| Escopo | Tabelas |
|---|---|
| Por organização (RLS) | User, Role, RolePermission, UserRole, Customer, Vehicle, VehicleOwner, Part, Service, ServiceOrder (+ linhas, status, eventos, checklist), StockMovement, ProcessedInboundEvent, OutboxEvent, ServiceObservation, ServiceEstimate, TenantFiscalSettings, FiscalCredential, FiscalSyncState, FiscalAuditLog, PurchaseInvoice (+ itens), SupplierItemMap, OrgCounter |
| Compartilhado | Permission, PlateLookup, VehicleComponent, ServiceFiscalProfile, ServiceDefinition, ServiceSuggestedPart, VehicleVariant, CatalogState |

Singletons que eram `id = 1` (`TenantFiscalSettings`, `FiscalCredential`, `FiscalSyncState`) agora têm `orgId` como chave primária: um por oficina.

Unicidades que eram globais passam a valer **dentro da organização**: documento do cliente, placa, SKU, nome de serviço/papel,
e-mail e `keycloakId` do usuário, chave de acesso da NF-e, vínculo fornecedor/código. `portalToken` e `linkCode` continuam
**globais** de propósito: são credenciais aleatórias que chegam sem sessão e precisam dizer a qual organização pertencem.

O número sequencial da OS (`ServiceOrder.number`) é por organização, via `OrgCounter` + `next_org_seq('service_order')`
(a linha do contador serializa só a mesma organização e não deixa buracos).

## 2. Isolamento (Row Level Security)

Cada tabela de oficina tem `ENABLE` + `FORCE ROW LEVEL SECURITY` e a política:

```sql
CREATE POLICY tenant_isolation ON "<tabela>" USING ("orgId" = app_org()) WITH CHECK ("orgId" = app_org());
-- app_org() = nullif(current_setting('app.org_id', true), '')::uuid
```

- Sem organização na sessão, `app_org()` é `NULL` e **nenhuma linha** é visível nem gravável (falha fechada).
- A política vale para leitura **e** escrita: gravar com o `orgId` de outra organização é recusado pelo banco.
- O `FORCE` faz valer também para o dono da tabela. Só superusuário ou `BYPASSRLS` escapa, por isso a API **não** pode conectar com um deles.

**Papéis** (`infra/dev/rls-roles.sql`):

| Papel | Uso | RLS |
|---|---|---|
| `fixer_rls` | `DATABASE_URL`: a API inteira | sujeito |
| `fixer_system` | `SYSTEM_DATABASE_URL`: jobs que atravessam organizações | ignora (BYPASSRLS) |
| dono / superusuário | migrações e operação | ignora |

Em produção os papéis são criados com senhas próprias (secret manager). Migrações que alteram dados precisam rodar com um papel que ignora RLS.

## 3. Como a organização chega ao banco

1. **`TenantContext`** (AsyncLocalStorage): a organização da operação em andamento.
2. **Requisição autenticada** — `TenantMiddleware`: valida o JWT, lê o claim `organization` (configurável em `AUTH_ORGS_CLAIM`) e define a organização.
   Quem participa de uma só organização não precisa informar nada; quem participa de várias envia `X-Org-Id`. **O cabeçalho só escolhe entre as
   organizações do próprio token; nunca concede acesso** (organização fora do token = 403).
3. **Portal público** — `PortalTenantMiddleware`: a organização é a dona do `portalToken` da URL (o token é a credencial do cliente final). Token desconhecido = 404.
4. **`PrismaService`** (RLS): cada operação, transação interativa ou SQL cru roda com `set_config('app.org_id', <org>, true)`, que vale só até o fim da
   transação, então a conexão volta ao pool limpa. Tabela de oficina sem organização no contexto **lança `TenantContextMissing`** (falha alto, nunca "lista vazia").
5. **`SystemPrismaService`** (BYPASSRLS): só descobre *onde* agir (organização de um token/código, quem tem trabalho). Quem age é o `PrismaService`, dentro de `TenantContext.run`.

Pegadinhas conhecidas: as promessas do Prisma são **preguiçosas** (executam no `await`); `TenantContext.run` as executa dentro do escopo. O
`$transaction([...])` em forma de lote não é suportado no cliente com escopo (use a forma interativa `$transaction(async (tx) => ...)`).

## 4. Processos em segundo plano

| Processo | Como fica |
|---|---|
| Relay da outbox | cliente de sistema; publica a outbox de todas as organizações em ordem global de `seq`. O envelope leva `tenant` = organização (ou `TENANT_SLUG` em instalação legada) |
| Consumidor do `dfe-gateway` | por ciclo, percorre as organizações com certificado habilitado e roda o ciclo de cada uma em `TenantContext.run` (falha de uma não para as outras) |
| Agendador de sincronização SEFAZ | idem, sobre as organizações com `nextPollAt` vencido e sem lease |
| Consumidor de WhatsApp | o `linkCode` (único no sistema) diz a organização; código desconhecido é ignorado em silêncio |
| Bootstrap do catálogo | só tabelas compartilhadas; roda sem organização |

## 5. Instalações existentes (um banco por oficina)

A migração `20261012100000_multi_tenant` roda no lugar: todas as linhas existentes recebem a organização "legada"
(`00000000-0000-0000-0000-000000000001`, ou o UUID passado em `PGOPTIONS="-c fixer.legacy_org_id=<uuid>"`), o contador da OS continua de onde parou e a RLS é ligada.
Para a instância continuar funcionando sem mudar o Keycloak: `DEFAULT_ORG_ID=<mesmo uuid>` (token sem claim de organizações usa esta) e `DATABASE_URL`
com o papel `fixer_rls`.

### Identidade: um realm, uma Organization do Keycloak por oficina

O control plane cria, no realm único, uma **Organization** por oficina com `alias` = UUID da organização (por isso o claim carrega exatamente o id que o Fixer usa) e um usuário por membro (`max-gateway/platform/services/control-plane`, módulo `identity`; o realm é preparado por `scripts/keycloak-setup-realm.mjs`).

- **O claim `organization` é só um atalho, nunca a autoridade.** O Keycloak 26.0.8 o coloca no token de quem está em UMA organização (8/8 logins), mas para quem está em VÁRIAS ele aparece de forma **intermitente** (em testes reais, de 3/8 a 7/8 logins, tanto no fluxo de senha quanto no de código de autorização), e só se o login pedir `organization:*` (web: `KEYCLOAK_ORGANIZATIONS=true`). Por isso a **participação** vem do control plane: a cada membro provisionado ele publica `identity.member_ready` (com o `sub` do Keycloak e o papel) e o Fixer grava em `OrgMembership` (com RLS). A API resolve as oficinas de um usuário como **claim ∪ participação**; um token sem claim continua funcionando.
- Quem está em várias oficinas escolhe com `X-Org-Id` (sem o cabeçalho: 400; oficina que não é dele: 403). O cabeçalho só escolhe, nunca concede.
- O client precisa ter o escopo `organization` como padrão (o script faz isso) e o realm, `organizationsEnabled`. O `infra/dev/realm-fixer-dev.json` já traz os dois para ambientes novos; o realm de dev que já existe no seu Keycloak **não foi alterado**: rode o script (`--realm fixer-dev --web-client fixer-web`) quando quiser.

### Seletor de oficina (web)

- A web pergunta à API (`GET /me/organizations`, que não exige oficina escolhida) quais são as oficinas do usuário e com que nome; **não** lê só o token (pelo motivo acima). O resultado é memoizado por 30 s por usuário.
- Uma oficina só: entra direto. Várias: `/organizacoes` lista pelo nome, e a escolha grava o cookie `fixer_org` (httpOnly) por um **POST de formulário comum**, cuja resposta recarrega a página inteira (descarta o cache de dados da oficina anterior). "Trocar de oficina" fica no menu do usuário.
- O cookie só é repassado como `X-Org-Id`; quem confere é a API, a cada chamada. Cookie de oficina que deixou de ser do usuário manda escolher de novo.

## 6. Integração com o control plane (provisionamento e licença)

O `ControlPlaneModule` (`apps/api/src/control-plane/`) liga o Fixer ao control plane da Max Gateway. Fica **desligado** sem `CONTROL_PLANE_URL`, `CONTROL_PLANE_API_KEY` (escopo `product`) e `RABBITMQ_URL`.

- **Consumidor** da fila `fixer.control-plane` (exchange `mg.control-plane`; `organization.created.v1`, `subscription.*.v1`, `entitlements.changed.v1`). Idempotente; falha reprocessa (5 tentativas) e depois vai para a `.dlq`.
- `organization.created`: grava `OrgProfile` (slug e e-mail do dono) e cria o papel **Admin** com todas as permissões de `auth/permissions.catalog.ts`.
- Eventos de assinatura/licença **do produto `fixer`**: buscam o snapshot em `GET /v1/orgs/{org}/entitlements`, **validam o JWS pelo JWKS** (assinatura, emissor, organização e produto) e gravam `OrgLicense`. O evento só avisa; a verdade é o snapshot. Um snapshot mais antigo nunca sobrescreve um mais novo.
- **Dono vira Admin no primeiro login**: o usuário só existe depois do login, então `AuthService` chama `ensureOwnerAdmin` (e-mail igual ao do dono, usuário ainda sem papel). Só age uma vez.
- **`LicenseGuard`** (global, depois da autenticação): `readonly` deixa passar GET/HEAD/OPTIONS e responde **402** `subscription_readonly` nas escritas; `none` responde 402 `subscription_inactive` em tudo. Se a janela de somente leitura acabou depois do último snapshot, vale `none`. Rotas públicas (portal do cliente final) não são checadas.
- Sem linha em `OrgLicense` o acesso é livre (instalação legada). Em produção compartilhada defina `LICENSE_REQUIRED=true`: organização sem licença conhecida fica sem acesso.
- Verificado ponta a ponta com o control plane real e RabbitMQ: cadastro da oficina → perfil, Admin e licença criados no Fixer; ativar, vencer, suspender, reativar e cancelar atualizam o modo em segundos.

### Limites do plano e uso

Os direitos do plano (`OrgLicense.entitlements`, definidos por produto na API admin do control plane) são aplicados pelo `PlanLimits`. **Chave ausente no plano = sem restrição**; `-1` = ilimitado; sem licença (instalação legada) nada é limitado.

| Chave | Tipo | Efeito no Fixer |
|---|---|---|
| `users` | limit | só um usuário **novo** entra se couber (usuários ativos); quem já existe sempre entra. Responde 402 `plan_limit_reached` no login |
| `service_orders_per_month` | metered | `POST` de OS responde 402 `plan_limit_reached` quando as ordens do mês (fuso de Brasília) já atingiram o limite |
| `fiscal` | flag | `false` bloqueia as rotas `/fiscal` e `/invoices` com 402 `feature_not_in_plan` (`@RequireFeature('fiscal')`) |

Duas criações simultâneas no último lugar podem passar uma acima do limite; é um limite comercial, sem lock global.

**Uso**: o `UsageReporter` informa, a cada 15 min (`CONTROL_PLANE_USAGE_INTERVAL_MS`), o TOTAL do mês de cada organização com licença (`PUT /v1/usage` do control plane: `users` e `service_orders_per_month`). Idempotente (o último valor vence) e só reenvia quando o valor muda. O backoffice lê em `GET /v1/admin/orgs/{org}/usage`.

## 7. O que NÃO está feito (próximas etapas)

- **Mais direitos**: só `users`, `service_orders_per_month` e `fiscal` são aplicados. Novos limites (ex.: notas fiscais por mês) entram em `plan-limits.service.ts`.
- **Web**: o login já pede `organization:*` (com `KEYCLOAK_ORGANIZATIONS=true`), mas falta o seletor de organização que envia o `X-Org-Id` para quem participa de mais de uma.
- **Infra**: Helm/Terraform ainda descrevem o modelo por oficina (que continua válido como `dedicated`); falta o deploy "compartilhado" (um release, N organizações) e a criação dos papéis de banco por secret.
- **Serviços da plataforma** (`notifications`, `whatsapp`): aceitam `tenant` como texto livre, mas a checagem por `TENANT_SLUG` deles precisa ser relaxada no modo compartilhado.
- **Integridade referencial entre organizações**: as FKs são por `id` (cuid, não adivinhável) e a RLS impede ler ou escrever o que é de outra organização, mas o banco não impede, por constraint, que uma linha referencie o `id` de outra organização. Um FK composto `(orgId, id)` fecharia isso, ao custo de migrar todas as relações.
- **Desempenho**: cada operação simples vira uma mini-transação (`set_config` + consulta). Se virar gargalo, o caminho é dar um escopo de transação por requisição nas rotas de leitura pesada.
