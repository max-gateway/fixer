# Fixer

White-label platform for auto repair shops (oficinas e auto-peças). Each
client runs as an isolated instance — own namespace, own Postgres, own
Keycloak realm — deployed from one shared codebase.

## Começando (dev)

Pré-requisitos: Node 22+, Docker.

```bash
npm ci
cp apps/api/.env.example apps/api/.env                 # ajuste se necessário
cp .env.example .env                                   # ajuste MAX_GATEWAY_PLATFORM_DIR (clone de max-gateway/platform)
# segredos dos serviços compartilhados: <platform>/services/plate-lookup/.env (PLATE_LOOKUP_PUXA_PLACA_TOKEN) e cnpj-lookup/.env
npm run dev        # sobe a infra (Docker) e depois API + web
```

| Comando | O que faz |
| --- | --- |
| `npm run dev` | infra + API (3002) + web (3001) |
| `npm run dev:all` | idem + notifications e whatsapp |
| `npm run infra:up` / `infra:down` | só a infra (Postgres, Redis, Keycloak, plate-lookup) |
| `npm run infra:up -- --profile vision` | inclui o plate-reader (leitura por imagem) |
| `npm run infra:ps` / `infra:logs` | estado e logs da infra |
| `npm run tunnel` | túnel HTTPS do ngrok para o web (3001), p/ testar no celular |
| `npm run lint` / `typecheck` / `test` | verificações (as mesmas do CI) |

### Testes de integração (Postgres e Redis reais)

Rodam só com variáveis definidas; sem elas ficam ignorados (48 testes). Use um **banco descartável**, nunca o de dev:

```bash
docker exec fixer-postgres-1 psql -U fixer_app -d postgres -c "CREATE DATABASE fixer_itest"
DATABASE_URL=postgresql://fixer_app:password@localhost:5432/fixer_itest npm run migrate:deploy -w @fixer/db
FISCAL_TEST_DATABASE_URL=postgresql://fixer_app:password@localhost:5432/fixer_itest \
WHATSAPP_TEST_REDIS_URL=redis://localhost:6379/15 npm test -w @fixer/api          # integração
DATABASE_URL=postgresql://fixer_app:password@localhost:5432/fixer_itest KEYCLOAK_AUTH_SERVER_URL=http://localhost:8180 \
KEYCLOAK_REALM=fixer-dev npm run test:e2e -w @fixer/api                            # sobe o AppModule inteiro
```

Os testes de integração conectam como `fixer_rls` (papel sujeito a RLS, como em produção); os papéis são criados sozinhos pelo `globalSetup` do vitest
(espelham `infra/dev/rls-roles.sql`). O superusuário `fixer_app` só é usado para preparar e inspecionar: **nunca** use um superusuário como `DATABASE_URL` da API, ele ignora a RLS.
Os testes fiscais apagam as tabelas singleton de credencial e de sync (recusam rodar se já houver credencial). Por isso o banco separado.
O isolamento entre organizações é provado em `apps/api/src/tenancy/isolation.integration.spec.ts`.

### Celular / ngrok

Com `npm run dev` rodando, em outro terminal `npm run tunnel` publica o web em
`https://unturpentined-lichtly-delena.ngrok-free.dev` (domínio fixo da conta). O celular precisa estar
na mesma rede Wi-Fi: API (3002) e Keycloak (8180) são acessados pelo IP da máquina (defina
`DEV_HOST=<ip>` no `.env` da raiz — veja `.env.example`; se o IP mudar, edite só ali, rode
`npm run infra:up` de novo para o Keycloak e reinicie `npm run dev`). Sem `DEV_HOST`, tudo usa `localhost`.
O webhook da Meta (WhatsApp) é outro caso: precisa de um túnel para o serviço `whatsapp` (3006).

Os dados do Postgres/Redis ficam em volumes nomeados e sobrevivem a `infra:down`
e a reinícios do Docker. Mapa de serviços e portas: [ARCHITECTURE.md](ARCHITECTURE.md).

## Layout

- `apps/api` — NestJS backend (core: OS, clientes, catálogo, placas)
- `apps/web` — Next.js frontend
- `apps/notifications`, `apps/whatsapp` — canais de notificação (e-mail, webhooks, WhatsApp)
- plate-lookup, plate-reader, cnpj-lookup, dfe-gateway — **plataforma Max Gateway** ([max-gateway/platform](https://github.com/max-gateway/platform)); o Fixer só os consome por URL
- `apps/control-plane` — provisiona novos tenants (not yet scaffolded)
- `packages/db` — Prisma schema and client
- `packages/domain`, `packages/ui`, `packages/config` — código compartilhado
- `infra/dev` — docker-compose de desenvolvimento
- `infra/helm/fixer-tenant` — one Helm chart, deployed once per client
- `infra/terraform` — platform (EKS/VPC, applied once) + tenant module
