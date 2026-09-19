# Fixer

White-label platform for auto repair shops (oficinas e auto-peças). Each
client runs as an isolated instance — own namespace, own Postgres, own
Keycloak realm — deployed from one shared codebase.

## Layout

- `apps/api` — NestJS backend (not yet scaffolded)
- `apps/web` — Next.js frontend (not yet scaffolded)
- `apps/control-plane` — provisions new tenants (not yet scaffolded)
- `packages/db` — Prisma schema and client, shared by API and control-plane
- `packages/domain` — framework-free business rules
- `packages/ui` — shared, tenant-themeable React components
- `packages/config` — shared tsconfig/lint config
- `infra/helm/fixer-tenant` — one Helm chart, deployed once per client
- `infra/terraform` — platform (EKS/VPC, applied once) + tenant module
  (RDS, namespace, secrets, Keycloak realm — applied once per client)

## Status

Architecture and provisioning path are decided; see the Prisma schema in
`packages/db/prisma/schema.prisma` for the current domain model (users/roles,
customers/vehicles, service orders, parts/services catalogs, stock
movements). Financials and fiscal (NF-e) are intentionally deferred.

No app code has been scaffolded yet — `apps/*` currently hold placeholder
`package.json`s so the Turborepo workspace resolves.
