# Fixer

White-label platform for auto repair shops (oficinas e auto-peças). Each
client runs as an isolated instance — own namespace, own Postgres, own
Keycloak realm — deployed from one shared codebase.

## Começando (dev)

Pré-requisitos: Node 22+, Docker.

```bash
npm ci
cp apps/api/.env.example apps/api/.env                 # ajuste se necessário
cp apps/plate-lookup/.env.example apps/plate-lookup/.env   # preencha PLATE_LOOKUP_PUXA_PLACA_TOKEN
npm run dev        # sobe a infra (Docker) e depois API + web
```

| Comando | O que faz |
| --- | --- |
| `npm run dev` | infra + API (3002) + web (3001) |
| `npm run dev:all` | idem + notifications e whatsapp |
| `npm run infra:up` / `infra:down` | só a infra (Postgres, Redis, Keycloak, plate-lookup) |
| `npm run infra:up -- --profile vision` | inclui o plate-reader (leitura por imagem) |
| `npm run infra:ps` / `infra:logs` | estado e logs da infra |
| `npm run lint` / `typecheck` / `test` | verificações (as mesmas do CI) |

Os dados do Postgres/Redis ficam em volumes nomeados e sobrevivem a `infra:down`
e a reinícios do Docker. Mapa de serviços e portas: [ARCHITECTURE.md](ARCHITECTURE.md).

## Layout

- `apps/api` — NestJS backend (core: OS, clientes, catálogo, placas)
- `apps/web` — Next.js frontend
- `apps/notifications`, `apps/whatsapp` — canais de notificação (e-mail, webhooks, WhatsApp)
- `apps/plate-lookup` — microserviço Python: consulta de placa na Puxa Placa (paga)
- `apps/plate-reader` — microserviço Python: leitura de placa por imagem (OCR)
- `apps/control-plane` — provisiona novos tenants (not yet scaffolded)
- `packages/db` — Prisma schema and client
- `packages/domain`, `packages/ui`, `packages/config` — código compartilhado
- `infra/dev` — docker-compose de desenvolvimento
- `infra/helm/fixer-tenant` — one Helm chart, deployed once per client
- `infra/terraform` — platform (EKS/VPC, applied once) + tenant module
