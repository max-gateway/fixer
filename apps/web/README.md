# @fixer/web

Frontend Next.js (App Router, Tailwind v4) do Fixer.

```bash
npm install
npm run dev --workspace=@fixer/web   # http://localhost:3001
```

## Configuração (runtime)

Lida do ConfigMap/env injetado pelo chart `fixer-tenant` — o mesmo image serve
todos os tenants, então nada disso é `NEXT_PUBLIC_*` fixado no build:

- `TENANT_DISPLAY_NAME`, `BRAND_LOGO_URL`, `BRAND_PRIMARY_COLOR`, `BRAND_SECONDARY_COLOR` Sem nome nem logo definidos, vale a marca do Fixer (`public/logo.png` e `public/icon.png`).
  → `src/lib/branding.ts`, aplicados como CSS vars `--brand-*` no layout.
- `NEXT_PUBLIC_API_URL` → URL da API; acessada server-side via proxy
  `src/app/api/plate-lookup/[placa]` (a API não habilita CORS).

## Telas

- `/` — consulta de placa (`GET /vehicles/plate-lookup/:placa`).

Próximas: login (Keycloak), clientes, ordens de serviço, estoque.
