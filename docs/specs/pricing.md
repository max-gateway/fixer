# Spec — Precificação a partir da nota de compra

Status: **rascunho para revisão (v2: inclui a camada tributária)** · Escopo: `packages/domain` (funções puras), `packages/tax-rules` (tabelas versionadas), `packages/db`, `apps/api` (módulo `pricing`; parser e lançamento de `fiscal-inbound`), `apps/web` (`/notas/[id]`)

> **Esta spec traz regra tributária, mas não é parecer contábil.** O motor é genérico e os parâmetros (alíquotas, listas de NCM/CEST, repartições) são dados que o contador da oficina precisa validar antes de ligar o recurso (§12). Os pontos a conferir na lei estão em §14.

Relacionada: [nfe-import.md](nfe-import.md) §8 (e o parser da §6) (conciliação e lançamento, de onde vem o custo), [multi-tenancy.md](multi-tenancy.md) (RLS por `orgId`), [service-catalog.md](service-catalog.md) §4.3 (dado fiscal da peça).

## Estado da implementação

**Fase 0 implementada (2026-10-13)**, com estas diferenças deliberadas em relação ao texto abaixo:

- O livro de custo e as tabelas de regra vivem em `apps/api/src/fiscal-inbound/tax/` (`cost-ledger.ts`, `rules.ts`, `persist.ts`, `invoice-ledger.ts`, `backfill*.ts`), não em `packages/domain` e `packages/tax-rules`. Só a API usa o cálculo nesta fase; a mudança de pacote acontece na fase 1, quando a web precisar da mesma conta. As funções já são puras e `TAX_RULES_VERSION` já acompanha o resultado.
- `unitCost()` continua em `matching/cost.ts` só como referência dos testes (equivalência com o livro no caso Simples); lançamento e cadastro de peça pelo XML usam o livro.
- A API de detalhe da nota devolve, por item, `cost` (custo por unidade de estoque, componentes e perfil de CFOP) e, na nota, `costAlerts`, `costRegime` e `costRulesVersion`. A tela mostra o custo real em cada item e os avisos.
- Ainda **não** existe: o campo e a rota do "frete por fora" (`extraFreight` já entra no cálculo, falta a tela), a regra interestadual (`InterstateRule`), o snapshot do custo no item (`costSnapshot`) e qualquer coisa de preço de venda (fases 1 em diante).
- O backfill das notas antigas roda uma vez ~60 s depois do boot (`INVOICE_TAX_BACKFILL=off` desliga) e nunca altera `Part.costPrice` de nota já lançada.

**Fase 1 (MVP) implementada (2026-10-13)**, com estas diferenças deliberadas em relação ao texto abaixo:

- **Imposto do Simples por percentuais informados, não por tabela.** Não há `simples-anexo1` nem RBT12 no sistema: nenhum número do Anexo I foi conferido na lei, e o spec manda não embutir alíquota sem validação. O contador informa em Configurações → Precificação a **alíquota efetiva** e quanto dela é ICMS, PIS e COFINS (`TenantTaxProfile`); o sistema só decide **quais parcelas saem** (ICMS-ST já recolhido, PIS/COFINS monofásico). Sem esses números não há imposto calculado nem sugestão (`TAX_UNAVAILABLE`), a menos que a regra traga `taxPctOverride`. A validação fica registrada (`reviewedBy`, `reviewedAt`, exige `fiscal.verify`) e cai sempre que um percentual muda.
- **Enquadramento por evidência do XML** (CST 60/CSOSN 500, `vICMSST`, `vFCPST` e PIS CST 02/03/04), sobrescrito pelo que a pessoa confirma na peça (`fiscal.verify`). Não há tabela de NCM monofásico nem de ST por UF ainda: o imposto fica `ESTIMADO` até a confirmação.
- **Código:** cálculo em `apps/api/src/pricing/` (`pricing.ts`, `sale-tax.ts`, `pricing-plan.ts`), não em `packages/domain`. A web faz só a conta de exibição da margem de um preço digitado; sugestão, alertas e bloqueios vêm sempre da API.
- **Rotas:** `GET /invoices/:id/pricing` (prévia, no lugar de `POST .../preview`), `PUT /invoices/:id/items/:n/pricing` (rascunho), `POST /invoices/:id/confirm-with-pricing` (único caminho que muda preço; o `confirm` de sempre nunca muda), `GET/PUT /pricing/rule`, `GET/PUT /pricing/tax-profile`, `POST /pricing/tax-profile/review`, `PUT /parts/:id/pricing-mode` e `PUT /parts/:id/tax-flags`. Permissões novas: `pricing.read` e `pricing.write`.
- **Lançamento:** com preço, grava `Part.costPrice`, `avgCost` (o custo médio é atualizado em todo lançamento), `sellPrice`, `PartPriceHistory` e o snapshot (`costSnapshot`, `saleTaxSnapshot`, `appliedSellPrice`) numa transação; `BELOW_COST`/`BELOW_COST_AFTER_TAX` recusam a nota inteira (422) e o "estou ciente" vale só para o preço visto (mudar o preço o derruba).
**Fase 2 parcial implementada (2026-10-13):**

- **Regras por escopo** (`rule-resolver.ts`): peça > NCM (prefixo mais longo, aceita NCM com pontuação) > fornecedor > padrão, resolvida **por item**. A exceção herda do padrão o arredondamento e as travas na tela de configuração; a peça é informada pelo SKU e a regra guarda o id. Rotas `GET/PUT /pricing/rules` e `DELETE /pricing/rules/:id` (a padrão não se apaga).
- **Ação em lote** na nota: `POST /invoices/:id/pricing/bulk` com `ACCEPT_SUGGESTIONS` (grava as sugestões como escolha, pulando peças travadas) e `CLEAR_DRAFTS`.
- **Histórico** da peça: `GET /parts/:id/price-history`, mostrado em "Por que esse preço?".
- **Ainda não existe:** reversão de preço no estorno (**o estorno de entrada da nfe-import §8.5 não foi implementado no código**, então não há onde reverter; fica atrelado a ele), tabelas `monofasico-autopecas` e `st-autopecas`, Presumido e Real, `InterstateRule`, rota do "frete por fora", `requirePricing` e `autoPricing`.

## 1. Contexto e problema

Hoje, ao lançar uma nota de compra ([nfe-import.md](nfe-import.md) §8.3), o sistema sobrescreve `Part.costPrice` com o último custo e **nunca mexe em `Part.sellPrice`**. Consequências:

- O preço de venda envelhece sempre que o fornecedor reajusta, e ninguém percebe até a margem sumir.
- Em "Cadastrar peça" ([item-row.tsx](../../apps/web/src/app/(app)/notas/[id]/item-row.tsx)) o preço de venda começa vazio, sem o custo à vista.
- A linha do item mostra só `qtd × preço da nota`. O custo real (com frete, IPI e ST), a variação contra a compra anterior e a margem não aparecem em lugar nenhum.
- Não há histórico: depois do lançamento não dá para saber quanto custava nem por quanto se vendia.

O problema é maior do que a margem: **o custo e o imposto dependem do que está no XML e do regime da oficina**, e o sistema hoje ignora quase tudo isso.

- O parser lê só `vIPI` e `vICMSST` por item ([nfe.parser.ts:147-150](../../apps/api/src/fiscal-inbound/parser/nfe.parser.ts#L147-L150)). Não lê CST/CSOSN, `vFCPST`, ICMS próprio, PIS/COFINS, o CRT do emitente, as UFs nem o grupo IBS/CBS.
- `unitCost()` assume Simples Nacional e **omite o FCP-ST**, então o custo fica subestimado nas UFs que o cobram. Também não rateia frete e despesas informados só no total da nota.
- Para quem não é do Simples, parte do ICMS é crédito e **abate** o custo, o que a fórmula atual não faz.
- Autopeça costuma ter **ICMS-ST** e **PIS/COFINS monofásico**. Nos dois casos o imposto sobre a venda é bem menor que a alíquota cheia (no Simples, a receita é segregada no PGDAS-D). Um preço calculado com a alíquota cheia fica errado para cima, e um sem imposto nenhum fica errado para baixo.
- Há custos que **nem estão no XML**: frete por conta do destinatário (CT-e à parte) e antecipação de ICMS em compra interestadual.

Esta spec acrescenta um passo **Precificar** entre conciliar e lançar: o sistema sugere um preço por regra, mostra o motivo, a pessoa confirma, e o lançamento grava estoque, custo, preço e histórico numa única transação.

## 2. Objetivos e não-objetivos

**Objetivos**
1. Sugerir preço de venda por item a partir do **custo real** e de uma regra configurável.
2. Mostrar custo real, variação contra a compra anterior, preço atual, novo preço e margem, com edição nos dois sentidos (preço ↔ margem).
3. Aplicar os preços **atomicamente com a entrada em estoque**, de forma idempotente.
4. Guardar histórico de custo e preço, com autoria e regra usada, para auditoria e desfazer.
5. Proteger contra erro caro: nunca baixar preço sozinho, limitar variação, exigir ciência abaixo da margem mínima.
6. Calcular o **custo líquido de reposição** a partir de **todos** os campos tributários do XML e do regime da oficina (crédito de ICMS, IPI, ST, FCP-ST, rateios), com cada componente explicável e auditável.
7. Deduzir o **imposto sobre a venda** do preço de forma correta para o item (ST e monofásico), com a evidência e o motivo à vista.
8. Avisar dos custos que o XML **não** traz (frete por fora, antecipação de ICMS) em vez de ignorá-los.

**Não-objetivos (v1)**
- Preço de serviço/mão de obra (`Service.defaultPrice`, `hourlyRate`).
- Apuração de imposto, geração de guia ou preenchimento do PGDAS-D. O motor **estima o percentual** para precificar; quem apura é o contador.
- Emissão fiscal da venda (CST/CSOSN de saída, NFC-e): spec própria (service-catalog §4.3).
- Crédito de PIS/COFINS no Lucro Real (v1 manual) e uso de IBS/CBS no cálculo (v1 só captura; §5.5).
- Preço por canal (marketplace), tabelas de preço por cliente, promoções.
- Precificação por concorrência ou preço de mercado.
- Etiquetas e impressão.
- Categoria de peça como escopo de regra: `Part` não tem categoria hoje (ver §12).
- Reajuste em massa fora da nota (tela de catálogo). A base fica pronta (§9, fase 3).

## 3. Decisões de arquitetura

| # | Decisão | Motivo |
|---|---|---|
| D1 | **Módulo dentro de `apps/api`, não serviço separado** | Os dados (`Part`, `PurchaseInvoiceItem`, `StockMovement`) estão no mesmo banco e sob a mesma RLS. O lançamento precisa gravar custo, preço e histórico na **mesma transação** que o estoque; um serviço à parte trocaria uma transação por consistência eventual num dado financeiro. Não há carga, escala ou ciclo de deploy que justifique a fronteira |
| D2 | Cálculo em **função pura** em `packages/domain` (`suggestPrice`), usada pela API e pela web | O front recalcula ao vivo sem ir ao servidor; o servidor recalcula na confirmação e é a autoridade. Mesmo padrão de [fiscal.ts](../../packages/domain/src/fiscal.ts) e de `unitCost()` |
| D3 | **O sistema sugere, a pessoa confirma.** Nenhum preço muda sem confirmação, exceto no modo automático opt-in (§8.4) | Preço errado é prejuízo silencioso; é o mesmo princípio de D8 do nfe-import |
| D4 | Base de cálculo = **último custo** (reposição). O custo médio ponderado é guardado só para relatório | Em autopeças o preço acompanha a reposição; vender abaixo do custo de repor é perder dinheiro |
| D5 | Regra por **margem sobre a venda** como padrão, com markup equivalente sempre exibido | Margem e markup são confundidos com frequência; mostrar os dois elimina o erro |
| D6 | **O servidor nunca confia no preço enviado pelo cliente para decidir alertas.** Preço final é o enviado, mas margem, variação e bloqueios são recalculados no servidor | Guardas de segurança não podem depender do front |
| D7 | Preço de uma peça com `pricingMode = MANUAL` nunca é sugerido nem alterado pela nota | Preços negociados ou tabelados pelo dono não podem ser pisados |
| D8 | Rascunho de preço fica **no item da nota** (`PurchaseInvoiceItem`), não só no estado do navegador | Recarregar a página, trocar de dispositivo ou voltar amanhã não perde o trabalho |
| D9 | Mesma permissão e mesmo `@RequireFeature('fiscal')` das notas; precificar exige `pricing.write` | Quem concilia nem sempre pode mexer em preço |
| D10 | **Um só livro de custo** (`costLedger`) para o custo exibido e o custo gravado em `Part.costPrice`; substitui `unitCost()` | Duas fórmulas diferentes produzem um preço calculado sobre um custo que o estoque não tem |
| D11 | **Regra tributária é dado versionado** (`packages/tax-rules`), nunca constante no código. Cada preço grava um snapshot com a versão usada | A lei muda (ST por UF, reforma, monofásico); preço antigo precisa continuar explicável e tabela nova não reescreve o passado |
| D12 | **Evidência do XML é sugestão; o enquadramento é do contador.** `Part` guarda a classificação com origem (`XML`/`TABELA`/`MANUAL`); só `fiscalVerified` torna o imposto `CONFIRMADO` | CST e NCM indicam, não decidem; a UI nunca apresenta como certo o que é estimativa |
| D13 | **Capturar tudo o que o XML traz agora**, incluindo o grupo `IBSCBS`, e permitir reprocessar do `xmlGz` | O XML é guardado, mas campo não lido hoje vira migração com backfill amanhã; capturar é barato |
| D14 | **Regime Simples completo na v1**; Presumido com ICMS e alíquotas configuráveis; Real com valores manuais | É a suposição vigente ([nfe-import.md](nfe-import.md) §8.3) e cobre a base de clientes; o resto entra por tabela e configuração, sem mudar o motor |
| D15 | **Motor e fluxo ficam in-process; as tabelas de regra começam como pacote e podem virar serviço depois** (§13) | O cálculo é puro e roda no navegador; o que tem vida própria e é igual para todo tenant é o *dado* da legislação |

## 4. Modelo de dados

Migração **aditiva**: tudo novo é nullable ou tem default. Todas as tabelas têm `orgId` com `DEFAULT app_org()` e política RLS `tenant_isolation`, conforme [multi-tenancy.md](multi-tenancy.md).

### 4.0 Captura tributária do XML

O parser (`ParsedNfeItem`) passa a devolver um objeto `tax` por item e campos de cabeçalho. Tudo continua como **string decimal exatamente como no XML**, sem `Number`.

```prisma
model PurchaseInvoice {
  // existentes ...
  issuerCrt     Int?     // emit/CRT: 1 Simples, 2 Simples (excesso de sublimite), 3 regime normal, 4 MEI
  issuerUf      String?  // emit/enderEmit/UF
  recipientUf   String?  // dest/enderDest/UF
  destIndicator Int?     // ide/idDest: 1 interna, 2 interestadual, 3 exterior
  freightMode   Int?     // transp/modFrete: 0 emitente (CIF), 1 destinatário (FOB), ...
  totals        Json?    // ICMSTot: vProd, vDesc, vFrete, vSeg, vOutro, vICMS, vST, vFCPST, vIPI, vPIS, vCOFINS
  extraFreight  Decimal? // "frete por fora" informado à mão (CT-e à parte); rateado por vProd (§5.1)
}

model PurchaseInvoiceItemTax {
  id        String @id @default(cuid())
  orgId     String @default(dbgenerated("app_org()")) @db.Uuid
  itemId    String @unique
  item      PurchaseInvoiceItem @relation(fields: [itemId], references: [id], onDelete: Cascade)
  indTot    Int?       // 0 = item não compõe o total
  icmsKind  String?    // 'CST' | 'CSOSN'
  icmsCode  String?    // 00, 10, 60, 101, 500 ...
  icmsBase  Decimal?  ; icmsRate Decimal? ; icms Decimal?        // vBC, pICMS, vICMS
  stBase    Decimal?  ; stRate Decimal?   ; icmsSt Decimal?      // vBCST, pICMSST, vICMSST
  fcpSt     Decimal?                                              // vFCPST  (hoje NÃO capturado)
  stRet     Decimal?  ; fcpStRet Decimal?                         // vICMSSTRet, vFCPSTRet
  deson     Decimal?                                              // vICMSDeson
  creditSnRate Decimal? ; creditSn Decimal?                       // pCredSN, vCredICMSSN (emitente Simples)
  ipiCst String? ; pisCst String? ; pis Decimal?                  // PIS: CST 02/03/04 indicam monofásico
  cofinsCst String? ; cofins Decimal?
  ibsCbs    Json?      // grupo IBSCBS por item (NT 2025.002), guardado cru; não entra no cálculo (§5.5)

  @@index([orgId])
}
```

- `PurchaseInvoiceItem.ipi` e `icmsSt` continuam onde estão (compatibilidade); o livro de custo lê de `PurchaseInvoiceItemTax` e cai nos antigos quando a linha não existe.
- **Backfill:** job idempotente que reprocessa `xmlGz` das notas `FULL` sem `PurchaseInvoiceItemTax` e preenche as linhas e o cabeçalho, em lotes e dentro de `TenantContext.run`. Notas já `POSTED` **não mudam** o `costPrice` já gravado: o backfill só alimenta histórico e relatórios, e o custo aplicado antigo permanece como foi lançado.
- **Fixtures de XML:** uma por família (ICMS00/10/20/40/51/60/70/90; ICMSSN101/102/201/202/500/900; IPI tributado e não tributado; PIS/COFINS 01/02/03/04/06/49; nota com frete só no total; nota interestadual com FCP-ST; nota com grupo `IBSCBS`).

### 4.1 Regra de preço

```prisma
enum PricingMethod { MARGIN MARKUP }          // margem sobre a venda | markup sobre o custo
enum PricingScope  { DEFAULT SUPPLIER NCM PART }
enum RoundingMode  { NONE CENTS_90 CENTS_00 MULTIPLE_5 MULTIPLE_10 }

model PricingRule {
  id        String        @id @default(cuid())
  orgId     String        @default(dbgenerated("app_org()")) @db.Uuid
  scope     PricingScope
  scopeKey  String        @default("")      // CNPJ do fornecedor, prefixo de NCM ou partId; "" para DEFAULT
  method    PricingMethod @default(MARGIN)
  value     Decimal                          // % (35 = 35%)
  taxPctOverride Decimal?                    // % de imposto s/ venda definido pela oficina; null = calculado pelo §5.2
  overheadPct Decimal     @default(0)        // % do preço de despesa variável (taxa de cartão...)
  rounding  RoundingMode  @default(CENTS_90)
  minMarginPct Decimal    @default(0)        // abaixo disso o confirmar exige ciência
  maxJumpPct   Decimal    @default(25)       // variação máxima de preço sem confirmação explícita
  createdAt DateTime      @default(now())
  updatedAt DateTime      @updatedAt

  @@unique([orgId, scope, scopeKey])
  @@index([orgId])
}
```

**Precedência** (a mais específica vence): `PART` > `NCM` (o prefixo mais longo vence) > `SUPPLIER` > `DEFAULT`. Se nenhuma regra existe, a oficina não tem sugestão: a UI pede para criar a regra padrão, e o campo de preço continua editável à mão.

### 4.1.1 Perfil tributário da oficina e regra interestadual

```prisma
model TenantTaxProfile {                // singleton por organização, como TenantFiscalSettings
  orgId  String @id @default(dbgenerated("app_org()")) @db.Uuid
  // regime e UF já existem em TenantFiscalSettings (taxRegime, ufCode); aqui só o que falta para precificar
  rbt12                    Decimal?   // receita bruta dos últimos 12 meses (define a faixa do Simples)
  rbt12AsOf                DateTime?  // quando foi informada; a UI avisa quando está velha
  simplesEffectiveRatePct  Decimal?   // alternativa: alíquota efetiva informada pelo contador (substitui a faixa)
  icmsSaleRatePct          Decimal?   // Presumido/Real: ICMS de saída interno
  pisRatePct               Decimal?
  cofinsRatePct            Decimal?
  irpjCsllPresumedPct      Decimal?   // Presumido: carga de IRPJ+CSLL sobre a receita de comércio
  pisCofinsCreditPct       Decimal?   // Real, v1 manual
  requireTaxConfirmation   Boolean @default(false)  // §8
}

model InterstateRule {                   // antecipação/diferencial de ICMS na entrada interestadual; desligada por padrão
  id        String  @id @default(cuid())
  orgId     String  @default(dbgenerated("app_org()")) @db.Uuid
  originUf  String
  ratePct   Decimal                       // % sobre o valor da mercadoria a somar ao custo
  enabled   Boolean @default(false)
  note      String?                       // base legal informada pelo contador
  @@unique([orgId, originUf])
}
```

### 4.2 Alterações em modelos existentes

```prisma
enum PricingMode { AUTO MANUAL }
enum IcmsStStatus { UNKNOWN NOT_ST ST_CHARGED ST_PAID_BEFORE }   // sem ST | ST cobrada na compra | ST já retida antes (CST 60 / CSOSN 500)
enum TaxFlagsSource { XML TABELA MANUAL }

model Part {
  // existentes: costPrice (último custo), sellPrice
  avgCost     Decimal?                       // custo médio ponderado (só relatório; §6.3)
  pricingMode PricingMode @default(AUTO)
  priceHistory PartPriceHistory[]
  // Enquadramento tributário usado para o imposto sobre a venda (§5.2). Sugerido pelo XML, confirmado pelo contador.
  icmsStStatus         IcmsStStatus @default(UNKNOWN)
  pisCofinsMonofasico  Boolean?
  taxFlagsSource       TaxFlagsSource?     // XML | TABELA | MANUAL
}

model PurchaseInvoiceItem {
  // rascunho de precificação (D8); nulos até alguém abrir o passo Precificar
  suggestedSellPrice Decimal?                // o que a regra sugeriu no último cálculo
  draftSellPrice     Decimal?                // o que a pessoa escolheu (null = aceitar a sugestão)
  pricingRuleId      String?                 // regra usada na sugestão
  priceAck           Boolean @default(false) // "estou ciente" de alerta bloqueante
  appliedSellPrice   Decimal?                // preenchido no lançamento (fonte de verdade do que foi aplicado)
  costSnapshot       Json?                   // livro de custo do último cálculo (componentes, versão das tabelas)
  saleTaxSnapshot    Json?                   // perfil de imposto s/ venda do último cálculo
}
```

### 4.3 Histórico

```prisma
model PartPriceHistory {
  id        String   @id @default(cuid())
  orgId     String   @default(dbgenerated("app_org()")) @db.Uuid
  partId    String
  part      Part     @relation(fields: [partId], references: [id], onDelete: Restrict)
  costBefore  Decimal?
  costAfter   Decimal
  sellBefore  Decimal?
  sellAfter   Decimal
  marginAfter Decimal                         // % líquida sobre a venda no momento
  saleTaxPct  Decimal?                        // imposto s/ venda usado
  costBreakdown   Json?                       // componentes do custo (§5.1)
  saleTaxBreakdown Json?                      // componentes do imposto s/ venda e motivos (§5.2)
  taxRulesVersion String?                     // versão de packages/tax-rules usada: reproduz o preço depois
  source    PriceChangeSource                 // INVOICE | MANUAL | AUTO | REVERSAL
  purchaseInvoiceItemId String?
  pricingRuleId String?
  createdById String
  createdAt DateTime @default(now())

  @@unique([purchaseInvoiceItemId, source])   // idempotência do lançamento (como StockMovement)
  @@index([partId, createdAt])
  @@index([orgId])
}
enum PriceChangeSource { INVOICE MANUAL AUTO REVERSAL }
```

> **Complemento (2026-10-19):** toda entrada por nota também grava uma fotografia imutável e completa do lançamento (`StockEntrySnapshot`), com ou sem preço, e os movimentos de estoque passam a ser valorizados. Ver [stock-entry-snapshot.md](stock-entry-snapshot.md).

`@@unique([purchaseInvoiceItemId, source])` impede histórico duplicado se o lançamento for repetido; NULLs são distintos no Postgres, então registros sem nota não são afetados.

## 5. Cálculo (`packages/domain/src/pricing/`)

Tudo aqui é **função pura** sobre `Prisma.Decimal` (4 casas, como `unitCost`), sem I/O, usada pela API e pela web. O cálculo tem três estágios encadeados:

```
XML do item ──► (5.1) livro de custo ──► custo líquido de reposição ─┐
                                                                      ├─► (5.3) preço = f(custo, imposto s/ venda, margem, arredondamento)
cadastro da peça + regime + XML ──► (5.2) perfil de imposto s/ venda ─┘
```

> **Aviso:** esta seção descreve o *motor*. Alíquotas, listas de NCM/CEST e repartições do Simples **não são escritas no código**: vêm de tabelas versionadas (§5.5) que precisam ser validadas por contador antes de a funcionalidade ligar numa oficina (§12). O que está citado abaixo como regra geral foi checado em fontes secundárias; dispositivos exatos estão marcados para conferência em §14.

### 5.1 Livro de custo (o que a nota realmente custou)

`costLedger(item, invoice, settings) → { components[], landedCost, creditable, flags[] }`. Cada componente tem `code`, `amount`, `treatment` e `source` (o campo do XML), para a UI mostrar a cascata e o contador auditar:

| `treatment` | Significado |
|---|---|
| `COST` | Entra no custo da peça |
| `CREDIT` | Tributo recuperável: **abate** o custo |
| `INFO` | Está dentro do preço ou é informativo; não altera o custo, mas é exibido |

**Componentes tirados do XML**

| Componente | Campo | Tratamento |
|---|---|---|
| Produto | `vProd` | `COST` |
| Desconto | `vDesc` (incondicional) | `COST` (negativo) |
| Frete, seguro, outras despesas | `vFrete`, `vSeg`, `vOutro` | `COST`. **Rateio:** se o item traz zero e o total da nota (`ICMSTot`) traz valor, a diferença é rateada entre os itens proporcionalmente a `vProd` e marcada `RATEADO` |
| IPI | `vIPI` | `COST` para revenda em qualquer regime (comércio não recupera IPI; só o industrial ou equiparado) |
| ICMS-ST cobrado na nota | `vICMSST` **+ `vFCPST`** | `COST`. O FCP-ST (fundo de pobreza) vem junto da ST e **hoje não é capturado** (§4.0), então o custo atual está subestimado nas UFs que o cobram |
| ICMS-ST já retido antes | `vICMSSTRet`, `vFCPSTRet` (CST 60 / CSOSN 500) | `INFO`. Não é custo desta compra, mas **afeta a venda**: o ICMS já foi recolhido (§5.2) |
| ICMS próprio do fornecedor | `vICMS` | Depende do **regime do comprador**, ver abaixo |
| ICMS desonerado | `vICMSDeson` | `INFO` |
| PIS / COFINS do fornecedor | `vPIS`, `vCOFINS` | Depende do regime, ver abaixo |
| IBS / CBS (reforma) | grupo `IBSCBS` | **Só capturado e exibido** (§5.5, §14) |

**Crédito conforme o regime do comprador** (`TenantFiscalSettings.taxRegime`):

| Regime | ICMS próprio | PIS/COFINS | v1 |
|---|---|---|---|
| `SIMPLES` | Sem crédito: o valor está dentro do `vProd` (`INFO`) | Sem crédito (`INFO`) | **Completo** |
| `PRESUMIDO` | `CREDIT` = `vICMS` quando a CST dá direito (00, 10, 20, 70, 90 com valor) e o item é revenda. Fornecedor Simples (`CRT` 1/2): crédito só de `vCredICMSSN` (CSOSN 101/201/900) | Sem crédito (cumulativo) | ICMS completo |
| `REAL` | Igual ao Presumido | Crédito depende de regime do fornecedor e de monofásico; **não calculado na v1**: campo manual `pisCofinsCreditPct` + alerta | Parcial |

Se `taxRegime` é nulo, o motor assume `SIMPLES` e a UI mostra o aviso "Regime tributário não informado" (mesma suposição de [nfe-import.md](nfe-import.md) §8.3).

**Custo por unidade de estoque** = `Σ(COST) − Σ(CREDIT)` ÷ `(qCom × unitFactor)`. É o **mesmo** número gravado em `Part.costPrice` no lançamento (§6.2): `unitCost()` de [cost.ts](../../apps/api/src/fiscal-inbound/matching/cost.ts) passa a ser um caso particular do livro de custo (regime Simples, sem FCP-ST) e é **substituído** por ele, para o custo exibido e o custo gravado nunca divergirem.

**Custos que não estão no XML** (o motor detecta a situação e **avisa**; só calcula se houver dado cadastrado):

| Situação detectada no XML | Alerta | Como entra no custo |
|---|---|---|
| `transp/modFrete = 1` (frete por conta do destinatário) | `FRETE_POR_FORA`: o CT-e é um documento à parte | Campo opcional **"frete por fora"** na nota (R$), rateado por `vProd`; `COST` com `source = MANUAL` |
| `ide/idDest = 2` (interestadual), peça de revenda **sem ST cobrada** e comprador no `SIMPLES` ou `PRESUMIDO` | `ANTECIPACAO_ICMS_POSSIVEL`: várias UFs cobram antecipação ou diferencial na entrada | Regra por UF de origem em `InterstateRule` (§4.1.1), **desligada por padrão**. Ligada, vira componente `COST` |
| CFOP fora de revenda (bonificação `x910`, amostra `x911`, remessa para conserto `x915/x916`, consignação `x917`, demonstração `x912`, transferência, entre outros) | `NAO_E_COMPRA_REVENDA` | Item sem sugestão de preço; a pessoa pode forçar |
| `indTot = 0` (item que não compõe o total) | `ITEM_FORA_DO_TOTAL` | Sem sugestão |
| Soma dos itens ≠ totais da nota (`vFrete`, `vSeg`, `vOutro`, `vDesc`) | `TOTAIS_DIVERGENTES` | A diferença é rateada e marcada |

A tabela de perfis de CFOP é **dado versionado** (§5.5), não `if` espalhado.

### 5.2 Perfil de imposto sobre a venda

`saleTaxProfile(part, evidence, settings) → { pct, components[], confidence }`. É o percentual do **preço de venda** que vai para tributo e que o §5.3 deduz antes da margem.

**Evidências por item** (todas vêm do XML da compra, gravadas em §4.0, e podem ser confirmadas na peça):

| Fato | Evidência no XML | Efeito na venda |
|---|---|---|
| **ICMS já recolhido por ST** | CST 10/30/60/70 ou CSOSN 201/202/203/500; `vICMSST`/`vICMSSTRet` > 0; CEST preenchido | Sem ICMS na saída. No Simples a receita é segregada e a parcela do ICMS sai da alíquota efetiva |
| **PIS/COFINS monofásico** | CST PIS 02/03/04 (monofásico) e NCM nos anexos da Lei 10.485/2002 (autopeças) | Revendedor a alíquota zero; no Simples a receita é segregada e as parcelas de PIS e COFINS saem da alíquota efetiva (LC 123/2006, art. 18, §4º-A) |
| Operação normal | Nenhuma das acima | Alíquota cheia |

A evidência do XML é **sugestão**; a decisão de enquadramento é do contador. Por isso `Part` guarda `icmsStStatus` e `pisCofinsMonofasico` com `source` (`XML`, `TABELA`, `MANUAL`), e o perfil só é `confidence = CONFIRMADO` quando `Part.fiscalVerified = true`. Caso contrário o preço mostra o chip **"imposto estimado"** e a alerta explica o motivo.

**Alíquota por regime**

| Regime | Como o `pct` é montado | v1 |
|---|---|---|
| `SIMPLES` | Alíquota efetiva do **Anexo I** (comércio): `(RBT12 × alíquota nominal − parcela a deduzir) ÷ RBT12`, com a faixa pela receita dos últimos 12 meses informada nas configurações (§7.3). Depois, **retira** as parcelas de ICMS (se ST) e de PIS e COFINS (se monofásico) pelas **tabelas de repartição** do anexo | **Completo** |
| `PRESUMIDO` | ICMS de saída (alíquota interna configurável, 0 se ST) + PIS e COFINS cumulativos (0 se monofásico) + IRPJ/CSLL sobre a base presumida de comércio | Alíquotas configuráveis; valores padrão nulos |
| `REAL` | ICMS e PIS/COFINS líquidos de crédito; IRPJ/CSLL incidem sobre o lucro e **não** entram no preço | Manual (percentual informado) |

Cada componente carrega o **motivo em linguagem de balcão**: `ICMS 0%: já recolhido por substituição tributária (CST 60)`, `PIS/COFINS 0%: autopeça monofásica (NCM 8507.10.10)`. É isso que a UI mostra no painel "Por que esse preço?".

**Fora do escopo do perfil:** DIFAL na venda interestadual a consumidor final, ISS (serviço, não peça), e o ICMS de peça vendida dentro de uma OS emitida como NFC-e: a OS usa a mesma peça, mas a emissão tem spec própria (service-catalog §4.3).

### 5.3 Preço (função pura)

```
suggestPrice(cost, saleTaxPct, rule)  →  { price, marginPct, markupPct }

MARGIN:  price = cost / (1 − (value + saleTaxPct + overheadPct)/100)      // exige a soma < 100
MARKUP:  price = cost × (1 + value/100) / (1 − (saleTaxPct + overheadPct)/100)
depois:  price = round(price, rule.rounding)      // CENTS_90: 79,31 → 79,90; sempre para CIMA
```

- `saleTaxPct` vem do §5.2. `PricingRule.taxPctOverride` (§4.1), quando preenchido, **substitui** o percentual calculado (a oficina que prefere "uso 8% e pronto"); a UI mostra então `imposto: 8% (definido por você)`.
- **Arredondamento nunca reduz** o preço abaixo do calculado, para a margem pedida ser garantida.
- `marginPct = (price × (1 − saleTaxPct/100 − overheadPct/100) − cost) / price` é a margem **líquida** real, calculada **depois** do arredondamento. `markupPct = (price − cost)/cost`.
- Custo `null` (quantidade zero) → sem sugestão. Soma de percentuais ≥ 100 → erro de validação.
- **Reverso (edição pelo usuário):** `priceFromMargin` e `marginFromPrice` são as duas pontas da edição bidirecional.
- O resultado leva um **snapshot** (`costBreakdown`, `saleTaxBreakdown`, `taxRulesVersion`) para explicar e reproduzir qualquer preço no futuro (§4.3).

### 5.4 Guardas

Calculadas em `evaluatePrice(...)` e devolvidas como lista de flags:

| Flag | Condição | Efeito no confirmar |
|---|---|---|
| `BELOW_MIN_MARGIN` | `marginPct < rule.minMarginPct` | Exige `priceAck` do item |
| `BELOW_COST` | `proposedPrice < cost` (custo **líquido**) | **Bloqueia**; só libera marcando a peça como `MANUAL` |
| `BELOW_COST_AFTER_TAX` | `price × (1 − saleTaxPct) < cost` | **Bloqueia**: vende por mais que o custo, mas perde dinheiro depois do imposto |
| `BIG_JUMP` | `abs(proposed − current)/current > maxJumpPct` (com preço atual > 0) | Exige `priceAck` |
| `COST_SPIKE` | custo novo > custo anterior em mais de `maxJumpPct` | Aviso |
| `PRICE_DOWN` | `proposed < current` | Aviso; na sugestão automática o preço atual é mantido (§8.4) |
| `LOCKED` | `part.pricingMode = MANUAL` | Sem sugestão |
| `NO_RULE` | nenhuma regra aplicável | Sem sugestão |
| `TAX_UNCONFIRMED` | `saleTaxProfile.confidence = ESTIMADO` | Aviso (chip "imposto estimado"); com `requireTaxConfirmation` (§8) exige `priceAck` |
| `TAX_SETTINGS_MISSING` | Simples sem RBT12 nem alíquota informada | Sem sugestão de imposto; pede configuração |
| alertas do §5.1 | `FRETE_POR_FORA`, `ANTECIPACAO_ICMS_POSSIVEL`, `NAO_E_COMPRA_REVENDA`, `ITEM_FORA_DO_TOTAL`, `TOTAIS_DIVERGENTES` | Aviso; os dois últimos de §5.1 sem sugestão |

### 5.5 Tabelas de regra versionadas

> **Atualização (2026-10-13):** `simples-anexo1`, `monofasico-autopecas` e a transição IBS/CBS já existem em `packages/tax-rules`, transcritas do texto oficial; ver [tax-rules.md](tax-rules.md). Isso substitui a regra de §12/§14 de que o sistema não traz alíquota: o que continua do tenant é RBT12, regime e aceite do contador.

Nada tributário é constante no código. As tabelas ficam em `packages/tax-rules/` (dado + validação + testes), no padrão de [packages/catalog](../../packages/catalog/src/apply.ts) (versão aplicada registrada no banco):

| Tabela | Conteúdo | Fonte a validar |
|---|---|---|
| `simples-anexo1` | Faixas, alíquota nominal, parcela a deduzir e repartição por tributo | LC 123/2006, Anexo I |
| `monofasico-autopecas` | NCMs dos Anexos I e II da Lei 10.485/2002 | Lei 10.485/2002 (texto integral; desdobramentos de NCM seguem o código-pai) |
| `st-autopecas` | Segmento autopeças: NCM + CEST | Convênio ICMS 142/2018, Anexo II. **A lista é autorizativa**: cada UF decide se adere, então vale a UF do comprador |
| `cfop-profiles` | CFOP → `RESALE`, `NOT_RESALE`, `UNKNOWN` e flags | Tabela de CFOP (Ajuste SINIEF 07/2001 e alterações) |
| `cst-credit` | CST/CSOSN → direito a crédito, e se indica ST | Tabelas de CST/CSOSN do leiaute da NF-e |
| `ibs-cbs` | Alíquotas e `effectiveFrom` da reforma | LC 214/2025 e atos posteriores |

Cada tabela tem `version` e `effectiveFrom`; o cálculo escolhe a versão pela **data de emissão da nota** (compra) ou pela data de hoje (preço de venda), e grava a versão usada no snapshot. Uma tabela nova **não reescreve preço antigo**.

**Reforma tributária (IBS/CBS).** O leiaute da NF-e já tem o grupo `IBSCBS` por item (NT 2025.002); em 2026 a obrigação de informar existe, mas a rejeição automática foi adiada sem data na v1.33 da nota técnica, e os efeitos tributários plenos começam em 2027 ([resumo em Contmatic](https://simplifique.contmatic.com.br/blogs/reforma-tributaria-prazos-e-regras-para-nf-e-ate-2027), [SEFAZ-ES](https://sefaz.es.gov.br/Media/Sefaz/Links/Nota%20IBS%20CBS%20Sefaz.pdf); fontes secundárias, a conferir na NT vigente). Decisão: **capturar e guardar desde já** (`ibsCbs Json?` em §4.0, barato e não reprocessável sem o XML), **exibir** como `INFO`, e **não** usar no custo nem no preço até haver tabela `ibs-cbs` validada. Assim a virada de 2027 é uma tabela nova, não uma migração.

## 6. API (`apps/api/src/pricing/`)

```
pricing/
  pricing.module.ts
  pricing.controller.ts    # rotas de regra e de rascunho
  pricing.service.ts       # preview, rascunho, resolução de regra
  rule-resolver.ts         # precedência PART > NCM > SUPPLIER > DEFAULT (função pura, testada)
  price-posting.ts         # chamado pelo lançamento, dentro da transação do estoque
```

### 6.1 Rotas

| Método | Rota | Permissão | O que faz |
|---|---|---|---|
| GET | `/pricing/rules` | `pricing.read` | Lista as regras da oficina |
| PUT | `/pricing/rules/:id` · POST `/pricing/rules` · DELETE | `pricing.write` | CRUD de regra (o padrão não pode ser apagado, só editado) |
| POST | `/invoices/:id/pricing/preview` | `pricing.read` | Calcula, para todos os itens resolvidos, `{ cost, costBreakdown, previousCost, currentPrice, suggestedPrice, margin, markup, flags[], rule }`. **Não grava** |
| PUT | `/invoices/:id/items/:n/pricing` | `pricing.write` | Grava o rascunho do item: `{ sellPrice \| null, ack?: boolean }`. Servidor recalcula flags (D6) |
| POST | `/invoices/:id/pricing/apply-rule` | `pricing.write` | Define um `ruleId` ou parâmetros avulsos e grava o rascunho em todos os itens elegíveis (ação em lote) |
| PUT | `/parts/:id/pricing-mode` | `pricing.write` | `AUTO` ou `MANUAL` |
| PUT | `/parts/:id/tax-flags` | `pricing.write` | Confirma ou corrige `icmsStStatus` e `pisCofinsMonofasico` (`source = MANUAL`) |
| GET/PUT | `/pricing/tax-profile` | `pricing.read` / `pricing.write` | Perfil tributário da oficina (§4.1.1) |
| GET/PUT | `/pricing/interstate-rules` | idem | Regras de antecipação por UF de origem |
| PUT | `/invoices/:id/extra-freight` | `pricing.write` | Informa o frete por fora (R$) e recalcula o rateio |
| GET | `/parts/:id/price-history` | `pricing.read` | Série de custo e preço para o painel lateral |

A resposta de `preview` traz, por item, `costBreakdown[]`, `saleTaxBreakdown[]` e `taxRulesVersion`, para a UI explicar o preço sem recalcular regra no cliente além da função pura. `preview` aceita um corpo opcional `{ overrideRule }` para a UI simular regras sem gravar.

### 6.2 Lançamento (alteração em `nfe-import.md` §8.3)

O `stock-posting.service` ganha **um passo**, dentro da mesma transação:

```
para cada item com resolution ≠ IGNORED:
   ledger = costLedger(item, invoice, settings)            -- §5.1, a MESMA função do preview
   ... (estoque; Part.costPrice = ledger.landedCost, antes unitCost(); avgCost) ...
   final = item.draftSellPrice ?? item.suggestedSellPrice        -- null = não mexer no preço
   se final ≠ null E part.pricingMode = AUTO:
       recalcula flags no servidor; se há flag que exige ack e item.priceAck = false → ABORTA a nota inteira (422, lista os itens)
       se BELOW_COST ou BELOW_COST_AFTER_TAX → ABORTA
       UPDATE Part SET sellPrice = final
       INSERT PartPriceHistory(source=INVOICE, costBefore, costAfter, sellBefore, sellAfter, purchaseInvoiceItemId, costBreakdown, saleTaxBreakdown, taxRulesVersion, ...)
       UPDATE PurchaseInvoiceItem SET appliedSellPrice = final
```

- **Mudança em [nfe-import.md](nfe-import.md) §8.3:** o custo gravado passa a vir do livro de custo (FCP-ST, rateio e crédito por regime). Para Simples sem FCP-ST e sem frete só no total, o resultado é idêntico ao atual; a diferença só aparece onde o custo antigo estava errado. O snapshot (`costSnapshot`) vai no item, então dá para auditar.
- Se as tabelas mudaram entre o `preview` e o lançamento, o servidor recalcula com a versão vigente e, se o preço sugerido mudou, devolve 409 pedindo nova confirmação.
- Mesma idempotência do estoque: o claim `exportStatus='READY'` e o `unique` do histórico.
- **Sem rascunho nenhum** o comportamento é idêntico ao de hoje (preço não muda). A spec é retrocompatível: o passo Precificar é opcional até a oficina ligar `requirePricing` (§8.4).
- `avgCost` é atualizado no mesmo `UPDATE`: `(avgCost × stockQty + custo × qtd) / (stockQty + qtd)`, usando o saldo **antes** da entrada; saldo ≤ 0 → `avgCost = custo`.

### 6.3 Estorno

O estorno de entrada ([nfe-import.md](nfe-import.md) §8.5) passa a também reverter preço: para cada item com `appliedSellPrice`, grava `PartPriceHistory(source=REVERSAL)` e restaura `sellBefore` **só se** `Part.sellPrice` ainda for igual a `appliedSellPrice` (se alguém mudou o preço depois, nada é revertido e o aviso lista as peças). O custo não volta (decisão já existente, nfe-import §8.5); agora o histórico permite ver o valor anterior.

## 7. Interface (`/notas/[id]`)

### 7.1 Fluxo

A tela ganha um passo visível no cabeçalho: **1 Conciliar → 2 Precificar → 3 Lançar**. Notas `READY` mostram "Precificar" como ação primária antes de "Lançar entrada". Pular o passo continua possível (preços não mudam), com um aviso discreto "N peças com custo diferente do preço atual".

### 7.2 Tabela de preços

Tabela densa (não cards), só com itens resolvidos e não ignorados:

| Coluna | Conteúdo |
|---|---|
| Peça | Nome, SKU e origem do vínculo |
| Qtd | Em unidades de estoque (já com o fator) |
| Custo real | Por unidade de estoque; **hover/foco abre a cascata** com cada componente e seu tratamento: `produtos − desconto + frete + IPI (não recuperável) + ICMS-ST + FCP-ST − crédito de ICMS = total ÷ qtd`. Componente rateado ou manual vem marcado |
| Δ custo | Variação contra o custo anterior (`▲ +9,4%`); vermelho acima de `maxJumpPct` |
| Preço atual → Novo preço | Campo editável com máscara de moeda; `—` quando a peça é nova |
| Imposto s/ venda | `4,2%` com ícone de motivo: *ICMS 0% (ST já recolhida) · PIS/COFINS 0% (monofásico)*; chip **"estimado"** até a peça ser confirmada |
| Margem | Líquida (**depois** do imposto); clicar alterna para markup; **editável**: digitar a margem recalcula o preço |
| Estado | Chip: `Sugerido`, `Editado`, `Sem mudança`, `Travado`, `Novo`, `Abaixo da margem`, `Abaixo do custo` |

- **Barra de regra** no topo: regra em uso, arredondamento, "Aplicar a todos" (lote) e filtro "Só mudanças".
- **Rodapé fixo** com o resumo: `N preços mudam · margem média X% → Y% · M alertas` e o botão **"Lançar entrada e atualizar preços"**, que abre o diff antes de confirmar.
- **Faixa de avisos da nota** acima da tabela, só quando há o que dizer: *Frete por conta do destinatário: some o CT-e (campo)*, *Compra interestadual: possível antecipação de ICMS*, *Itens que não são compra para revenda*, *Totais da nota divergem dos itens*, *Regime tributário não informado*. Cada aviso tem a ação ao lado.
- **"Por que esse preço?"** no painel lateral: a conta inteira em ordem (custo por componente → imposto sobre a venda → margem → arredondamento), com a versão das tabelas e o botão **"Confirmar enquadramento desta peça"** (grava `icmsStStatus` e `pisCofinsMonofasico`).
- **Painel lateral** (sheet) por item: série de custo e preço (`GET price-history`), simulador, regra aplicada, botão "Travar preço desta peça" (`MANUAL`).
- **Teclado:** `Tab`/`Enter` avançam entre campos de preço, `↑/↓` mudam de linha, `Esc` descarta a edição da célula; foco visível e `aria-describedby` com o motivo do alerta.
- **Cadastrar peça:** o campo de preço vem pré-preenchido pela regra, com o custo real ao lado.
- **Mobile:** a tabela vira cards empilhados com o preço em destaque.
- Estado de carregamento e de erro seguem o padrão do restante de `/notas`; edição salva ao sair do campo, com indicador "Salvo", e é otimista com reversão em erro.
- **Cores com semântica** (vermelho = abaixo do custo/margem, âmbar = aviso, verde = sugerido) nunca são o único sinal: todo chip tem texto.

### 7.3 Configuração

`/configuracoes/precificacao`: **perfil tributário** (regime, RBT12 com data e aviso de desatualizada, ou alíquota efetiva informada pelo contador; alíquotas do Presumido) e regras interestaduais; e a regra padrão (método, valor, imposto, despesa, arredondamento, margem mínima, teto de variação) com **prévia numérica** ("custo R$ 100,00 → preço R$ 159,90, margem 37,5%") e lista das exceções (fornecedor, NCM, peça).

## 8. Modos e salvaguardas

1. **Padrão (manual):** sugere, a pessoa confirma o passo.
2. **`requirePricing`** (opt-in): o lançamento recusa nota sem precificação confirmada em todos os itens elegíveis.
3. **Sem preço atual (peça nova):** a sugestão é aplicada sem alerta `BIG_JUMP`.
4. **`requireTaxConfirmation`** (opt-in): item com imposto `ESTIMADO` exige `priceAck`; a oficina que trabalha com contador liga isso e passa a confirmar o enquadramento peça a peça.
5. **Modo automático** (`autoPricing`, opt-in, sobre o `autoExport`): ao lançar sozinha, aplica a sugestão **só** quando não há flag de ack nem de aviso de queda, nem `LOCKED`, e o imposto está `CONFIRMADO`; caso contrário a nota **não** é lançada sozinha e fica `READY` aguardando revisão, com o motivo. Preço nunca baixa sozinho (`PRICE_DOWN` mantém o atual).

## 9. Fases de entrega

| Fase | Entrega |
|---|---|
| **0 (pré-requisito, vale sozinha)** | Parser captura todo o `tax` por item e o cabeçalho (§4.0), com fixtures; `PurchaseInvoiceItemTax` e backfill do `xmlGz`; `costLedger` para **Simples** (corrige FCP-ST e o rateio de totais) substituindo `unitCost()` no lançamento; alertas do §5.1 (frete por fora, interestadual, CFOP). Já melhora o custo gravado, antes de existir preço |
| 1 (MVP) | `packages/tax-rules` com `simples-anexo1`, `monofasico-autopecas`, `cfop-profiles`, `cst-credit`; `saleTaxProfile` para Simples (ST e monofásico) e `taxPctOverride`; `suggestPrice` + testes; `PricingRule` (só `DEFAULT`), `PartPriceHistory` com snapshot; `preview`, rascunho e passo no lançamento; tabela de preços com cascata de custo, imposto com motivo, edição bidirecional, flags e diff; configuração do perfil tributário e da regra padrão; confirmação de enquadramento por peça |
| 2 | Escopos `SUPPLIER`/`NCM`/`PART`; ação em lote; `pricingMode`; painel lateral com histórico; `avgCost`; estorno com reversão de preço; `st-autopecas` por UF; Presumido (ICMS de crédito e saída) e Real (manual); regra interestadual (`InterstateRule`) |
| 3 | `requireTaxConfirmation`, `requirePricing` e `autoPricing`; relatório de margem; reajuste em massa; tabela `ibs-cbs` quando as regras de 2027 estiverem validadas; categoria de peça como escopo |
| 4 (condicional, §13) | Extração das tabelas de regra para um serviço na plataforma, se os gatilhos se confirmarem |

## 10. Testes (critérios de aceite)

**Unitários (`packages/domain`, tabela de casos)**
- Margem e markup: `custo 100`, `margem 40%` → `166,67` (antes do arredondamento); `markup 40%` → `140,00`.
- Imposto e despesa: `margem 30% + imposto 6% + despesa 4%` → divisor `0,60`.
- Soma de percentuais ≥ 100 → erro de validação, sem divisão por zero.
- Arredondamento sempre para cima: `79,31` → `79,90`; `79,90` → `79,90`; `79,91` → `80,90` (`CENTS_90`); múltiplo de 5 e 10.
- Margem reportada é calculada **depois** do arredondamento.
- Ida e volta: `marginFromPrice(priceFromMargin(c, m)) ≈ m` dentro do arredondamento.
- Precedência: `PART > NCM (prefixo mais longo) > SUPPLIER > DEFAULT`; sem regra → `NO_RULE`.
- Custo `null` (qtd zero) → sem sugestão.
- Guardas: cada flag da tabela §5.4, incluindo preço atual zero (sem `BIG_JUMP`, sem divisão por zero).

**Unitários — livro de custo e imposto (`packages/domain`, tabela de casos)**
- Simples, item com `vProd 400`, `vDesc 10`, `vFrete 22`, `vIPI 12`, `vICMSST 30`, `vFCPST 4`: custo total `458,00`; dividido por `qCom × fator`. O FCP-ST entra (hoje não entra).
- Frete e despesas só no total da nota: rateio proporcional a `vProd`, soma exata (sem perder centavo; o resto vai para o maior item), componente marcado `RATEADO`.
- Presumido, CST 00 com `vICMS`: `CREDIT` abate o custo. CST 40/41/60: sem crédito. Emitente Simples (`CRT 1`) com CSOSN 101: crédito só de `vCredICMSSN`. Comprador Simples: sem crédito algum.
- CST 60 / CSOSN 500: `vICMSSTRet` é `INFO` e **não** entra no custo, mas marca a peça como `ST_PAID_BEFORE`.
- PIS CST 04 e NCM no anexo monofásico: perfil de venda sem PIS/COFINS; só CST sem NCM na tabela: evidência parcial, `confidence = ESTIMADO`.
- Simples: alíquota efetiva pela faixa do RBT12 (limites de cada faixa, RBT12 no limite exato), retirada das parcelas de ICMS (ST) e PIS/COFINS (monofásico) pela repartição da faixa; sem RBT12 e sem alíquota informada → `TAX_SETTINGS_MISSING`.
- `taxPctOverride` substitui o calculado e é rotulado como "definido por você".
- `BELOW_COST_AFTER_TAX`: preço acima do custo mas abaixo do custo depois do imposto.
- Alertas: `modFrete = 1`, `idDest = 2` sem ST, CFOP `x910`/`x915`, `indTot = 0`, totais divergentes.
- Tabelas versionadas: a versão é escolhida pela data; o snapshot grava a versão; tabela nova não altera preço antigo.
- Propriedade: `costLedger` com regime Simples e sem FCP-ST/rateio é igual ao `unitCost()` antigo (rede de segurança da substituição).

**Parser**
- Cada fixture de §4.0 extrai os campos esperados como string, sem `Number`; CST e CSOSN são distinguidos (`icmsKind`); grupo `IBSCBS` guardado cru; nota sem `imposto` não quebra.
- Backfill idempotente: rodar duas vezes não duplica; nota `POSTED` não tem o `costPrice` alterado.

**Integração (API, no estilo de `invoices.integration.spec.ts`)**
- Lançar com rascunho atualiza `stockQty`, `costPrice`, `avgCost`, `sellPrice`, grava `PartPriceHistory` e `appliedSellPrice` na mesma transação.
- Lançar **sem** rascunho deixa `sellPrice` intacto (retrocompatibilidade).
- Lançar duas vezes em paralelo: um só histórico, um só movimento.
- Falha de um item (ex.: `BELOW_COST`) faz rollback de **toda** a nota: estoque, custo e preço intactos.
- `BELOW_MIN_MARGIN` e `BIG_JUMP` sem `priceAck` → 422 com a lista dos itens; com `priceAck` → passa.
- A API recalcula as flags mesmo que o cliente envie um preço "limpo" (D6).
- Peça `MANUAL` não tem preço alterado nem com rascunho enviado.
- Estorno restaura o preço só se `sellPrice` ainda é o aplicado.
- **RLS:** regra, histórico e rascunho de outra organização são invisíveis e não gravam.
- Permissões: `pricing.write` exigida; usuário sem ela vê a tabela, não edita.

**Web (Testing Library, no estilo de `render.spec.tsx`)**
- Digitar o preço atualiza a margem e vice-versa; alternar margem/markup.
- Cascata do custo abre por hover e por foco de teclado.
- Rodapé reflete contagem de mudanças e de alertas; o diff lista só o que muda.
- Linha `LOCKED` e linha `NO_RULE` não mostram sugestão.
- Navegação por teclado entre campos; chip de alerta tem texto, não só cor.

## 11. Riscos

| Risco | Mitigação |
|---|---|
| Preço errado vai para o balcão sem ninguém ver | Padrão manual (D3), diff antes de confirmar, `BIG_JUMP`/`BELOW_COST`, histórico e estorno |
| Confusão margem × markup produz preço baixo demais | Os dois sempre visíveis; padrão é margem; prévia numérica na configuração |
| Regra mal configurada (soma ≥ 100%) | Validação na gravação da regra e na função pura |
| Custo da nota inflado por erro do fornecedor (ex.: frete duplicado) | `COST_SPIKE` mostra a variação e a cascata de custo explica a origem |
| Concorrência entre dois usuários editando o rascunho | Último a gravar vence por item; `updatedAt` do item vai no `PUT` e conflito devolve 409 com o valor atual |
| Preço manual do dono pisado por uma nota | `pricingMode = MANUAL` (D7) |
| Imposto estimado apresentado como certo | Chip "estimado" até `fiscalVerified`; motivo à vista; `requireTaxConfirmation` (D12) |
| Lista de NCM/CEST desatualizada ou ST diferente por UF | Tabelas versionadas com `effectiveFrom`; `st-autopecas` é por UF e a lista do convênio é autorizativa; enquadramento por peça pode ser corrigido à mão |
| RBT12 velho muda a faixa do Simples e distorce a alíquota | `rbt12AsOf` com aviso de desatualização; alternativa de alíquota efetiva informada pelo contador |
| Custo que o XML não traz (frete por fora, antecipação) fica de fora | Alertas explícitos e campos manuais; nunca somar silenciosamente |
| Trocar `unitCost()` altera custo gravado | Teste de propriedade de equivalência no caso Simples; mudança restrita ao que estava errado; `POSTED` não é reescrito |
| Reforma tributária muda o cálculo em 2027 | Captura do `IBSCBS` agora (D13) e tabela `ibs-cbs` versionada; virada sem migração de dados |
| Regime tributário diferente de Simples | Presumido (ICMS) e Real (manual) só na fase 2; antes disso a UI avisa que o imposto sobre a venda não é calculado |

## 12. Pontos abertos (decidir antes da fase 0/1)

1. **Contador da oficina:** quem valida `simples-anexo1`, o enquadramento monofásico/ST e os CFOP? Sem esse aceite a funcionalidade não liga em produção. Proposta: o aceite fica registrado (quem, quando, versão das tabelas) em `TenantTaxProfile`.
2. **Regime e receita:** `taxRegime` existe, mas o RBT12 não. Quem informa e com que frequência? (Futuro: calcular das vendas do próprio sistema.)
3. **Margem ou markup como padrão da regra?** A spec assume margem (D5).
4. **Categoria de peça:** `Part` não tem. Na v1 o NCM faz esse papel.
5. **Permissões:** `pricing.read`/`pricing.write` são novas; quem tem `invoices.reconcile` recebe `pricing.write`?
6. **Teto de variação** (25%) e **margem mínima** (0%) são palpites; confirmar com quem usa o balcão.
7. **Antecipação de ICMS:** quais UFs de origem a oficina compra com frequência? Define quais `InterstateRule` o contador precisa preencher primeiro.
8. **Frete por fora:** vale puxar o CT-e pelo DF-e (o gateway já distribui outros documentos) em vez de digitar? Fica como evolução.

## 13. O motor tributário merece um serviço independente?

Há três coisas diferentes aqui, e a resposta muda para cada uma.

| Candidato | Serviço próprio? | Por quê |
|---|---|---|
| **Fluxo de precificação** (rascunho, regras da oficina, histórico, lançamento) | **Não** | Ver D1: precisa da mesma transação do estoque, do mesmo banco e da mesma RLS |
| **Motor de cálculo** (`costLedger`, `saleTaxProfile`, `suggestPrice`) | **Não** | É função pura e determinística, em milissegundos, que o navegador executa a cada tecla no campo de preço. Um salto de rede tornaria a edição lenta e criaria um ponto de falha no balcão. Além disso o resultado precisa ser **reproduzível** e gravado junto com o lançamento; um serviço externo vivo é o oposto disso |
| **Tabelas de regra** (NCM monofásico, CEST/ST por UF, Anexo I, perfis de CFOP, futuramente IBS/CBS) | **Sim, mas depois** | É o único pedaço que tem vida própria: igual para todo tenant e todo produto, muda com a legislação em cadência diferente da do código, e exige curadoria. É exatamente o perfil dos serviços de dado de referência da plataforma (`max-gateway/platform`: `cnpj-lookup`, `plate-lookup`), que o Fixer já consome por URL |

**Recomendação: biblioteca agora, serviço de dados de regra quando houver gatilho.**

1. **Agora:** `packages/tax-rules` dentro do monorepo, com **a interface de uma fonte de regras** (`RuleSource.get(table, asOf)`). O motor só conhece a interface. Para a v1 há uma implementação que lê do pacote; trocá-la não toca no cálculo.
2. **Extrair para `services/tax-rules` na plataforma** quando **qualquer** destes gatilhos acontecer:
   - um segundo consumidor precisa das mesmas tabelas (Rocket, ou a emissão de NFC-e/NF-e do próprio Fixer com a spec de emissão);
   - a legislação passa a mudar mais rápido do que o ciclo de release do Fixer (por exemplo, UFs entrando e saindo do protocolo de ST de autopeças), e esperar o deploy vira prejuízo;
   - o contador ou um curador precisa **publicar** correção sem deploy;
   - o volume de tabelas e UFs deixa o pacote pesado para o bundle da web.
3. **Mesmo depois de extrair, o cálculo nunca faz chamada em tempo de execução.** O serviço é **somente leitura** (`GET /v1/rules/:table?asOf=`, com `ETag`, versionado e assinado); o Fixer baixa o *snapshot* para o banco do tenant (`TaxRuleSnapshot`) e calcula localmente. Assim funciona offline, o preço continua reproduzível pela versão gravada, e uma queda do serviço não para o balcão.
4. **O que nunca sai do Fixer:** RBT12, regime, alíquotas da oficina, enquadramento confirmado por peça e o aceite do contador. É dado do tenant, sob RLS.

**Contra-argumento considerado:** "motor tributário é complexo, deveria ser serviço." A complexidade está nos **dados e na curadoria**, não no cálculo, que cabe em poucas funções puras e testáveis em tabela. Separar o cálculo criaria latência e acoplamento sem reduzir a complexidade; separar o dado (quando houver gatilho) reduz.

**Caso diferente, já fora desta spec:** a **emissão** fiscal da venda (CST/CSOSN de saída, assinatura, comunicação com a SEFAZ) é um problema distinto, com certificado e comunicação externa, e é o candidato natural a um serviço de plataforma ao lado do `dfe-gateway`. Se essa spec existir, o `tax-rules` deve nascer junto e servir aos dois.

## 14. Fontes e pontos a conferir na legislação

Verificado só em fontes secundárias nesta rodada; **nenhum item abaixo foi conferido no texto oficial**, e é isso que o contador precisa validar antes da fase 1.

- **Simples Nacional, segregação de receita monofásica e de ST:** LC 123/2006, art. 18, §4º-A, I ([NFe.io](https://nfe.io/blog/?p=14455), [Econet](https://blog.econeteditora.com.br/substituicao-tributaria-e-incidencia-monofasica-de-pis-cofins-preenchimento-no-pgdas-d/), [Agilize](https://agilize.com.br/artigos/?p=3727)). A exclusão do **ICMS-ST** do DAS do comércio depende de LC 123/2006, art. 13, §1º, XIII, "a", e legislação estadual: **conferir**.
- **Autopeças monofásicas:** Lei 10.485/2002, Anexos I e II ([Tributo Devido](https://tributodevido.com.br/portal/tributacao-monofasica-pis-cofins-para-autopecas/)). A lista de NCM vem do texto da lei; desdobramentos de NCM seguem o código-pai (Solução de Consulta Cosit 220/2021, sobre baterias 8507.10.10): **conferir caso a caso**. Os Anexos I e II da lei e o Anexo II da LC 123 **não** apareceram nas fontes lidas.
- **ST de autopeças:** Convênio ICMS 142/2018, Anexo II (segmento de autopeças, NCM + CEST); a lista é **autorizativa por UF** e o CEST é obrigatório na nota mesmo sem ST ([Normas Legais](https://www.normaslegais.com.br/legislacao/convenio-icms-142-2018.htm), [Consulta COPAT 39/2020](https://www.legisweb.com.br/legislacao/?id=395719), [Protocolo ICMS 41/2024](https://netcpa.com.br/colunas/protocolo-icms-no-412024-altera-o-protocolo-icms-no-2208-que-dispoe-sobre-a-substituicao-tributaria-nas-operacoes-com-pecas-componentes-e-acessorios-para-autopropulsados-e-outros-fins/24239)). Há notícia de movimentação de UFs no protocolo ([Confaz exclui São Paulo, 15/09/2026](https://www.substituicaotributaria.com/SST/substituicao-tributaria/noticia/15/09/2026/confaz-exclui-sao-paulo-do-protocolo-icms-de-autopecas)): exemplo de por que a tabela de ST é versionada. **Conferir o texto antes de confiar.**
- **IBS/CBS na NF-e:** NT 2025.002 (grupo `IBSCBS`), v1.33 com a rejeição adiada sem data, v1.34 citada ([Contmatic](https://simplifique.contmatic.com.br/blogs/reforma-tributaria-prazos-e-regras-para-nf-e-ate-2027), [SEFAZ-ES](https://sefaz.es.gov.br/Media/Sefaz/Links/Nota%20IBS%20CBS%20Sefaz.pdf), [NetCPA](https://netcpa.com.br/colunas/notas-fiscais-sem-ibs-e-cbs-serao-rejeitadas-a-partir-de-janeiro-de-2026/25279)). Uma fonte cita o Ato Conjunto RFB/CGIBS nº 4/2026 com destaque obrigatório para não optantes a partir de agosto/2026 ([Tecnospeed](https://blog.tecnospeed.com.br/reforma-tributaria-obrigatoriedade-de-ibs-e-cbs/)); fontes divergem: **checar a NT vigente em nfe.fazenda.gov.br e o ato nos sites da RFB e do CGIBS**.
- **Ainda sem fonte nenhuma:** direito de crédito de PIS/COFINS na compra de monofásico por revendedor do Lucro Real; antecipação de ICMS por UF; base de cálculo e repartição do Anexo I; tratamento de bonificação por CFOP. Ficam como dado a ser preenchido pelo contador, sem valor padrão.
