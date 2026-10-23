# Arquitetura

O Fixer é um **produto** da Max Gateway. Os serviços marcados com `[plataforma]` são compartilhados com outros
produtos e vivem em [max-gateway/platform](https://github.com/max-gateway/platform) (padrão em `docs/CONVENTIONS.md`
lá); o Fixer só os consome por URL + chave.

```
 web (3001) ──HTTP──▶ api (3002) ──▶ Postgres (5432)
                       │  │  ▲
                       │  │  └── Keycloak (8180): valida JWT
                       │  ├────▶ plate-lookup (8081) [plataforma] ──▶ Puxa Placa (paga)
                       │  ├────▶ cnpj-lookup (8082)  [plataforma] ──▶ CNPJá (paga)
                       │  └────▶ dfe-gateway (3010)  [plataforma] ──▶ SEFAZ (NF-e: um consumidor por CNPJ)
                       │
                       ├─ outbox ─▶ Redis stream fixer:order-events ─▶ notifications (3005) [plataforma, adaptador] ─▶ e-mail/webhook/WhatsApp
                       │                                                   └────────────────▶ whatsapp (3006) [plataforma, adaptador] ─▶ Meta
                       ◀─ Redis stream fixer:whatsapp-inbound ◀─────────── whatsapp
                       ◀─ Redis stream plate-reader:events ◀────────────── plate-reader (8080) [plataforma]
```

`notifications` e `whatsapp` ainda têm uma cópia legada em `apps/` (a fonte é a plataforma). `control-plane`
(`apps/control-plane`) é do Fixer: provisiona tenants via o Terraform deste repo.

## Regras que valem a pena lembrar

- **Placa é consultada na Puxa Placa uma única vez.** A API guarda o resultado em `PlateLookup`
  e só chama o `plate-lookup` para placas novas (não há TTL). O `plate-lookup` é stateless.
- **NF-e passa pelo `dfe-gateway`.** Ele é o único consumidor da SEFAZ por CNPJ (dois consumidores com o mesmo
  certificado causam bloqueio de 1 h, cStat 656). Em dev local mantenha `FISCAL_SYNC_ENABLED=false` se o gateway
  de produção for dono do CNPJ.
- **Sem dados falsos em runtime.** Testes usam stubs/fixtures; não existe flag de mock nos serviços.
- **Falha cedo.** API valida o env na subida (`apps/api/src/config/env.ts`); o `plate-lookup`
  não sobe sem token. Probes padrão da plataforma: `/healthz` e `/readyz` (a API usa `/health`).
- **Multi-tenant por organização.** Um banco compartilhado; toda tabela de oficina tem `orgId` e Row Level Security (a API conecta com um papel sujeito a RLS, nunca superusuário). A organização vem da participação da pessoa no registro do Fixer (`OrgMembership`, alimentada pelos eventos do control plane), com o token validado pelo `@max-gateway/auth` (audiência da API, vida ≤ 15 min; o claim `organization` nunca concede), ou do dono do token público do portal. Detalhes e o que falta: [docs/specs/multi-tenancy.md](docs/specs/multi-tenancy.md) e [docs/specs/parts-search-integration.md](docs/specs/parts-search-integration.md). Não existe mais instalação dedicada sem plataforma (`DEFAULT_ORG_ID` foi removido); `TENANT_SLUG` ainda filtra eventos de outro tenant.

## Dev local

A infra do Fixer (Postgres, Redis, Keycloak) está em `infra/dev/docker-compose.yml` (projeto `fixer`), com
healthchecks e volumes nomeados (`pgdata`, `redisdata`). `plate-lookup`, `cnpj-lookup` e `plate-reader` são
construídos a partir do clone da plataforma em `MAX_GATEWAY_PLATFORM_DIR` (ver `.env.example`). Os apps Node rodam
no host via Turborepo.
