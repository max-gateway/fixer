# Spec — Fixer sobre a plataforma de catálogo (parts-search)

| | |
|---|---|
| **Status** | **RASCUNHO para revisão.** O Fixer está **em desenvolvimento, sem consumidores**: a integração entra de uma vez, no desenho final, sem modo legado, sem sombra, sem migração de dado de cliente. A **plataforma e a VM estão em produção** (Rocket): o que toca nelas segue com cuidado de produção (§5, §12) |
| **Escopo** | `apps/api` (módulo `catalog-platform`, adoção de `@max-gateway/auth`, publicador de ofertas), `apps/web` (busca de peças), `packages/db` (modelo da peça), `infra/dev` (plataforma local) |
| **Implementa** | `max-gateway/platform` · `docs/specs/catalog-platform.md` §7.1, §7.2, §13.5, G14, G15, G18 · [parts-search-fiscal.md](../../../platform/docs/specs/parts-search-fiscal.md) (branch `docs/parts-search-fiscal`) |
| **Regra** | Uma só forma de fazer cada coisa. Se algo ainda não existe na plataforma, esta spec diz **qual entrega dela libera** e o Fixer espera, em vez de contornar |

> **Base factual.** Fixer lido no código (branch `feat/multi-tenant`, 2026-10-23). Plataforma lida em `origin/feat/parts-search` (`938272a`, v0.4.1) e no `openapi.yaml`. **Não verifiquei em produção:** se as organizações do Fixer existem no registro `tenant_org`, qual realm o Fixer usa fora do dev e se `@max-gateway/auth` já foi publicado no registro de pacotes. Itens assim estão marcados **[verificar]**.

## 1. Problema

1. Cada oficina digita e mantém a **sua** tabela `Part` (nome, SKU, custo, preço, estoque, fiscal, EAN, fornecedor). Não há catálogo compartilhado nem busca central; a mesma peça existe em N cadastros divergentes.
2. A plataforma já tem o cadastro global (287 mil peças), a busca e a oferta por loja, mas o Fixer não a consome: não há cliente, configuração, caminho de rede nem identidade compatível.
3. O Fixer tem a **própria** implementação de autenticação e de resolução de tenant (`AuthService`, `TenantMiddleware`, `resolveOrg`), uma das quatro duplicações que o G18 manda eliminar.

## 2. Objetivos e não-objetivos

**Objetivos**
1. A busca de peças (OS, NF-e, balcão) usa o catálogo, com a identidade do usuário ponta a ponta.
2. `Part` passa a ser **só o privado da oficina**, ligado ao catálogo por `catalogSku`: custo, fornecedor, regra de preço, fiscal privado.
3. Preço de venda, saldo e localização são **oferta** publicada pelo Fixer; o `StockMovement` do Fixer segue como razão autoritativa.
4. Uma só implementação de auth: `@max-gateway/auth`, com a suíte de conformidade no CI.
5. Degradação explícita: plataforma fora do ar **nunca** impede abrir, editar ou faturar uma OS de peça já vinculada.

**Não-objetivos**
- Mudar a regra de custo médio, de precificação ou o motor tributário.
- Edição de catálogo pelo tenant (é proposta, fase P5 da plataforma) e marketplace entre lojas.
- Manter instalação dedicada sem plataforma (§11).

## 3. Decisões

| # | Decisão | Motivo |
|---|---|---|
| I1 | Chamadas à plataforma **com o token do usuário** (propagação) em fluxos de usuário; fluxos sem usuário usam identidade de serviço **com tenant explícito** (§6) | Catalog-platform §7.1 itens 5 e 6; a auditoria registra `user:<sub>@<client>` |
| I2 | O Fixer adota **`@max-gateway/auth`** e **remove** `resolveOrg` e a interpretação de claims. Fica o que é domínio dele: tabela `User`, papéis de negócio, portal público | G18 |
| I3 | Rede: **gateway de borda autenticado** da plataforma (decisão do dono, 2026-10-23). O serviço fica só em loopback e **revalida** o token (confiança zero) | §7.2 item 4; ver §5 |
| I4 | O cliente HTTP é **gerado do `openapi.yaml`** e publicado pela plataforma (`@max-gateway/catalog-client`); sem cliente escrito à mão | Contrato único; quebra detectada no CI dos dois lados |
| I5 | **Um só modelo, sem modo legado.** Sem flag `LOCAL/SHADOW/CATALOG`, sem comparação em paralelo | Sem consumidores não há o que proteger; modos são código a mais e a remover depois |
| I6 | `Part` é a **peça da oficina**: `catalogSku` aponta o catálogo; `NULL` só para **peça que o catálogo ainda não tem** (a proposta de inserção é P5 da plataforma), rotulada na tela | §13.5 do catalog-platform |
| I7 | **Linhas de documento congelam o vendido** (`ServiceOrderPartLine.partName/unitPrice/unitCost`, itens de NF-e já fazem isso). Mudar nome ou preço no catálogo nunca altera documento emitido | Integridade fiscal e histórica |
| I8 | Falha da plataforma → resposta degradada **e rotulada**; nunca dado inventado nem cache apresentado como atual | ARCHITECTURE.md: "sem dados falsos em runtime" |
| I9 | `tenantId` e `storeId` **nunca** vêm de parâmetro livre: saem do contexto validado pelo pacote | §7 |
| I10 | O Fixer **exige** a plataforma. O ramo `DEFAULT_ORG_ID` (instalação dedicada) sai junto com o `resolveOrg`; o pacote de auth não tem essa ponte | Um só caminho; a plataforma suporta tenant dedicado por configuração do lado dela |

## 4. Identidade: adoção do `@max-gateway/auth`

**Hoje:** `TenantMiddleware` valida o JWT, lê o claim `organization` mais `OrgMembership` (alimentada por `identity.member_ready`) e abre o `TenantContext`; `AuthGuard` sincroniza `User`. Organização errada responde 403.

**Alvo:**

| Peça | Como |
|---|---|
| Validação e contexto | `AuthGuard`/`createAuthenticator` do pacote produz o `Principal` `{ userId, clientId, tenantId, storeId, stores, roles, scopes, catalogs }`; `TenantContext` do Fixer é derivado dele. O `TenantMiddleware` atual **é substituído** |
| `TenantDirectory` (porta do pacote) | `membershipsOf` sobre `OrgMembership`; `storesOf` e `catalogsOf` vêm do **registro da plataforma**, sem o Fixer inventar lojas ou catálogos |
| Papel → escopos | Papéis de plataforma (`viewer`, `stockist`, `price_manager`, e os `fiscal_*` da spec fiscal) mapeados dos papéis de negócio do Fixer **num único arquivo**, com teste de que papel desconhecido não concede nada |
| Contrato | Fora do concedido = **404** idêntico ao inexistente (muda de 403); várias organizações sem `X-Org-Id` = 400 |
| Conformidade | `runConformance` no CI do Fixer; divergência quebra o build |

**Pré-condições [verificar]:**
- As organizações do Fixer existem em `tenant_org` com o **mesmo UUID** do control plane (G17).
- Fixer e plataforma usam o **mesmo realm** (`maxgateway`, Organizations ligado). O dev do Fixer usa `fixer-dev` e o chart Helm usa um realm por tenant: ambos passam para o realm único (§20.7 do catalog-platform). O client web tem o audience mapper `parts-search`.
- **Loja:** o Fixer não tem o conceito. Decisão: **uma loja implícita por organização** (`storeId` = id da organização), cadastrada pelo provisionamento.
- Token com vida ≤ 900 s; o proxy do web (`api/[...path]`) já injeta o access token e a renovação precisa manter a janela.

## 5. Rede: gateway de borda autenticado (plataforma, em produção)

Hoje o parts-search escuta só em `127.0.0.1:3500` na VM Oracle e o RUNBOOK §4 proíbe vhost público. **Continua valendo para o serviço**; muda o que fica na frente dele.

```
Fixer API ──HTTPS + Bearer (token do usuário)──▶ Borda da plataforma (TLS, JWT, taxa, allowlist)
                                                   │  repassa o MESMO token + traceparent
                                                   ▼
                                parts-search :3500 (loopback; verifica de novo)
```

| Requisito | Detalhe |
|---|---|
| TLS | Certificado automatizado, TLS ≥ 1.2, HSTS, hostname dedicado |
| Autenticação | Valida assinatura (JWKS), `iss`, `aud=parts-search`, `exp` antes de repassar; token inválido nunca chega ao serviço. O serviço revalida |
| Taxa e cotas | Limite por client e por tenant, concorrência máxima, tamanho de corpo; `429` com `Retry-After` no formato do serviço |
| Rotas | **Lista de permissão** (`/v1/**`); `/metrics`, `/readyz` e administração **não** são expostos |
| Observabilidade | `traceparent`, log sem token, métricas por rota e tenant, alerta de 5xx |
| Resiliência | Timeouts alinhados ao serviço (2 s na busca); sem retry automático em escrita |

**Tecnologia recomendada:** Envoy (`jwt_authn`, rate limit e mTLS nativos, OpenTelemetry, imagem arm64), configuração como código em `infra/prod/platform-edge/` no repositório da plataforma, com teste de configuração no CI. Descartados: nginx (JWT exige módulo extra e a regra ficaria fora do padrão do pacote) e Traefik (JWT é plugin).

**Restrição real da VM, e é a única mudança de produção deste plano:** `rocket_nginx` ocupa `:80` e `:443`.

| Opção | Efeito | Risco |
|---|---|---|
| **E1 (recomendada)**: a borda assume `:443` e roteia por host; o Rocket fica atrás dela em porta interna | Um só ponto de entrada; certificados num lugar | Troca de quem escuta `:443`: janela, paridade de todos os hosts do Rocket provada, rollback pronto (religar o nginx em `:443`) |
| **E2**: host novo como `server` no `rocket_nginx`, que faz proxy para a borda | Não mexe em quem escuta `:443` | Acopla a entrada da plataforma à stack do Rocket (contra §13.1) |

Nada é aplicado antes da decisão do dono e de uma janela.

## 6. Fluxos sem usuário (publicação de ofertas, reconciliação, NF-e em lote)

Processos que atravessam organizações sem usuário na requisição (relay do outbox, sync fiscal, reconciliação) usam identidade de **serviço com tenant explícito** (§7.1 item 6). Hoje a plataforma tem um client por tenant, criado à mão (G11). O publicador de ofertas **só entra** quando o **control plane provisiona** o client por organização (G11) ou quando houver **troca de token** (Keycloak ≥ 26.2). Até lá o Fixer **lê** o catálogo (fluxo de usuário) e **não publica** (§10). Segredo por organização fica no cofre do Fixer, nunca em env ou log, com rotação por dois segredos válidos na janela.

## 7. Contrato necessário da plataforma (o Fixer não contorna)

Para o Fixer funcionar no desenho final, a plataforma precisa entregar, de forma **aditiva** no `v1`:

| # | Entrega | Para quê |
|---|---|---|
| P-1 | `POST /v1/catalogs/{c}/parts:lookup` por lista de `sku` (≤ 100): nome, marca, categoria, GTIN, `etag` | Listar o estoque da oficina com nome do catálogo sem N chamadas; hoje só existe `GET parts/{sku}` |
| P-2 | Consulta por **lista de GTIN** (≤ 100) retornando os `sku` casados (e quantos por GTIN) | Matcher da NF-e e vínculo em lote, sem estourar o limite de taxa |
| P-3 | `@max-gateway/catalog-client` gerado do `openapi.yaml`, publicado por semver | I4 |
| P-4 | Migração `005_fiscal.sql` e rotas fiscais ([spec fiscal](../../../platform/docs/specs/parts-search-fiscal.md), ADR-9 aprovado) | Fixer ler `fiscal:resolve` |
| P-5 | Organizações e lojas do Fixer no registro de tenants; clients de serviço provisionados (G11) | §4 e §6 |
| P-6 | Borda no ar (§5) | Caminho de rede |

## 8. Cliente e módulo `catalog-platform` no Fixer

- **Config (validada no boot, `env.ts`):** `PARTS_SEARCH_URL` (a borda), `PARTS_SEARCH_TIMEOUT_MS` (padrão 2000), `PARTS_SEARCH_CATALOGS`. Ausentes = **API não sobe** (falha cedo, como `KEYCLOAK_*`).
- **Política de chamada** (uma só, no módulo): `AbortController` com o timeout; retry **só em GET**, no máximo 2, com *backoff* exponencial e *jitter*, apenas para `503`/`429` (respeitando `Retry-After`) e erro de rede; nunca em 4xx nem em escrita; **disjuntor** por organização (abre após falhas consecutivas, fecha por sonda); *bulkhead* limitando chamadas simultâneas para a busca não esgotar o pool da API.
- **Erros → usuário** (códigos estáveis): `search_unavailable`/`overloaded` → 503 rotulado "catálogo indisponível"; `rate_limited` → 429; `window_too_deep` → 400; `not_found` → 404.
- **Propagação:** token do usuário e `traceparent` em toda chamada; o token **nunca** é logado; o log leva `tenantId`, rota, status, latência e `requestId` da plataforma.
- **Testes:** a plataforma é **stub nos testes** (nunca flag de mock no serviço); matriz de isolamento com 2 organizações; falhas injetadas (503, 429, timeout, token expirado); testes de contrato contra o `openapi.yaml`.
- **Dev local:** a plataforma sobe pelo `infra/dev` do Fixer a partir de `MAX_GATEWAY_PLATFORM_DIR` (como `plate-lookup` e `cnpj-lookup`), com Keycloak no realm único.

## 9. Modelo de dados (migração única, destrutiva)

Sem dado de cliente, **uma migração nova** (não se edita histórico) leva `Part` ao desenho final:

```prisma
model Part {
  id          String @id @default(cuid())
  orgId       String @default(dbgenerated("app_org()")) @db.Uuid
  // vínculo com o catálogo global; NULL = peça que o catálogo ainda não tem (rotulada na tela)
  catalogSku  String?
  // só para peça sem catalogSku: identificação local mínima. Com catalogSku, nome/marca/GTIN vêm do catálogo.
  localSku    String?
  localName   String?
  // Privado da oficina (§4.4 do catalog-platform: custo, margem, fornecedor ficam no tenant)
  costPrice   Decimal
  avgCost     Decimal?
  supplierName String?
  pricingMode PricingMode @default(AUTO)
  sellPrice   Decimal            // preço de venda: publicado como oferta (§10)
  stockQty    Decimal @default(0) // soma do StockMovement: publicado como oferta (§10)
  // Fiscal privado/derivado: ver fiscal; CFOP/CST/CSOSN somem (tax-engine determina por operação)
  // ...
  @@unique([orgId, catalogSku])   // uma peça da oficina por peça do catálogo
  @@index([orgId])
  @@check: catalogSku IS NOT NULL OR (localSku IS NOT NULL AND localName IS NOT NULL)
}
```

- **Sai do `Part`:** `name`, `sku`, `ean`, `ncm`, `cest`, `originCode`, `unit`, `defaultCfop`, `csosn`, `cst`, `fiscalVerified`, `pisCofinsMonofasico`, `icmsStStatus`, `taxFlagsSource` (classificação passa à plataforma; derivados ao `tax-engine`). Detalhe por campo em [parts-search-fiscal.md](../../../platform/docs/specs/parts-search-fiscal.md) §9. O que depender de P-4 ou do `tax-engine` **só sai quando eles existirem** (a migração final espera por eles; ver §12, fase F).
- **Nome/GTIN de peça vinculada:** lidos do catálogo por `parts:lookup` (P-1) em lote e **sem cache servido como atual**; telas de lista hidratam com um lote por página. Documentos usam o snapshot (I7).
- **Matcher da NF-e (`resolve.ts`):** o contrato de `resolveItems` (puro, sem banco) **não muda**; muda a origem do mapa `partsByEan`, que passa a vir de P-2. O vínculo aprendido `SupplierItemMap(cProd → partId)` segue como primeira regra.
- **Peça nova da oficina:** o fluxo de "criar peça" busca no catálogo primeiro; só sem acerto cria peça local (`catalogSku = NULL`), até a proposta de inserção existir (P5).
- **Seeds e fixtures** de dev e teste passam a usar o catálogo local da plataforma.

### 9.1 Estado da fase M (2026-10-23) e o que mudou em relação ao texto acima

Implementado (`feat/catalog-link`): migração `20261023100000_part_catalog_link` (`catalogSku`, `catalogLinkedAt`, `catalogLinkSource`, único por oficina, CHECK que mantém os três juntos),
`PartCatalogLinkService` e as rotas `POST /parts/from-catalog`, `PUT|DELETE /parts/:id/catalog-link`, `POST /parts/catalog-links/by-barcode` (simula; grava só com `apply: true`) e
`GET /invoices/:id/catalog-suggestions`. Nova permissão `catalog.link`.

Decisões que **refinam** este texto:
- **`Part.name`, `sku` e `ean` ficam** nesta fase, como identificação local e *último nome conhecido*. Remover `name` quebraria o objetivo 5 (a plataforma fora do ar nunca pode impedir abrir ou faturar uma OS): criar a linha da OS precisa do nome sem depender da rede. Eles só saem quando as telas hidratarem o nome do catálogo em lote (P-1) e houver um *último nome conhecido* explícito para o caso de queda.
- **Casamento da NF-e: só em fluxo de usuário.** `matchInvoice` roda dentro da transação do lote da SEFAZ, num job sem usuário, e a plataforma só é chamada com o token da pessoa (§6: não há identidade de serviço por organização ainda). Por isso o catálogo entra como **sugestão** (`catalog-suggestions`), e o casamento automático do lote continua só local. Passa a automático quando existir a identidade de serviço (fase W).
- **Erro de unicidade:** com o cliente de tenant, o `P2002` do Prisma chega com `meta.target` nulo (provado em `part-catalog-link.integration.spec.ts`). O serviço descobre a causa (peça do catálogo já no estoque × SKU repetido) olhando o banco, e nunca depende do formato do erro.

## 10. Escrita: ofertas (bloqueada por §6)

- **Fonte de verdade:** o Fixer. `sellPrice` e `stockQty` (soma do `StockMovement`) são publicados à plataforma; **custo, margem e fornecedor nunca saem** (a plataforma os rejeita).
- **Eventos do Fixer:** o outbox ganha `part.price.changed` e `part.stock.changed`, na **mesma transação** da mudança (padrão do `order-events.ts`). Um publicador consome o outbox e chama a API com `Idempotency-Key` estável (`<eventId>`), `If-Match` no preço e **`stock:reconcile`** no saldo, com `sourceVersion` **monotônico por peça** (sequência do `StockMovement`); versão menor é descartada pela plataforma, o que torna a reordenação segura.
- **Reconciliação** periódica (saldo e preço Fixer × plataforma, por organização): divergência alerta, porque significa evento perdido.
- **Localização:** opcional; o Fixer não tem cadastro de local (decisão do dono, §20.9); fora de escopo aqui.
- `offers:batch` (G7) é aditivo e entra quando existir.

## 11. Instalação dedicada e portal

- **Dedicada sem plataforma:** deixa de existir como modo do Fixer (I10). Se um cliente exigir isolamento, é **tenant dedicado na plataforma** (modelo pooled/silo do §7 item 3 do catalog-platform), não um Fixer sem catálogo.
- **Portal público do cliente** (`/portal/<token>`, `o/[token]`): não chama a plataforma e **não muda**; mantém a credencial própria.

## 12. Entregas e portões (em ordem; cada uma é uma PR com CI verde)

Como o Fixer não tem consumidores, o portão é **teste e revisão**, não métrica de produção. O que toca a produção está marcado **PROD**.

| # | Entrega | Pré-condição | Portão de saída |
|---|---|---|---|
| **E** (**PROD**) | Borda na plataforma (E1 ou E2), TLS, JWT, taxa, allowlist, métricas | Decisão do dono + janela; disco da VM < 70% (G19) | Paridade dos hosts do Rocket provada; rollback exercitado; 401/403/429 corretos; token inválido nunca chega ao serviço |
| **A** | `@max-gateway/auth` no Fixer; remoção de `resolveOrg` e do `DEFAULT_ORG_ID`; papéis → escopos; realm único no dev | Pacote publicado **[verificar]**; organizações no registro e realm único **[verificar]** (P-5) | Suíte de conformidade verde no CI; isolamento com 2 organizações |
| **C** | `@max-gateway/catalog-client` + módulo (config, disjuntor, bulkhead), busca de peças e `PartPicker` no catálogo; plataforma local no `infra/dev` | E, A, P-1, P-3 | Contrato verde contra o `openapi.yaml`; falhas injetadas tratadas; busca ponta a ponta no dev |
| **M** | Migração única do `Part` (§9), `catalogSku`, matcher da NF-e com P-2, seeds no catálogo | C, P-2 | Testes de OS, NF-e e estoque verdes sobre o modelo novo; nenhuma referência às colunas removidas (`grep` e typecheck) |
| **F** | Fixer lê `fiscal:resolve`; saem os campos fiscais derivados do `Part` | ADR-9 aprovado e `005_fiscal.sql` (P-4); `tax-engine` **[não existe]** | Conforme a spec fiscal |
| **W** | Eventos de preço/saldo, publicador, reconciliação | §6 (client por organização ou troca de token) | Divergência 0 em teste de reconciliação; frescor p99 < 10 s medido no dev |

`M` e `A` independem de `E`; `C` precisa de tudo antes. `F` e `W` esperam a plataforma.

## 13. SLOs, observabilidade e operação (metas de projeto; medidas quando houver tráfego)

| SLI | Meta |
|---|---|
| Busca de peça vista pelo usuário (p95) | < 400 ms |
| Disponibilidade da busca | 99,5% (a da plataforma é 99,5% em nó único) |
| Erros 5xx atribuíveis à integração | < 0,5% |
| Divergência de saldo/preço Fixer × plataforma | 0; qualquer divergência alerta |

Métricas por rota e organização (latência, taxa, erro, `Retry-After`), estado do disjuntor, lag do publicador, DLQ. Alertas com runbook: disjuntor aberto > 5 min, *burn rate*, divergência, DLQ > 0, certificado a vencer.

## 14. Segurança e privacidade

- Token do usuário nunca em log, URL ou cache; nenhum segredo de organização em env ou imagem.
- Isolamento provado em CI com 2 organizações (API, banco e erros **idênticos** para "fora do concedido" e "inexistente").
- A borda tem lista de permissão; rotas fiscais e de oferta exigem escopo.
- LGPD: o Fixer só envia o necessário (consulta de busca, GTIN, observações fiscais **sem** CNPJ de fornecedor em claro, conforme a spec fiscal). Retenção e expurgo por tenant seguem o §15 do catalog-platform.
- Cadeia de suprimento: pacotes `@max-gateway/*` fixados por semver e lockfile; `npm audit` e SBOM no CI.

## 15. Riscos principais

| Risco | Mitigação |
|---|---|
| Organizações do Fixer fora do registro / realm diferente | Pré-condição de A **[verificar]**; sem isso a fase A não fecha |
| Troca de `:443` na VM afeta o Rocket **(produção)** | E1 só com janela, paridade provada e rollback pronto; E2 como saída sem tocar `:443`, ao custo do acoplamento |
| Plataforma sem `parts:lookup`/consulta por GTIN | P-1 e P-2 são pré-condição de C e M; o Fixer não usa N chamadas unitárias como contorno |
| Catálogo não cobre peça da oficina | Peça local rotulada (`catalogSku = NULL`), nunca descartada |
| Plataforma em nó único (99,5%) | Disjuntor, rótulo de indisponibilidade e documentos congelados (I7) |
| Publicador sem client por organização | Fase W bloqueada até G11 ou troca de token |
| Disco da VM acima de 70% (G19) | Pré-condição de E |

## 16. Decisões que dependem do dono

1. **E1 ou E2** (§5) e a janela de manutenção da VM (única mudança em produção deste plano).
2. Aprovar o **ADR-9** (fiscal) e o **curador global**.
3. **Loja única implícita** por organização (§4) até haver multi-loja no produto.
4. **Remover a instalação dedicada** como modo do Fixer (I10).
5. **Realm único e login único** para os usuários do Fixer: data (§20.7 do catalog-platform).
6. Prioridade de **P-1 e P-2** (contrato novo) na plataforma, e quem publica o `catalog-client`.
