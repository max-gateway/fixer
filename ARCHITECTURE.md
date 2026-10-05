# Arquitetura

```
 web (3001) ──HTTP──▶ api (3002) ──▶ Postgres (5432)
                       │  │  ▲
                       │  │  └── Keycloak (8180): valida JWT
                       │  └────▶ plate-lookup (8081) ──▶ Puxa Placa (paga)
                       │
                       ├─ outbox ─▶ Redis stream fixer:order-events ─▶ notifications (3005) ─▶ e-mail/webhook/WhatsApp
                       │                                                   └────────────────▶ whatsapp (3006) ─▶ Meta
                       ◀─ Redis stream fixer:whatsapp-inbound ◀─────────── whatsapp
                       ◀─ Redis stream plate-reader:events ◀────────────── plate-reader (8080)
```

## Regras que valem a pena lembrar

- **Placa é consultada na Puxa Placa uma única vez.** A API guarda o resultado em `PlateLookup`
  e só chama o `plate-lookup` para placas novas (não há TTL). O `plate-lookup` é stateless.
- **Sem dados falsos em runtime.** Testes usam stubs/fixtures; não existe flag de mock nos serviços.
- **Falha cedo.** API valida o env na subida (`apps/api/src/config/env.ts`); o `plate-lookup`
  não sobe sem token. `/readyz` (plate-lookup) e `/health` (API) servem de probes.
- **Um tenant por instância.** Eventos de outro tenant vão para a DLQ (`TENANT_SLUG`).

## Dev local

Toda a infra está em `infra/dev/docker-compose.yml` (projeto `fixer`), com healthchecks e
volumes nomeados (`pgdata`, `redisdata`). Os apps Node rodam no host via Turborepo.
