# Spec — Catálogo de Serviços, Fiscal e Aprendizado de Tempos

Status: **rascunho para revisão** · Escopo: `packages/db`, `apps/api`, `apps/web` (OS), novo `packages/catalog`

## 1. Contexto e problema

Sistemas SQL de oficina costumam misturar produto e serviço num cadastro único. O resultado é um cadastro com campos que só fazem sentido para metade dos registros (NCM em serviço, LC 116 em peça), duplicidade por texto livre ("troca de embreagem" / "trocar kit embreagem") e nenhuma base para estimar tempo ou preço.

O Fixer já separa `Part` e `Service` ([schema.prisma:151-176](../../packages/db/prisma/schema.prisma#L151-L176)). Esta spec **mantém a separação** e resolve o que falta:

| Lacuna atual | Evidência |
|---|---|
| `Vehicle` é texto livre (`brand`, `model`, `year`) | schema.prisma:117 |
| `Service` é só um nome + `defaultPrice`, sem ação/componente, sem fiscal | schema.prisma:166 |
| Linha de serviço guarda só `price`, nunca horas | `ServiceOrderServiceLine` |
| Nada de dados fiscais em `Part` nem em `Service` | — |
| Texto livre e nome interno são o mesmo campo | `serviceName` |

Fatos do ambiente que condicionam o desenho:

- **1 tenant = 1 banco Postgres, sem `tenant_id`** (schema.prisma:1-3). Logo, um "baseline global" **não pode** ser uma linha com `tenantId = null`; precisa ser distribuído como catálogo versionado (§7).
- O plate-lookup já devolve `codigo_fipe`, `anoModelo`, `motor`, `cilindradas`, `combustivel`, `segmento` ([schema.ts](../../apps/api/src/plate-lookup/schema.ts)) e persiste o JSON cru em `PlateLookup.rawResponse`. Dá para normalizar o veículo sem tabela FIPE externa.
- Já existem **outbox** (`OutboxEvent`) e **idempotência de consumo** (`ProcessedInboundEvent`). O aprendizado reutiliza ambos.

## 2. Objetivos e não-objetivos

**Objetivos**
1. Serviço canônico estruturado (ação × componente), sem duplicidade por texto.
2. Dados fiscais corretos e separados: peça → NF-e/NFC-e; serviço → NFS-e.
3. Veículo normalizado em hierarquia (marca → modelo → família → versão).
4. Estimativa de horas por serviço × veículo, **aprendida** das OS concluídas, **idempotente** e com fallback hierárquico.
5. Cold start **sem seed de horas**: enquanto não há histórico, as horas são digitadas manualmente. O catálogo traz só o cadastro (embreagem como primeiro serviço).

**Não-objetivos (v1)**
- Emissão de NF-e/NFS-e (só os **dados** ficam prontos).
- Aprendizado entre tenants (§7.3 descreve a fase futura).
- Precificação por margem/concorrência. Preço = horas × valor-hora, ou valor fixo.
- Importação de tempário comercial (ver §14, decisão aberta).

## 3. Decisões de arquitetura

| # | Decisão | Motivo |
|---|---|---|
| D1 | Manter `Part` e `Service` separados; **sem** tabela única com `type` | Fiscal, estoque e ciclo de vida divergem |
| D2 | `ServiceDefinition` (canônico, global) ≠ `Service` (item vendável do tenant) | Canônico permite aprender; vendável permite preço, nome comercial e itens fora do catálogo |
| D3 | Texto livre **nunca** alimenta aprendizado | Evita ruído; ver §6.2 |
| D4 | Estimativa é **função pura das observações**, recalculada, nunca incrementada | Única forma de ser idempotente |
| D5 | Só aprende de horas **medidas/editadas**, não de valor pré-preenchido aceito | Evita viés de confirmação (§6.3) |
| D6 | Catálogo global versionado em `packages/catalog`, aplicado por seed/migração | 1 banco por tenant |
| D7 | Perfil fiscal do **serviço** é global (LC 116/NBS); parâmetros **municipais** são do tenant | ISS e código de tributação variam por município |

## 4. Modelo de dados

### 4.1 Taxonomia e serviço canônico

```prisma
enum ServiceAction {
  SUBSTITUIR   // remove e instala novo
  REVISAR      // inspeção/ajuste sem troca
  REGULAR
  DIAGNOSTICAR
  LIMPAR
  REPARAR      // conserto sem substituição integral
  INSTALAR
  REMOVER
}

// Árvore de sistemas/componentes: Transmissão > Embreagem > Kit de embreagem
model VehicleComponent {
  id        String  @id @default(cuid())
  code      String  @unique        // "EMBREAGEM_KIT" — estável, usado em seed e integrações
  name      String                 // "Kit de embreagem"
  parentId  String?
  parent    VehicleComponent?  @relation("ComponentTree", fields: [parentId], references: [id])
  children  VehicleComponent[] @relation("ComponentTree")
  definitions ServiceDefinition[]
}

model ServiceDefinition {
  id              String   @id @default(cuid())
  code            String   @unique        // "SUBSTITUIR:EMBREAGEM_KIT"
  action          ServiceAction
  componentId     String
  component       VehicleComponent @relation(fields: [componentId], references: [id])
  nfseTextTemplate String?               // modelo da discriminação da NFS-e
  fiscalProfileId String?
  fiscalProfile   ServiceFiscalProfile? @relation(fields: [fiscalProfileId], references: [id])
  origin          CatalogOrigin @default(GLOBAL)   // GLOBAL | LOCAL
  catalogVersion  String?                          // versão do packages/catalog que a criou
  deprecatedAt    DateTime?

  services     Service[]
  suggestedParts ServiceSuggestedPart[]
  estimates    ServiceEstimate[]
  observations ServiceObservation[]

  @@unique([action, componentId])
}

enum CatalogOrigin { GLOBAL LOCAL }
```

O **nome exibido** (`SUBSTITUIÇÃO - KIT EMBREAGEM`) é derivado de `action` + `component.name`. Não é coluna digitável.

### 4.2 Serviço vendável (evolução de `Service`)

```prisma
model Service {
  // campos existentes: id, name @unique, description, estimatedMinutes, defaultPrice
  definitionId   String?                       // null = serviço avulso, sem aprendizado
  definition     ServiceDefinition? @relation(fields: [definitionId], references: [id])
  pricingMode    ServicePricingMode @default(FIXED)   // FIXED | HOURLY
  isSubcontracted Boolean @default(false)      // terceirizado (retífica, usinagem de volante)
  fiscalProfileId String?                      // override do perfil herdado da definition
}
```

- `estimatedMinutes` passa a ser **fallback** quando não há `ServiceEstimate`; é depreciado após a fase 2.
- Serviço terceirizado tem tratamento fiscal próprio (a oficina é tomadora de NFS-e de terceiro). Só o flag entra na v1; a regra fiscal fica para a emissão.

### 4.3 Perfil fiscal

```prisma
model ServiceFiscalProfile {
  id           String @id @default(cuid())
  code         String @unique          // "LC116_14_01"
  lc116Item    String                  // "14.01"
  nbs          String?                 // código NBS — exigido na NFS-e nacional; default em §4.3.1
  verified     Boolean @default(false) // confirmado por contador; emissão exige true
  cnae         String?
  issWithheld  Boolean @default(false)
  // Alíquota e código de tributação municipal NÃO ficam aqui: dependem do município.
}

// Singleton por tenant (1 banco = 1 oficina)
model TenantFiscalSettings {
  id                  Int  @id @default(1)
  cnpj                String?          // 14 caracteres alfanuméricos, sem máscara; dono do dado (ver nfe-import.md D11/D12)
  legalName           String?
  ufCode              Int?             // cUFAutor (IBGE)
  municipalityIbge    String?
  taxRegime           TaxRegime?       // SIMPLES | PRESUMIDO | REAL
  issRate             Decimal?
  municipalServiceCode String?         // código de tributação municipal padrão
  hourlyRate          Decimal?         // valor-hora de mão de obra
  @@map("tenant_fiscal_settings")
}
```

`Part` ganha colunas **nullable** (obrigatoriedade só quando a emissão for ativada): `ncm`, `cest`, `originCode` (0–8), `defaultCfop`, `csosn`/`cst`, `unit`. Peça e serviço **nunca** compartilham campos fiscais.

**Regra de fronteira (o que é peça e o que é serviço):**

| Caso | Tratamento |
|---|---|
| Item com estoque, NCM, circula como mercadoria (ICMS) | `Part` |
| Mão de obra, diagnóstico, alinhamento | `Service` |
| Material consumido na execução (óleo, aditivo) | `Part` em linha própria da OS |
| Serviço feito por terceiro (retífica) | `Service` com `isSubcontracted` |
| Taxa de descarte, frete | `Service` avulso (`definitionId = null`) |

LC 116 item 14.01 trata o reparo de veículos e **exclui da base do ISS as peças sujeitas a ICMS**, daí a obrigatoriedade de separar documentos.

#### 4.3.1 Defaults fiscais derivados do modelo de negócio (oficina + venda de peças)

Os valores abaixo vêm de pesquisa em fontes secundárias (guias e buscadores de NCM/NBS), **não** das tabelas oficiais. Entram no catálogo como **defaults** com `verified = false`; o contador do tenant confirma uma vez em `TenantFiscalSettings` antes da emissão. O sistema nunca emite com campo `verified = false`.

**Serviço (NFS-e)**

| Campo | Default | Observação |
|---|---|---|
| Item LC 116 | `14.01` | Lubrificação, limpeza, conserto, manutenção e conservação de veículos; exclui peças tributadas por ICMS |
| NBS | `1.2001.31.00` | Manutenção e reparação de veículos automotores rodoviários. Fonte secundária; conferir na tabela de correlação LC 116 × NBS da Receita |
| Retenção de ISS | `false` | Muda se o tomador for PJ em município que exige retenção |
| Alíquota ISS, código de tributação municipal | do tenant | Dependem do município; não têm default global |
| IBS/CBS (`cClassTrib`) | pendente | Tabela vigente: Informe Técnico 2025.002 v1.60 (22/06/2026). Tributação integral pela alíquota padrão é o caso esperado; o código exato e a obrigatoriedade para optantes do Simples durante a transição de 2026 devem ser confirmados antes da fase 4 |

**Peça (NF-e / NFC-e)**

| Campo | Default | Observação |
|---|---|---|
| NCM, CEST, origem | **vêm do XML da NF-e de entrada do fornecedor** | Fonte mais confiável: o fornecedor já classificou. O cadastro de `Part` aceita importar o XML e preencher `ncm`, `cest`, `originCode` e `unit` por item |
| NCM de referência para o catálogo | kit de embreagem: `8708.93.00` | Embreagens e suas partes. Demais categorias de peça ficam sem default; vêm do XML |
| CEST | autopeças: segmento 01; embreagem: `01.075.00` | Convênio ICMS 142/2018, Anexo II. O CEST é informado mesmo onde a UF não aplica ST |
| ICMS-ST | depende da UF | Peça adquirida já com ST recolhida |
| CFOP (venda) | `5.102` venda normal; `5.405` venda de mercadoria adquirida com ST | Se o cliente for de outra UF, os equivalentes `6.xxx` |
| CSOSN (Simples) | `102` normal; `500` quando o ICMS já foi retido por ST | Fora do Simples, usar CST |

**O que isso significa para o sistema**
- `Part` ganha `ncm`, `cest`, `originCode`, `defaultCfop`, `csosn`, `unit`, e `fiscalVerified Boolean @default(false)`.
- O **cadastro de entrada por XML** passa a ser o caminho principal para dados de peça; o default por categoria só serve quando a peça é cadastrada à mão.
- `ServiceFiscalProfile` ganha `verified Boolean @default(false)`. O perfil `LC116_14_01` do catálogo nasce com `nbs = 1.2001.31.00` e `verified = false`.
- Validar o conjunto uma vez com o contador (por tenant ou, melhor, uma vez para o catálogo global e depois só os dados municipais) basta para destravar a emissão. Isso continua sendo a única pendência, e só da fase 4.

### 4.4 Veículo normalizado

```prisma
enum VariantLevel { MAKE MODEL FAMILY VERSION }

model VehicleVariant {
  id        String @id @default(cuid())
  level     VariantLevel
  parentId  String?
  parent    VehicleVariant?  @relation("VariantTree", fields: [parentId], references: [id])
  children  VehicleVariant[] @relation("VariantTree")

  key       String @unique     // determinístico, ver abaixo
  make      String
  model     String?
  engine    String?            // "1.0" (cilindradas normalizadas)
  fuel      String?
  fipeCode  String?            // só em VERSION
  origin    CatalogOrigin @default(GLOBAL)

  vehicles     Vehicle[]
  estimates    ServiceEstimate[]
  observations ServiceObservation[]
}

```

`Vehicle` ganha `variantId String?` (nullable: veículo sem resolução continua funcionando).

**Chave determinística** (`key`), com normalização sem acento, minúscula, `-` como separador:

```
MAKE:    fiat
MODEL:   fiat/palio
FAMILY:  fiat/palio/1.0/flex       (litros arredondados a 1 casa; combustível canônico: "alcool/gasolina" e "flex" viram flex)
VERSION: fipe:001267-0           (codigo_fipe)
```

**Resolução do veículo** a partir do `rawResponse`, em ordem:
1. Há `fipe.dados[].codigo_fipe` **e** motor/combustível → `VERSION` (`fipe:<código>`), sob a `FAMILY`. O ano-modelo não entra na chave: o plate-lookup não informa gerações, então não há como delimitar faixas de ano com segurança.
2. Senão, `marca` + `modelo` + `cilindradas` + `combustivel` → `FAMILY`.
3. Senão, `marca` + `modelo` → `MODEL`. O nome do modelo é a **primeira palavra** do campo `modelo` (o resto é versão), exceto os modelos de várias palavras listados em `multiWordModels` no catálogo ("grand siena").
4. Senão, `marca` → `MAKE`.
5. Senão, `variantId = null` (sem aprendizado, sem estimativa específica).

Implementação: `resolveVariantChain` em `packages/domain` (função pura) e `VehicleVariantsService` em `apps/api`, que cria os nós ausentes com `upsert` de `update` vazio (nunca altera nó existente) e é chamado na criação da OS.

A resolução é **pura e determinística** (mesmo JSON → mesma variante) e grava `variantResolution` (`FIPE | FAMILY | MODEL | MAKE | NONE`) para auditoria. Nós `VERSION`/`FAMILY` ausentes são **criados localmente** (`origin = LOCAL`) a partir do lookup, sempre ligados ao pai correto; assim a árvore cresce com o uso.

### 4.5 Linha de serviço, observação e estimativa

```prisma
model ServiceOrderServiceLine {
  // existentes: id, serviceOrderId, serviceId, serviceName (snapshot), price, createdAt
  description     String?          // texto livre → discriminação da NFS-e; NUNCA aprendido
  hoursEstimated  Decimal?         // snapshot da estimativa exibida no orçamento
  hoursEstimateSource EstimateSource?  // LEARNED | REFERENCE | MANUAL | NONE
  hoursActual     Decimal?         // preenchido na conclusão
  hoursActualSource HoursSource?   // MEASURED | EDITED | ACCEPTED_DEFAULT
  variantId       String?          // snapshot do veículo no momento da execução
  variantResolution VariantResolution?
  observation     ServiceObservation?
}

model ServiceObservation {
  id                  String @id @default(cuid())
  serviceLineId       String @unique            // ← idempotência por construção
  serviceDefinitionId String
  variantId           String                    // nó mais específico conhecido
  hoursActual         Decimal
  weight              Decimal @default(1)       // 1 medido/editado; 0.25 aceito sem edição
  observedAt          DateTime
  excluded            Boolean @default(false)   // outlier marcado manualmente
  excludedReason      String?
  @@index([serviceDefinitionId, variantId])
}

// LEARNED: nó com n ≥ N_MIN, pré-preenche. REFERENCE: 1 ≤ n < N_MIN, só exibe, não pré-preenche.
// MANUAL: usuário digitou. NONE: sem histórico.
enum EstimateSource { LEARNED REFERENCE MANUAL NONE }

model ServiceEstimate {
  id                  String @id @default(cuid())
  serviceDefinitionId String
  variantId           String
  hoursMedian         Decimal
  hoursP25            Decimal
  hoursP75            Decimal
  sampleCount         Int                       // nº de observações efetivas (soma de pesos arredondada)
  computedAt          DateTime
  inputsDigest        String                    // hash dos ids+horas+pesos das observações usadas
  @@unique([serviceDefinitionId, variantId])
}

model ServiceSuggestedPart {
  id                  String @id @default(cuid())
  serviceDefinitionId String
  variantId           String?        // null = vale para qualquer veículo
  partCategory        String         // "DISCO_EMBREAGEM"; casa com Part por categoria/SKU no tenant
  quantity            Decimal @default(1)
  optional            Boolean @default(false)
}
```

## 5. Estimativa de horas (leitura)

Dada uma `ServiceDefinition` `D` e o veículo da OS (variante `V`):

1. Monta a cadeia: `VERSION → FAMILY → MODEL → MAKE`.
2. Percorre da ponta mais específica; escolhe o **primeiro nó com `sampleCount ≥ N_MIN`** (padrão `N_MIN = 3`) → `source = LEARNED`.
3. **Encolhimento (shrinkage)** em direção ao pai que também tenha estimativa, para não oscilar com amostra pequena:
   `h = (n · h_nó + k · h_pai) / (n + k)`, com `k = 3`. Sem pai com estimativa, usa o valor do próprio nó.
4. Se nenhum nó chega a `N_MIN`, mas algum tem `1 ≤ n < N_MIN`, devolve o mais específico como `source = REFERENCE`: **exibido** ("1 serviço semelhante: 4,5 h"), **não pré-preenchido**.
5. Sem nenhuma observação na cadeia → `source = NONE`: campo de horas vazio, entrada manual.
6. Retorna `{ hours, p25, p75, source, level, sampleCount }`. A UI mostra a **faixa** e a origem ("baseada em 12 serviços" / "referência: 1 serviço" / "sem histórico, informe as horas").

Não há valores iniciais: tudo o que aparece veio de OS concluídas da própria oficina.

## 6. Aprendizado

### 6.1 Fluxo

```
OS → COMPLETED
  └─ outbox: service_order.completed
       └─ consumidor learning (dedup por ProcessedInboundEvent)
            ├─ para cada linha com definitionId e variantId:
            │     upsert ServiceObservation por serviceLineId   (idempotente)
            └─ para cada (definitionId, nó) afetado e ancestrais:
                  recompute ServiceEstimate                      (função pura)
```

Cada observação conta para o seu nó **e para todos os ancestrais** (VERSION, FAMILY, MODEL, MAKE), o que alimenta o fallback.

### 6.2 Texto livre

- Texto digitado no campo `description` vai para a NFS-e e **não** vira observação.
- Linha sem `definitionId` não gera observação.
- Para ajudar a classificar: ao digitar um serviço avulso, um classificador (embedding ou LLM) **sugere** a `ServiceDefinition`; o atendente confirma. Só a confirmação liga `definitionId`. Sugestão aceita é registrada para medir precisão.

### 6.3 Qualidade das horas

Quando a estimativa é `LEARNED`, a UI pré-preenche `hoursActual`. Aceitar o valor sem mexer **não é medição**. Quando é `REFERENCE` ou `NONE`, nada é pré-preenchido e o valor digitado é sempre `EDITED`.

| `hoursActualSource` | Origem | `weight` |
|---|---|---|
| `MEASURED` | cronômetro/apontamento do mecânico na OS (reservado, fora da v1; ver §14) | 1.0 |
| `EDITED` | usuário alterou o valor | 1.0 |
| `ACCEPTED_DEFAULT` | usuário confirmou o pré-preenchido | 0.25 |

Sem esse peso, o sistema se retroalimentaria: aceitar a própria estimativa reforçaria a estimativa.

### 6.4 Recompute (função pura)

Entrada: observações do nó **e dos descendentes**, com `excluded = false`.

1. Remove outliers por MAD: descarta `|x − mediana| > 3 · 1.4826 · MAD` (só com `n ≥ 5`).
2. Mediana ponderada e p25/p75 ponderados.
3. `sampleCount = round(Σ pesos)`.
4. `inputsDigest = sha256(ordenado(id:horas:peso))`. Se igual ao armazenado, **não grava** (evita churn).
5. Grava em transação com `SELECT ... FOR UPDATE` no registro `(definição, variante)`.

**Garantias de idempotência**
- Reprocessar o mesmo evento: `ProcessedInboundEvent` descarta; e mesmo que passasse, `unique(serviceLineId)` impede observação duplicada.
- Rodar o recompute N vezes: resultado idêntico (função pura + `inputsDigest`).
- Reabrir/cancelar OS concluída: a observação é marcada `excluded = true` e o nó recalculado.
- **Rebuild total** (`learning:rebuild`) apaga `source = LEARNED` e reconstrói só das observações. Serve de teste e de recuperação.

### 6.5 Proteções

- **Limites de sanidade**: rejeita horas `≤ 0` ou `> 4 × p75` do pai (com `n_pai ≥ 5`); a linha fica registrada, mas `excluded = true` com motivo.
- **Atribuição de OS multi-serviço**: se uma OS tem vários serviços, as horas reais são apontadas **por linha**; não se divide tempo total automaticamente.
- **Catálogo**: nova versão do `packages/catalog` nunca toca observações nem estimativas; elas só existem localmente.

## 7. Catálogo global (`packages/catalog`)

### 7.1 Conteúdo

```
packages/catalog/
  data/
    components.json          # árvore VehicleComponent
    service-definitions.json # ações × componentes + fiscalProfile + nfseTextTemplate
    fiscal-profiles.json
    variants/*.json          # MAKE/MODEL; FAMILY/VERSION nascem localmente
    suggested-parts.json
  src/apply.ts               # aplicação idempotente
  CHANGELOG.md
  package.json               # "version" = catalogVersion
```

### 7.2 Aplicação

- Roda no **provisionamento do tenant** e a cada **upgrade** (migração de dados).
- Upsert por `code`/`key`. Linhas `origin = LOCAL`, observações e estimativas nunca são tocadas.
- Remoção de definição global = `deprecatedAt`, nunca `DELETE` (há linhas de OS referenciando).
- Registra `catalogVersion` aplicada em tabela `CatalogState` (singleton).

### 7.3 Fase futura: aprendizado entre tenants

Só com serviço central e **opt-in**: tenants enviam agregados (nunca OS), com *k-anonimato* (nó só entra no baseline com ≥ K oficinas distintas). O resultado voltaria como um novo arquivo de estimativas no catálogo (hoje inexistente). Fora do escopo da v1; o modelo atual já é compatível.

## 8. Cadastro inicial: embreagem (sem horas)

**Componentes**: `TRANSMISSAO > EMBREAGEM > EMBREAGEM_KIT` (e `EMBREAGEM_ATUADOR`, `EMBREAGEM_VOLANTE_BIMASSA` como folhas).

**Definição**: `SUBSTITUIR:EMBREAGEM_KIT`, perfil fiscal `LC116_14_01`, template NFS-e: *"Substituição do kit de embreagem (disco, platô e rolamento) – {veículo} placa {placa}"*.

**Horas**: nenhuma. A primeira OS de embreagem de cada veículo tem as horas digitadas; o sistema passa a sugerir a partir da terceira observação num nó da cadeia (§5).

**Peças sugeridas**: disco de embreagem, platô, rolamento de embreagem (obrigatórios); atuador/cilindro e fluido (opcionais); volante bimassa **condicional** por variante (só onde o catálogo marcar).

**Variantes mínimas do catálogo**: MAKE/MODEL dos modelos de maior volume (Palio, Uno, Gol, Onix, HB20, Strada, Hilux…), sem atributo de tração. O exemplo `fiat/palio` com família `1.0 flex 2012–2017` entra como caso de teste canônico.

## 9. Fluxos de UI/API

**Criar item na OS** (`/ordens/nova`):
1. Placa → plate-lookup → resolve `variantId` (§4.4).
2. Busca de serviço por texto: primeiro `ServiceDefinition`/`Service` do tenant; se não achar, oferece "serviço avulso" + sugestão de definição (§6.2).
3. Ao escolher, exibe a **faixa de horas** com a origem (`LEARNED` pré-preenche; `REFERENCE` só mostra; `NONE` pede as horas); preço = `horas × hourlyRate` (modo `HOURLY`) ou `defaultPrice` (modo `FIXED`).
4. Peças sugeridas aparecem como botão "adicionar kit".

**Concluir serviço**: campo de horas reais, obrigatório para linhas com `definitionId` (pré-preenchido só se `LEARNED`). Cronômetro fica fora da v1.

**Endpoints**

| Método | Rota | Função |
|---|---|---|
| GET | `/service-definitions?q=` | busca canônica |
| GET | `/services/:id/estimate?vehicleId=` | estimativa + cadeia usada |
| POST | `/service-lines/:id/hours` | registra `hoursActual` + `source` |
| GET | `/service-definitions/suggest?text=` | sugestão a partir de texto livre |
| POST | `/admin/learning/observations/:id/exclude` | exclui outlier |
| POST | `/admin/learning/rebuild` | rebuild a partir das observações |

## 10. Migração dos dados existentes

1. Migration aditiva: novas tabelas e colunas nullable. Nada é removido.
2. `Service` existente → `definitionId = null` (avulso). Um comando `catalog:match-existing` tenta casar `Service.name` com definições (fuzzy + revisão humana) e liga as aprovadas.
3. `Vehicle` existente → job `vehicle:resolve-variants` usa `PlateLookup.rawResponse` já armazenado (sem nova consulta paga).
4. OS antigas **não** geram observações (não têm `hoursActual`).
5. `Service.estimatedMinutes` mantido até a fase 2.

## 11. Fases de entrega

| Fase | Entrega | Pronto quando |
|---|---|---|
| 1 | Schema + `packages/catalog` + cadastro da embreagem + resolução de variante | catálogo aplicado em tenant limpo e em tenant com dados; teste canônico do Palio passa |
| 2 | Captura de horas + observações + estimativa na OS | OS concluída gera observação; UI mostra faixa e origem; `NONE` exige entrada manual |
| 3 | Recompute, fallback, rebuild, painel de outliers | testes de idempotência e rebuild verdes |
| 4 | Fiscal: `TenantFiscalSettings`, campos de `Part`, validações | dados completos para um emissor externo consumir |
| 5 | Sugestão por texto livre (classificador) | precisão medida ≥ meta definida |

**Status da implementação** (atualizado em 2026-10-11)

| Fase | Estado | Onde |
|---|---|---|
| 1 | Feita (migration não aplicada em banco real) | `packages/db` (migration `20261011100000_service_catalog`), `packages/catalog`, `packages/domain/src/vehicle-variant.ts`, `apps/api/src/vehicle-variants` |
| 2 | API feita; **falta a UI** (campo de horas na OS e na conclusão) | `apps/api/src/service-orders` (`recordHours`, snapshot na criação, bloqueio ao concluir sem horas) |
| 3 | Feita | `packages/domain/src/estimate.ts`, `apps/api/src/learning` (recompute, `inputsDigest`, exclusão, rebuild; endpoints `admin/learning/*` exigem a permissão `learning.manage`, que ainda precisa ser concedida a um papel) |
| 4 | Feita, exceto o preenchimento de peça por XML de compra (entregue por [nfe-import.md](nfe-import.md)) e a emissão em si | `packages/domain/src/fiscal.ts` (validadores puros), `apps/api/src/fiscal-settings` (configurações fiscais, edição e confirmação de peça/perfil, `GET service-orders/:id/fiscal-readiness`). Edição de dado fiscal desfaz a confirmação; confirmar exige dados completos. Rotas de escrita exigem `fiscal.manage` / `fiscal.verify`, ainda não concedidas a nenhum papel |
| 5 | Não iniciada | — |

Desvios em relação ao texto acima: a observação é gravada na transição para `COMPLETED`, dentro da mesma transação (não via consumidor do outbox), porque a máquina de estados atual não permite cancelar uma OS concluída; o teste "cancelar OS concluída" de §12 não se aplica enquanto isso for verdade.

## 12. Testes (critérios de aceite)

**Idempotência (críticos)**
- Entregar o mesmo `service_order.completed` 2× → 1 observação, estimativa idêntica.
- Rodar recompute 5× → `inputsDigest` e valores iguais, 0 escritas após a primeira.
- `learning:rebuild` produz estimativas **iguais** às incrementais (comparação campo a campo).
- Cancelar OS concluída → observação excluída → estimativa volta ao valor sem ela.

**Estimativa**
- Palio 1.0 2015 com 0 obs. na cadeia → `source = NONE`, campo vazio, sem erro.
- Com 1 obs. no `MODEL` e 0 na `FAMILY` → `source = REFERENCE`, exibe e **não** pré-preenche.
- Com 2 obs. na `FAMILY` (< `N_MIN`) e 5 no `MODEL` → usa o `MODEL` como `LEARNED`.
- Com 8 obs. → `source = LEARNED`, shrinkage aplicado, faixa p25–p75 coerente.
- Outlier (40 h numa embreagem) → excluído com motivo, não altera mediana.
- `ACCEPTED_DEFAULT` repetido 50× não desloca a estimativa além do esperado pelo peso 0.25.

**Veículo**
- Mesmo JSON de lookup → mesma `key` (determinismo).
- JSON sem FIPE → desce para FAMILY/MODEL; sem `marca` → `NONE` sem erro.
- Ano fora de qualquer `FAMILY` → cria FAMILY local, pai correto.

**Catálogo**
- Aplicar o catálogo 2× → sem diferenças.
- Upgrade não altera observações, estimativas nem `origin = LOCAL`.

**Fiscal**
- Serviço sem perfil e emissão ativa → bloqueia com erro claro; peça sem NCM idem.

## 13. Riscos

| Risco | Mitigação |
|---|---|
| Arranque lento (muitas OS manuais no início) | `REFERENCE` mostra o que já existe; UI deixa claro "sem histórico, informe as horas" |
| Horas digitadas sem cuidado contaminam a base | Outliers por MAD, limites de sanidade, painel de exclusão (§6.5) |
| Mecânico não preenche horas | Horas obrigatórias para linhas com `definitionId` ao concluir; sem horas não há observação |
| Resolução errada de variante | Grava `variantResolution`; nível raso aprende menos, mas não contamina o específico |
| Dado fiscal incorreto | Códigos validados com contador; campos nullable até ativar emissão |
| Explosão de variantes locais | Criação só a partir de lookup real; chave determinística evita duplicata |
| Taxonomia crescer sem controle | Componentes só entram pelo catálogo versionado; `LOCAL` exige aprovação |

## 14. Decisões tomadas

Revisáveis, mas a implementação segue estas até alguém contestar.

| # | Questão | Decisão | Motivo |
|---|---|---|---|
| 1 | Fonte do seed de horas | **Sem seed.** Sem histórico, as horas são digitadas manualmente (`source = NONE`). Tempário licenciado, se um dia for usado, entra como nova fonte sem mudar o schema de observações | Elimina valores iniciais que ninguém validou; todo dado do sistema vem de OS reais da oficina |
| 2 | Quem define `drivetrain` | **Removido.** Sem seed por classe de tração, o atributo não é necessário | Menos curadoria e menos schema |
| 3 | Cronômetro | **Fora da v1.** Horas reais são digitadas na conclusão (pré-preenchidas só quando `LEARNED`). Valor `MEASURED` do enum fica reservado | Hoje não há apontamento de tempo na OS; a v1 aprende de `EDITED` (peso 1.0) e `ACCEPTED_DEFAULT` (0.25) |
| 4 | Granularidade fiscal | **Simples Nacional primeiro**, município configurável em `TenantFiscalSettings`. `TaxRegime` já aceita PRESUMIDO/REAL, mas só Simples é validado e testado na fase 4 | Regime mais comum em oficinas pequenas; evita construir regra que ninguém usa ainda |
| 5 | Nível `FAMILY` | **Criada localmente conforme o uso**, a partir do plate-lookup. O catálogo cura só `MAKE` e `MODEL` | Curar famílias exige conhecimento de gerações por modelo; o lookup já traz motor, combustível e ano |

Consequências nas seções acima: §6.3 só produz `EDITED` e `ACCEPTED_DEFAULT` na v1; a fase 4 de §11 cobre apenas Simples Nacional; §8 não tem horas.

Pendência que **não** é decisão de desenho e continua aberta: confirmar com o contador os defaults fiscais de §4.3.1 (principalmente `cClassTrib` e a regra de IBS/CBS para Simples em 2026), necessário só antes da fase 4 (emissão). A validação de horas com mecânico deixou de existir.
