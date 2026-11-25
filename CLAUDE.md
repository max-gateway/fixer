# CLAUDE.md — fixer

Este repositório é um **produto cliente** da Max Gateway. Regras centrais (MAX FIRST, hierarquia reutilizar → estender → abstrair → local → novo serviço, quando parar e pedir aprovação, checklist de qualidade): [CLAUDE.md da plataforma](https://github.com/max-gateway/platform/blob/main/CLAUDE.md). Arquitetura e mapa de serviços: [MAX_ARCHITECTURE.md](https://github.com/max-gateway/platform/blob/main/docs/MAX_ARCHITECTURE.md). Responda e documente em português.

A IA **não decide sozinha** se algo é do produto ou da plataforma quando isso altera a arquitetura: apresenta a decisão e espera aprovação. Se não confirmou no código, diga "a confirmar".

## Papel
Oficina: ordens de serviço, veículos, clientes, oportunidades. `docs`/`ARCHITECTURE.md` do repo descreve o desenho local.

## Use a plataforma
`plate-lookup`, `cnpj-lookup`, `dfe-gateway` (NF-e), `notifications`, `whatsapp`, `plate-reader`, Keycloak (realm `maxgateway`),
control plane para organizações e licença.

## Regras locais
- `apps/notifications` e `apps/whatsapp` são **cópias legadas**: a fonte está em `platform/services/`. Não editar aqui.
- `apps/control-plane` é um stub de provisionamento; o control plane de organizações é o da plataforma. Não criar cadastro de organização paralelo.
- `packages/catalog` × `parts-search`: **a confirmar** o escopo antes de ampliar; preferir o catálogo global.
- Placa consultada uma vez e guardada em `PlateLookup`; NF-e só pelo `dfe-gateway`; sem dados falsos em runtime.
- Multi-tenant por `orgId` com RLS; a API conecta com papel sujeito a RLS, nunca superusuário.
