# Spec — Importação Automática de NF-e de Compra (Distribuição DF-e)

Status: **rascunho para revisão** · Escopo: `packages/db`, `apps/api` (novo módulo `fiscal-inbound`), `apps/web`, `infra/terraform` + `infra/helm` (segredo fiscal)

Base normativa verificada: **NT 2014.002 v1.40** (WS `NFeDistribuicaoDFe`, CNPJ alfanumérico, vigente desde 08/07/2026). O que foi lido na NT e o que ainda falta conferir está em §14.

Relacionada: [service-catalog.md](service-catalog.md) §4.3.1 (o cadastro de peça por XML de entrada é o caminho previsto lá; esta spec o entrega).

## 1. Contexto e problema

A oficina compra peças de fornecedores que emitem NF-e contra o CNPJ dela. Hoje essas notas entram por digitação, o que gera erro de quantidade, de custo e de classificação fiscal (NCM, CEST, origem), e atrasa a entrada em estoque.

A SEFAZ publica toda NF-e emitida contra um CNPJ no web service nacional **Distribuição DF-e** (`NFeDistribuicaoDFe`). Esta spec usa esse serviço para buscar as notas automaticamente, guardar o XML, ligar cada item a uma `Part` e dar a entrada no estoque que o Fixer **já tem**.

Fatos do ambiente que condicionam o desenho:

- **1 tenant = 1 banco Postgres** ([schema.prisma:1-3](../../packages/db/prisma/schema.prisma#L1-L3)). Não existe `tenant_id`: o estado de sincronização e a credencial fiscal são **singletons por instância**.
- **O estoque é local.** `Part.stockQty` e o livro-razão `StockMovement` já existem ([schema.prisma:151-164](../../packages/db/prisma/schema.prisma#L151-L164), [schema.prisma:343-367](../../packages/db/prisma/schema.prisma#L343-L367)), e a entrada manual (`CatalogService.purchase`, [catalog.service.ts:49-72](../../apps/api/src/catalog/catalog.service.ts#L49-L72)) já grava `StockMovement(PURCHASE)` junto com o incremento. A entrada por NF-e usa o mesmo mecanismo. Não há serviço externo de estoque.
- A API roda com **HPA** ([hpa.yaml](../../infra/helm/fixer-tenant/templates/hpa.yaml)): várias réplicas ativas. A chamada à SEFAZ é longa, então o controle de concorrência é por **lease em tabela** (§6.1), não por advisory lock como no `OutboxRelay` ([outbox-relay.service.ts](../../apps/api/src/outbox/outbox-relay.service.ts)).
- Segredos entram no Helm só por **nome** (`secrets.*SecretName`) e são criados pelo Terraform ([values.yaml:77-82](../../infra/helm/fixer-tenant/values.yaml#L77-L82), [modules/tenant/main.tf](../../infra/terraform/modules/tenant/main.tf)). O segredo fiscal segue o mesmo caminho.

## 2. Objetivos e não-objetivos

**Objetivos**
1. Buscar automaticamente as NF-e (modelo 55) emitidas contra o CNPJ da oficina, sem digitação.
2. Guardar o XML original (obrigação de guarda fiscal) e os itens estruturados.
3. Ligar cada item a uma `Part`, aprendendo o vínculo por fornecedor.
4. Dar a entrada no estoque de forma **atômica e idempotente** (`Part.stockQty` + `StockMovement`).
5. Tratar cancelamento da nota antes e depois da entrada.
6. Preencher NCM, CEST, origem e unidade da `Part` a partir do XML (service-catalog §4.3.1).

**Não-objetivos (v1)**
- NFC-e, NFS-e, CT-e, MDF-e.
- Provedor terceiro (Focus NFe, Arquivei, etc.). A fonte é a SEFAZ direta, atrás de uma interface (§5) só por testabilidade.
- Emissão de qualquer documento.
- Manifestação diferente de **Ciência da Operação**. Confirmação, desconhecimento e "operação não realizada" são decisões da oficina, fora da v1.
- Mais de um CNPJ por tenant.
- Certificado A3 (token/cartão). O WS exige TLS mútuo e o evento exige assinatura em processo; só **A1** (arquivo `.pfx`) é viável.
- Custo médio ponderado. A v1 grava o **último custo** (§8.3).

## 3. Decisões de arquitetura

| # | Decisão | Motivo |
|---|---|---|
| D1 | Integração **direta com a SEFAZ**; sem provedor | Sem custo por nota e sem terceiro no caminho fiscal |
| D2 | Scheduler **em processo na API**, loop com lease em `FiscalSyncState`; **sem BullMQ** e sem `CronJob` do Kubernetes | Mesmo padrão do `OutboxRelay`; o estado relevante é o NSU, que precisa estar no Postgres de qualquer forma |
| D3 | Frequência é ditada por `nextPollAt` (dado), não por expressão cron | A SEFAZ bloqueia o CNPJ por 1 h se consultar fora de hora (cStat 656) |
| D4 | NSU e notas do lote são gravados **na mesma transação** | O NSU por documento é facultativo (NT v1.15), então a unidade atômica é o lote (≤ 50 docs) |
| D5 | Dois eixos de estado separados: **ciclo fiscal** (`status`) e **ciclo de estoque** (`exportStatus`) | Evita máquina de estados em produto cartesiano; cancelamento fiscal incide sobre o eixo de estoque |
| D6 | Certificado guardado **cifrado no banco do tenant** (AES-256-GCM, envelope), chave mestra em segredo do Kubernetes, atrás de `KeyProvider` | Upload self-service pela UI, mesmo modelo de segredos do Terraform/Helm; KMS vira troca de implementação (§7.3) |
| D7 | Entrada no estoque é **transação local**; a idempotência vem de `unique` em `StockMovement` | O estoque está no mesmo banco; não há chamada externa para falhar |
| D8 | Nada entra em estoque sem vínculo. Só `autoExport` (opt-in) dispensa a confirmação humana, e só com 100% dos itens resolvidos | Vínculo errado corrompe estoque e custo, e é caro de desfazer |
| D9 | Ciência da Operação automática é **opt-in** explícito, com aceite registrado (`acknowledgeManifestDuty`); desconhecimento nunca é automático | Manifestação é ato fiscal da empresa, e a Ciência cria o dever de uma manifestação conclusiva em até 180 dias (NT 2020.001, 2.D) |
| D10 | O vínculo item↔peça (`SupplierItemMap`) é FK direta para `Part` | Tudo no mesmo banco |
| D11 | **Dono do CNPJ e da UF é `TenantFiscalSettings`** (singleton, já previsto no service-catalog §4.3). `FiscalCredential` guarda só o certificado | Um único lugar para o dado fiscal da empresa; o certificado é validado contra ele |
| D12 | CNPJ e chave de acesso são tratados como **alfanuméricos** desde o início | A NT 2014.002 v1.40 trocou o tipo dos campos `CNPJ` de `N` para `C` (CNPJ alfanumérico, vigente desde 08/07/2026) |

## 4. Modelo de dados

### 4.1 Dado fiscal do tenant (dono do CNPJ)

```prisma
// Singleton por tenant (1 banco = 1 oficina). Já previsto em service-catalog.md §4.3;
// esta spec cria a tabela na fase 1 com os campos abaixo, e o catálogo acrescenta os demais.
model TenantFiscalSettings {
  id        Int     @id @default(1)
  cnpj      String? // 14 caracteres alfanuméricos [A-Z0-9]{12}[0-9]{2}, sem máscara (D12)
  legalName String?
  ufCode    Int?    // cUFAutor (código IBGE da UF); opcional no WS, enviado quando existe
  // ... demais campos do service-catalog.md §4.3 (municipalityIbge, taxRegime, issRate, hourlyRate...)
  @@map("tenant_fiscal_settings")
}
```

Validação do CNPJ (aplica-se a qualquer CNPJ lido ou digitado): `^[A-Z0-9]{12}[0-9]{2}$` e dígitos verificadores módulo 11, onde cada caractere vale `código ASCII − 48` (dígitos continuam valendo 0–9). A chave de acesso de 44 posições passa a poder conter letras na parte do CNPJ do emitente; **nunca** assumir `\d{44}` nem `parseInt` em CNPJ/chave.

### 4.2 Certificado e sincronização

```prisma
enum FiscalEnvironment { PRODUCTION HOMOLOGATION }

// Singleton. O .pfx e a senha NUNCA saem do banco em claro nem pela API.
model FiscalCredential {
  id                Int               @id @default(1)
  environment       FiscalEnvironment @default(PRODUCTION)

  pfxCiphertext     Bytes
  pfxPassCiphertext Bytes
  keyId             String            // qual chave mestra cifrou (rotação, §7.3)

  subject           String            // CN do certificado, só para exibição
  certCnpj          String            // CNPJ extraído do certificado (OID 2.16.76.1.3.3)
  notBefore         DateTime
  notAfter          DateTime

  enabled           Boolean @default(false)   // liga/desliga a sincronização
  autoManifest      Boolean @default(false)   // consente a Ciência da Operação automática (D9)
  autoExport        Boolean @default(false)   // dá entrada sem confirmação quando 100% resolvido (D8)
  autoExportById    String?                   // usuário que ligou; é o autor dos movimentos automáticos
  autoExportBy      User?   @relation("FiscalAutoExportBy", fields: [autoExportById], references: [id], onDelete: Restrict)

  uploadedById      String
  uploadedBy        User    @relation("FiscalUploadedBy", fields: [uploadedById], references: [id], onDelete: Restrict)
  createdAt         DateTime @default(now())
  updatedAt         DateTime @updatedAt

  syncState         FiscalSyncState?
}

// Auditoria das ações fiscais sensíveis (§7.4). `detail` nunca contém segredo.
model FiscalAuditLog {
  id     String   @id @default(cuid())
  at     DateTime @default(now())
  userId String
  user   User     @relation(fields: [userId], references: [id], onDelete: Restrict)
  action String   // "credential.upload", "credential.delete", "flags.update", "settings.update"
  detail Json?
  ip     String?
  @@index([at])
}

model FiscalSyncState {
  id                  Int       @id @default(1)
  credential          FiscalCredential @relation(fields: [id], references: [id], onDelete: Cascade)
  lastNsu             BigInt    @default(0)    // último NSU consumido (até 15 dígitos; cabe em BigInt)
  maxNsu              BigInt    @default(0)
  nextPollAt          DateTime  @default(now())
  leaseUntil          DateTime?                 // lease do worker (D2)
  leaseOwner          String?
  consecutiveFailures Int       @default(0)
  lastStatusCode      Int?                      // último cStat da SEFAZ
  lastError           String?
  lastRunAt           DateTime?
  lastSuccessAt       DateTime?                 // base do alerta de "NSU interrompido" (§6.5)
}
```

### 4.3 Nota, itens e vínculo

```prisma
// Ciclo fiscal: o que a SEFAZ nos entregou.
enum PurchaseInvoiceStatus {
  SUMMARY      // só o resumo (resNFe); falta ciência para vir o XML completo
  MANIFESTED   // Ciência enviada; aguardando o procNFe
  FULL         // XML completo guardado e itens extraídos
  CANCELED     // evento de cancelamento recebido
  IGNORED      // não é compra para este CNPJ (destinatário diferente, XML inválido)
}

// Ciclo de estoque: o que fizemos com a nota.
enum InvoiceExportStatus {
  NOT_READY      // ainda sem XML completo
  PENDING_MATCH  // há item sem vínculo, ou a nota exige revisão manual
  READY          // 100% resolvida, aguardando confirmação (ou autoExport)
  POSTED         // entrada lançada no estoque
  VOIDED         // nota cancelada antes da entrada, ou entrada estornada
}

model PurchaseInvoice {
  id             String   @id @default(cuid())
  accessKey      String   @unique              // chave de acesso, 44 caracteres alfanuméricos (dedup natural)
  nsu            BigInt?                       // NSU do documento mais recente que a atualizou (facultativo na NT)
  series         Int?
  number         Int?
  issuedAt       DateTime?
  issuerCnpj     String                        // 14 alfanuméricos (D12); pode ser CPF (11 dígitos) em produtor rural
  issuerName     String
  recipientCnpj  String?
  totalAmount    Decimal
  finality       Int?                          // finNFe: 1 normal, 2 compl., 3 ajuste, 4 devolução
  operationType  Int?                          // tpNF: 1 = saída do emitente (nossa compra)

  status         PurchaseInvoiceStatus @default(SUMMARY)
  manifestedAt   DateTime?
  manifestAttempts Int      @default(0)    // rejeições da Ciência (backoff 1/2/4/8/16 h; para em 5)
  manifestError    String?                // última rejeição, visível na UI
  manifestNextAt   DateTime?              // próxima tentativa automática
  canceledAt     DateTime?
  ignoredReason  String?

  xmlGz          Bytes?                        // procNFe original, gzip. Guarda fiscal: nunca apagar (§9)
  xmlSha256      String?

  exportStatus   InvoiceExportStatus @default(NOT_READY)
  needsReview    Boolean  @default(false)      // finalidade ≠ 1 ou outro motivo: nunca READY automático
  postedAt       DateTime?
  postedById     String?                       // quem confirmou; em autoExport, o autoExportById
  postedBy       User?    @relation(fields: [postedById], references: [id], onDelete: Restrict)

  receivedAt     DateTime @default(now())
  updatedAt      DateTime @updatedAt

  items          PurchaseInvoiceItem[]

  @@index([exportStatus])
  @@index([status])
  @@index([issuedAt])
}

enum ItemResolution {
  UNRESOLVED
  AUTO_MAP      // casou por SupplierItemMap
  AUTO_EAN      // casou por Part.ean
  MANUAL        // escolhido pelo usuário
  IGNORED       // não é estoque (uso e consumo, brinde, frete)
}

model PurchaseInvoiceItem {
  id               String   @id @default(cuid())
  invoiceId        String
  invoice          PurchaseInvoice @relation(fields: [invoiceId], references: [id], onDelete: Cascade)
  itemNumber       Int                          // nItem
  supplierCode     String                       // cProd
  ean              String?                      // cEAN / cEANTrib válido (≠ "SEM GTIN")
  description      String                       // xProd
  ncm              String
  cest             String?
  origin           Int?                         // orig (0–8)
  cfop             String
  unit             String                       // uCom
  quantity         Decimal                      // qCom
  unitPrice        Decimal                      // vUnCom
  totalPrice       Decimal                      // vProd
  discount         Decimal  @default(0)         // vDesc
  freight          Decimal  @default(0)         // vFrete
  insurance        Decimal  @default(0)         // vSeg
  otherCosts       Decimal  @default(0)         // vOutro
  ipi              Decimal  @default(0)         // vIPI
  icmsSt           Decimal  @default(0)         // vICMSST

  resolution       ItemResolution @default(UNRESOLVED)
  partId           String?
  part             Part?    @relation(fields: [partId], references: [id], onDelete: Restrict)
  unitFactor       Decimal  @default(1)         // unidades de estoque por unidade da nota (caixa de 4 = 4)

  stockMovements   StockMovement[]

  @@unique([invoiceId, itemNumber])
  @@index([supplierCode])
}

// Vínculo aprendido: o próximo item do mesmo fornecedor/código resolve sozinho.
model SupplierItemMap {
  id           String   @id @default(cuid())
  supplierCnpj String
  supplierCode String
  partId       String
  part         Part     @relation(fields: [partId], references: [id], onDelete: Restrict)
  unitFactor   Decimal  @default(1)
  createdAt    DateTime @default(now())
  lastUsedAt   DateTime @default(now())

  @@unique([supplierCnpj, supplierCode])
}
```

### 4.4 Alterações em modelos existentes

```prisma
model Part {
  // existentes: id, sku, name, costPrice, sellPrice, stockQty, supplierName, ...
  ean        String?                  // GTIN; usado pelo matcher (§8.1)
  // Campos fiscais do service-catalog §4.3 (nullable): ncm, cest, originCode, unit, ...
  // Esta spec os preenche a partir do XML; a coluna `unit` é obrigatória aqui para o fator de conversão.
  supplierItemMaps SupplierItemMap[]
  invoiceItems     PurchaseInvoiceItem[]
  @@index([ean])
}

model StockMovement {
  // existentes: id, partId, type, quantity, balanceAfter, serviceOrderPartLineId, note, createdById, createdAt
  purchaseInvoiceItemId String?
  purchaseInvoiceItem   PurchaseInvoiceItem? @relation(fields: [purchaseInvoiceItemId], references: [id], onDelete: Restrict)

  // Idempotência da entrada: um PURCHASE e, no máximo, um ADJUSTMENT (estorno) por item de nota.
  // NULLs são distintos no Postgres, então movimentos comuns não são afetados.
  @@unique([purchaseInvoiceItemId, type])
}
```

Notas:
- `PurchaseInvoiceItem` só existe quando `status = FULL`. Itens nascem `UNRESOLVED`.
- `xmlGz` fica no Postgres: o tamanho médio da NF-e é ~10 KB (NT §3.3) e a guarda fiscal é de **5 anos**. Sem job de limpeza; ao contrário do `OutboxEvent`, esta tabela nunca é podada.
- Migração **aditiva**: tudo novo é nullable ou tem default. Nada é removido de `Part` nem de `StockMovement`.
- `StockMovementType` não ganha valor novo: a entrada usa `PURCHASE` e o estorno usa `ADJUSTMENT`, identificados pelo `note` e pelo vínculo com o item.

## 5. Componentes (`apps/api/src/fiscal-inbound/`)

```
fiscal-inbound/
  fiscal-inbound.module.ts
  credentials/
    credential.service.ts       # upload, validação do .pfx, cifragem/decifragem
    key-provider.ts             # interface + EnvKeyProvider (v1); KmsKeyProvider (§7.3)
  sefaz/
    dfe-source.ts               # interface DfeSource { distribute(ultNsu): Promise<DistResult>; manifest(key): ... }
    sefaz-dfe.client.ts         # SOAP sobre TLS mútuo (https.Agent com pfx)
    event-signer.ts             # XMLDSig do evento de manifestação
  parser/
    dist-response.parser.ts     # retDistDFeInt, docZip (base64 + gunzip com limite)
    nfe.parser.ts               # procNFe → cabeçalho + itens
    cnpj.ts                     # validação alfanumérica (D12), chave de acesso
  sync/
    sync.scheduler.ts           # loop, lease, nextPollAt
    sync.runner.ts              # 1 rodada: consulta, grava o lote, manifesta
  matching/
    item-matcher.service.ts     # SupplierItemMap → Part.ean → UNRESOLVED
  posting/
    stock-posting.service.ts    # entrada e estorno (transação local)
  fiscal-inbound.controller.ts
```

`DfeSource` existe para que os testes usem um **SEFAZ falso** com respostas gravadas (§12), sem tocar a rede.

## 6. Sincronização

### 6.1 Scheduler e lease

Um loop por réplica, com tick de `FISCAL_TICK_MS` (padrão 30 s). O tick é barato: um `UPDATE ... RETURNING` atômico que só devolve linha a quem conquista o lease.

```sql
UPDATE "FiscalSyncState" s
SET "leaseUntil" = now() + interval '5 minutes', "leaseOwner" = $1
FROM "FiscalCredential" c
WHERE c."id" = s."id" AND c."enabled"
  AND s."nextPollAt" <= now()
  AND (s."leaseUntil" IS NULL OR s."leaseUntil" < now())
RETURNING s.*;
```

- Lease em tabela, não advisory lock, porque a consulta pode levar dezenas de segundos e **não deve** segurar uma transação do Postgres.
- Réplica que cai deixa o lease expirar em 5 min; outra assume. Escala do HPA não perde trabalho: tudo é idempotente (§6.3).
- O worker renova o lease entre lotes.

### 6.2 Rodada (`sync.runner`)

```
1. carrega credencial, decifra o pfx em memória (nunca em disco)
2. distDFeInt versao="1.01", tpAmb, [cUFAutor], CNPJ, distNSU/ultNSU = lastNsu   (ultNSU com 1–15 dígitos)
3. interpreta o cStat:
   138  documento(s) localizado(s) → processa o lote
   137  nenhum documento           → nextPollAt = now + 60 min + jitter(0–5 min)
   656  consumo indevido           → nextPollAt = now + 65 min; alerta; ver §6.6
   108/109 serviço paralisado      → backoff
   280–286, 473, 593               → problema de certificado/CNPJ: enabled=false, alerta, não repete
   outros                          → falha transitória: backoff
4. se 138 e ultNSU < maxNSU → nextPollAt = now (+ ~1 s) e continua paginando
   se 138 e ultNSU = maxNSU → nextPollAt = now + 60 min + jitter
5. libera o lease
```

Backoff de falha de rede/timeout/5xx: `min(2^falhas × 1 min, 60 min)`. Falhas consecutivas acima de 5 geram alerta.

Regras da NT que o desenho obedece (§3.5 e §3.11.4):
- Após `137`, esperar **no mínimo 1 hora**; consultar de novo antes gera `656` e **bloqueia o CNPJ por 1 hora**.
- Quando `ultNSU = maxNSU` também não há mais nada: esperar 1 hora.
- A consulta deve usar sempre o `ultNSU` devolvido na anterior, em sequência. Consultar "fora da sequência" também gera `656`.
- Lote de **até 50** documentos, em ordem crescente de NSU. O NSU segue a ordem de **recepção** na SEFAZ, não a de emissão.

O botão **"Sincronizar agora"** na UI fica desabilitado até `nextPollAt`.

### 6.3 Processamento do lote (uma transação)

O NSU por documento é **facultativo** (NT v1.15). Por isso a unidade atômica é o **lote**:

```
BEGIN
  para cada docZip do lote, em ordem:
     descomprime (gzip, com teto), identifica o schema, aplica o efeito abaixo (upsert por accessKey)
  UPDATE FiscalSyncState SET lastNsu = <ultNSU da resposta>, maxNsu = <maxNSU> WHERE lastNsu <= <ultNSU>
COMMIT
```

Documento com falha de parsing ou de validação não aborta o lote: vira `IGNORED` com motivo (ou é registrado e pulado, se não houver chave). Só erro de banco aborta e **não avança o NSU**; o lote reaparece na rodada seguinte.

O `schema` do `docZip` identifica o tipo e a versão (ex.: `resNFe_v1.00.xsd`, `procNFe_v3.10.xsd`, `resEvento_v1.00.xsd`, `procEventoNFe_v1.00.xsd`); casar por **prefixo**, nunca por versão exata.

| `schema` | Efeito |
|---|---|
| `resNFe_*` | Cria `PurchaseInvoice(SUMMARY)` se não existir (o resumo **não traz destinatário nem itens**, só emitente, valor e situação `cSitNFe`). `cSitNFe` 3 → `CANCELED`; 2 → `IGNORED` (`NOT_AUTHORIZED`); emitente = nosso CNPJ → `IGNORED` (`ISSUED_BY_TENANT`). Nunca altera nota já conhecida. Enfileira Ciência se `autoManifest`. |
| `procNFe_*` | Valida (abaixo), grava `xmlGz`, extrai itens, `status = FULL`, roda o matcher. Se a nota já tinha sido manifestada, só completa. |
| `resEvento_*` / `procEventoNFe_*` com `tpEvento = 110111` (cancelamento) | `status = CANCELED`, `canceledAt`; efeito no estoque conforme §8.5. |
| outros eventos (carta de correção, comprovante de entrega, ator interessado, etc.) | Ignorados; só o NSU avança. |

A distribuição devolve também notas em que o CNPJ é **emitente, transportador ou `autXML`** (NT §3, tabela de papéis). Só interessa quando somos **destinatário**; as demais viram `IGNORED` com motivo `NOT_RECIPIENT`.

Garantias:
- **Idempotente:** `accessKey` é única. O mesmo documento entregue 2× vira no-op; `lastNsu` só avança.
- **Ordem:** `resNFe` pode chegar depois de `procNFe` em reentregas; o upsert nunca rebaixa `FULL` para `SUMMARY`, nem `CANCELED` para outro estado.

**Validações do `procNFe` antes de aceitar** (falha → `IGNORED` com motivo, sem itens):
- A chave de 44 caracteres de `infNFe/@Id` bate com a do cabeçalho e o dígito verificador é válido (módulo 11, regra alfanumérica de §4.1).
- `dest/CNPJ` = CNPJ do tenant. `tpNF` = 1 (saída do emitente, ou seja, compra para nós).
- `protNFe` presente com `cStat` 100 (autorizada).
- `finNFe` ≠ 1 (complementar, ajuste, devolução) → `FULL` com `needsReview = true`: nunca vai a `READY` sozinha, porque o sistema não infere o efeito em estoque.

**Segurança no parsing:** DTD e entidades externas desabilitados; descompressão do `docZip` com teto (ex.: 5 MB) contra *zip bomb*; limite de itens por nota; todo campo de CNPJ/chave lido como **string**.

### 6.4 Manifestação (Ciência da Operação)

Para o destinatário, a SEFAZ só devolve o **resumo** até existir manifestação (NT 2014.002 §3: "Caso contrário, será retornado apenas o resumo da NF-e"). Qualquer manifestação libera o XML completo. A partir dela, **o Ambiente Nacional gera automaticamente um NSU referenciando a NF-e** (NT 2014.002 §3.11.3), e o XML aparece numa rodada seguinte da própria distribuição, pelo menos 1 hora depois.

**Evento enviado** (NT 2020.001 v1.00, item 4.3, lida do PDF oficial): `envEvento` com `idLote` e de 1 a 20 `evento`; em cada um, `infEvento` com `Id` = `"ID" + tpEvento + chave + nSeqEvento` (nSeqEvento com 2 dígitos, 54 posições), `cOrgao` **91** (Ambiente Nacional), `tpAmb`, `CNPJ` do destinatário, `chNFe`, `dhEvento`, `tpEvento` **210210**, `nSeqEvento` 1, `verEvento` 1.00 e `detEvento` com `descEvento` "Ciencia da Operacao". O XML vai numa linha só (espaços/quebras entre tags são rejeitados, 588) e a assinatura XMLDSig cobre o `infEvento`, com o certificado cujo CNPJ-base é o do destinatário (rejeição 213 se divergir). A assinatura segue o padrão da NF-e: C14N 1.0, RSA-SHA1, digest SHA-1, `KeyInfo/X509Data/X509Certificate` só com o certificado do titular.

**Resultado** (`retEnvEvento`): lote `128` = processado, e cada evento traz o próprio `cStat`:

| `cStat` do evento | Significado | Efeito na nota |
|---|---|---|
| 135 | registrado e vinculado à NF-e | `MANIFESTED` |
| 573 | duplicidade: a ciência já existe | `MANIFESTED` |
| 655 | ciência após manifestação final: já há manifestação e o XML já está liberado | `MANIFESTED` |
| 650 | ciência para NF-e cancelada ou denegada | `IGNORED` (`CANCELED_OR_DENIED`) |
| 596 | fora do prazo de manifestação (prazo vigente: 180 dias da autorização) | `IGNORED` (`MANIFEST_DEADLINE`) |
| 136 | registrado, mas **não vinculado** (a NF-e não existia no momento) | continua `SUMMARY`, com tentativa e backoff |
| demais (572, 594, 595, 215, 243, 29x…) | rejeição | continua `SUMMARY`, com tentativa e backoff |

Lote rejeitado como um todo (cStat ≠ 128) conta tentativa em todas as notas; **108/109 (serviço parado) e falha de rede/TLS interrompem a rodada sem penalizar nenhuma nota**. Depois de 5 rejeições a nota deixa de ser tentada sozinha e a UI mostra `manifestError`; o botão manual zera a contagem. O envio é isolado da gravação do lote: uma falha na ciência nunca desfaz o NSU (§6.2).

**Quando roda:** logo depois de cada rodada bem-sucedida (137/138), ainda sob o mesmo lease, para as notas `SUMMARY` elegíveis, da mais antiga para a mais nova, em lotes de 20 e até 200 por rodada. O serviço de eventos não está sujeito à regra de 1 hora do `distNSU`.

**Dever posterior (NT 2020.001, 2.D):** a Ciência "não configura a manifestação final". Depois dela, a empresa **deve** registrar Confirmação da Operação, Desconhecimento ou Operação não Realizada dentro do prazo (hoje 180 dias da autorização). Por isso ligar `autoManifest` exige o aceite explícito dessa obrigação, e a UI deve avisar. A Confirmação, que também confirma o recebimento da mercadoria e impede o emitente de cancelar a NF-e, é decisão humana e **não** é emitida pelo sistema na v1. Um desdobramento natural, fora da v1, é oferecer "Confirmar operação" depois que a entrada em estoque for lançada.

**Sem fallback por `consChNFe`.** Ele divide o limite de **20 consultas/hora** com `consNSU` e, ao estourar, gera `656` e bloqueia o `distNSU` do CNPJ inteiro por 1 hora (NT 2014.002 §3.11.4.2). O XML vem pela distribuição normal. Nota `MANIFESTED` há mais de 24 h sem XML vira alerta para investigação humana.

Com `autoManifest = false`, a nota fica `SUMMARY` e a UI oferece "Dar ciência e baixar XML" (`POST /invoices/:id/manifest`). Sem ciência não há XML, logo sem itens e sem entrada.

### 6.5 Janela de histórico e NSU interrompido

Dois fatos da NT afetam o que se pode importar:
- Os documentos ficam disponíveis por **90 dias** após a recepção no Ambiente Nacional; depois disso não há como recuperar a NF-e (NT §3). `ultNSU = 0` ou muito antigo devolve só o que foi recebido nos últimos 3 meses.
- **A geração de NSU só continua para quem usou o serviço nos últimos 60 dias.** Usuário novo começa a gerar NSU **no primeiro acesso, sem retroativo**, e quem para por mais de 60 dias perde a geração no intervalo, retomando na próxima consulta (NT §3.4). O primeiro acesso após isso retorna `137`.

Consequências de desenho:
- **Ligar a sincronização logo que o certificado é enviado.** O histórico anterior ao primeiro acesso **não é garantido**; a UI avisa isso no upload. Essas notas antigas seguem o fluxo manual atual.
- **Sync parado por muito tempo perde notas.** Alertas em `now − lastSuccessAt` > 7 dias (aviso) e > 30 dias (crítico, "notas podem ser perdidas"; o limite duro é 60 dias). Isso inclui certificado vencido e sync desligado pelo usuário: desligar mostra o prazo.

### 6.6 Consumo indevido (656) e outros sistemas no mesmo CNPJ

A NT trata **múltiplas aplicações consultando o mesmo CNPJ** como a mesma sequência: se um ERP do contador ou outro sistema também faz `distNSU` para este CNPJ, os dois competem pelo `ultNSU` e se bloqueiam (NT §3.11.4.1). O Fixer **não pode** compartilhar o NSU com outro sistema sem coordenação.

- A UI de certificado avisa: *"Nenhum outro sistema (contador, ERP) pode consultar a Distribuição DF-e deste CNPJ ao mesmo tempo."*
- Após `656` com a mensagem de sequência ("Deve ser utilizado o ultNSU nas solicitações subsequentes"), a SEFAZ devolve no XML da rejeição o **número da última consulta feita para o CNPJ** (NT v1.14). O runner **registra esse valor em `lastError` mas não adota `lastNsu` automaticamente**, porque isso pularia documentos que outro sistema já consumiu. A retomada é decisão humana (§11, `POST /fiscal/sync/resume-from`).
- `656` **três vezes seguidas** (o bloqueio de 1 h já tinha passado nas anteriores) gera alerta crítico e desliga a sincronização. A contagem usa `consecutiveFailures` + `lastStatusCode = 656`; qualquer resposta 137/138 zera.

## 7. Certificado e segredos

### 7.1 Upload

`POST /fiscal/credentials` (JSON: `pfxBase64`, `password`, `environment`; o `.pfx` tem poucos KB, então base64 dispensa upload multipart e dependência extra). **Pré-condição:** `TenantFiscalSettings.cnpj` preenchido (D11). A API:
1. Abre o PKCS#12 em memória; recusa se corrompido ou com senha errada.
2. Lê o CNPJ do certificado (e-CNPJ ICP-Brasil, extensão OID 2.16.76.1.3.3) e **exige que o CNPJ-base (8 primeiros caracteres) seja igual ao de `TenantFiscalSettings.cnpj`**. Essa é a regra do WS: a empresa é autenticada pelo CNPJ-base e pode consultar qualquer estabelecimento (14 caracteres) da mesma base (NT §3; rejeição 593). Um certificado da matriz serve para uma filial.
3. Exige o certificado de **PJ ICP-Brasil** com a extensão de CNPJ (a SEFAZ rejeita sem ela, 473).
4. Recusa certificado vencido ou que vence em < 7 dias.
5. Cifra `.pfx` e senha e grava só o ciphertext. A resposta devolve apenas `subject`, `notAfter`, `certCnpj`. Não existe endpoint de leitura do `.pfx` ou da senha.
6. Mostra o aviso de §6.5 (sem histórico garantido) e de §6.6 (sem outro sistema consultando).

Risco conhecido: PKCS#12 antigo (RC2/3DES) não abre no OpenSSL 3 sem *legacy provider*. A leitura do `.pfx` usa `node-forge` (puro JS) e normaliza para chave+cadeia PEM em memória, sem depender do OpenSSL do runtime.

### 7.2 Cifragem em repouso

- **Envelope:** cada segredo (`.pfx` e senha, em colunas separadas) ganha uma chave de dados aleatória (DEK, 32 B) própria e é cifrado com AES-256-GCM (IV único, *auth tag* validada). A DEK é embrulhada pela **chave mestra** e fica dentro do próprio blob (`v1 | DEK embrulhada | iv | tag | ciphertext`). O contexto (`fiscal-credential:pfx` / `…:pfx-pass`) entra como AAD, então um blob não decifra no campo do outro.
- **Chave mestra:** `FISCAL_ENC_KEYS` (JSON `{ "k1": "<base64 32B>" }`) + `FISCAL_ACTIVE_KEY_ID`, vindo de um Secret do Kubernetes. `keyId` na credencial diz qual chave decifra; **rotação** = adicionar `k2`, ativar, e um comando `fiscal:rewrap` re-cifra as DEKs sem tocar no `.pfx`.
- A chave mestra **nunca** está no banco. Quem lê só o dump do Postgres não decifra.
- O `.pfx` decifrado vive só na memória do worker durante a rodada; não é logado, não vai para disco, não entra em erro serializado.

### 7.3 Provisionamento e evolução

- **Terraform** (`modules/tenant`): `random_bytes` de 32 B e `kubernetes_secret "fiscal"` com `FISCAL_ENC_KEYS` e `FISCAL_ACTIVE_KEY_ID`; output `fiscal_secret_name`, igual aos outros segredos do módulo.
- **Helm:** `secrets.fiscalSecretName` em [values.yaml](../../infra/helm/fixer-tenant/values.yaml), injetado em [api-deployment.yaml](../../infra/helm/fixer-tenant/templates/api-deployment.yaml) por `secretKeyRef`. Sem o nome, a API sobe com a sincronização desligada e a UI fiscal mostra "indisponível".
- **v1 usa `EnvKeyProvider`.** A chave mestra no Secret do Kubernetes é aceitável porque o banco é por tenant (raio de dano limitado a uma oficina), mas fica abaixo de KMS. `KeyProvider` é interface exatamente para a fase 6 trocar por **AWS KMS** (`Decrypt` da DEK), já que a plataforma está na AWS ([platform/main.tf](../../infra/terraform/platform/main.tf)). Nenhum dado migra: só se re-embrulha a DEK.
- **Endereços dos WS** em configuração, não no código: `FISCAL_DIST_URL_PRODUCTION`, `FISCAL_DIST_URL_HOMOLOGATION`, `FISCAL_EVENT_URL_PRODUCTION`, `FISCAL_EVENT_URL_HOMOLOGATION`. A NT remete os endereços à lista "Relação de Serviços Web" do Portal Nacional da NF-e (e ao portal de homologação), que muda; preencher no deploy a partir dela (§14).

### 7.4 Permissões e auditoria

Novas permissões, no mesmo modelo `Role`/`Permission` existente:

| Permissão | Permite |
|---|---|
| `fiscal.manage` | enviar/trocar/remover certificado, ligar/desligar sync, `autoManifest`, `autoExport`, retomar NSU |
| `invoices.read` | listar e ver notas, baixar XML |
| `invoices.reconcile` | vincular itens, cadastrar peça a partir do item, confirmar entrada, estornar |

Todo upload/remoção de certificado, troca de CNPJ e mudança de `enabled`/`autoManifest`/`autoExport` grava `FiscalAuditLog` (quem, quando, IP, ação, detalhe sem segredo).

**Aplicação das permissões:** o repositório tinha as tabelas `Role`/`Permission` mas nenhuma checagem. A fase 1 acrescenta `@RequirePermission(chave)` e o `PermissionGuard` (global, depois do `AuthGuard`), que **falha fechado**: sem papel que conceda a permissão, 403. Rotas sem o decorator não mudam. Nenhum papel concede `fiscal.manage`/`invoices.*` ainda; é preciso criar a `Permission` e ligá-la a um `Role` do usuário (ver §14.3).

## 8. Conciliação e entrada em estoque

### 8.1 Matcher (roda quando a nota vira `FULL`)

Para cada item, em ordem, o primeiro acerto vence:
1. `SupplierItemMap(supplierCnpj, supplierCode)` → `AUTO_MAP`, herda `unitFactor`.
2. `ean` válido → `Part.ean` igual; acerto único → `AUTO_EAN` (fator 1, e **cria** o `SupplierItemMap`). Mais de um acerto → fica `UNRESOLVED`.
3. Senão → `UNRESOLVED`.

O `ean` do item vem do `cEAN` (unidade **comercial**, a mesma em que o item é lançado). O `cEANTrib` (unidade tributável) só é usado quando `uTrib`/`qTrib` coincidem com `uCom`/`qCom`; do contrário casar por ele erraria a quantidade (caixa de 4 na nota, GTIN da unidade avulsa).

Item já resolvido (por humano ou por regra) nunca é sobrescrito. O matcher roda **na mesma transação** que grava o lote (§6.3) e de novo, para as outras notas em `PENDING_MATCH` do mesmo fornecedor, sempre que um vínculo é aprendido: uma conciliação resolve as notas parecidas que estavam esperando.

Nota sem item `UNRESOLVED` e com `needsReview = false` vai a `READY`; com item `UNRESOLVED` ou `needsReview = true` fica `PENDING_MATCH`. Desfazer um vínculo de uma nota `READY` a devolve a `PENDING_MATCH`. Nota lançada, anulada, cancelada ou sem XML completo nunca é tocada pela conciliação (`409` na API).

### 8.2 Tela de conciliação

Para cada item não resolvido, o usuário:
- **Busca e escolhe** a `Part` (busca por nome/SKU, a mesma de `listParts`), ajusta o **fator de unidade** se preciso (caixa → unidades) e **salva o vínculo** (padrão ligado) → grava `SupplierItemMap`;
- ou marca **"não é estoque"** (`IGNORED`): uso e consumo, brinde, frete cobrado em item;
- ou **"cadastrar peça"**: cria a `Part` já preenchida com `name` (de `xProd`), `ean`, `ncm`, `cest`, `originCode`, `unit`, `supplierName` (emitente) e `costPrice` (§8.3), com SKU sugerido a partir de `cProd` (editável; conflito de SKU devolve o erro de unicidade existente). `sellPrice` fica a cargo do usuário. É o caminho de cadastro por XML previsto no service-catalog §4.3.1.

Um item resolvido continua editável até a nota ser lançada. `needsReview` só é limpo por ação explícita do usuário.

### 8.3 Lançamento (`stock-posting.service`)

Disparado por `POST /invoices/:id/confirm`, ou automaticamente quando `autoExport = true` e a nota chega a `READY`. Uma transação:

```
BEGIN
  UPDATE PurchaseInvoice SET exportStatus='POSTED', postedAt=now(), postedById=$user
   WHERE id=$id AND exportStatus='READY' AND status='FULL'      -- claim; 0 linhas = outra tentativa já lançou, aborta sem erro
  para cada item com resolution ≠ IGNORED:
     qty = quantity × unitFactor
     part = UPDATE Part SET stockQty = stockQty + qty, costPrice = <unitCost>  WHERE id = partId  RETURNING stockQty
     INSERT StockMovement(partId, type=PURCHASE, quantity=qty, balanceAfter=part.stockQty,
                          purchaseInvoiceItemId=item.id, createdById=$user,
                          note='NF-e <número>/<série> · <chave de acesso>')
COMMIT
```

- **Idempotência em duas camadas:** o `UPDATE ... WHERE exportStatus='READY'` serializa chamadas concorrentes, e `unique(purchaseInvoiceItemId, type)` impede movimento duplicado mesmo se o claim falhar. Falha em qualquer item faz **rollback da nota inteira**: ou entra tudo, ou nada.
- **Autor:** `createdById` é o usuário que confirmou; em `autoExport`, o `autoExportById` da credencial (o `StockMovement` exige um `User`).
- **Custo (v1 = último custo):** `unitCost = (totalPrice − discount + freight + insurance + otherCosts + ipi + icmsSt) / qty`. Inclui IPI e ICMS-ST porque a v1 assume **Simples Nacional** (service-catalog §14, decisão 4), em que esses valores não geram crédito e compõem o custo. Em outro regime essa fórmula muda; o `TaxRegime` de `TenantFiscalSettings` decide quando a regra existir. `Part.costPrice` recebe o custo da compra mais recente; custo médio ponderado fica fora da v1.
- Os valores brutos por item permanecem na nota (§4.3), então a regra de custo pode ser recalculada sem reimportar.

### 8.4 Auto-lançamento (`autoExport`)

Desligado por padrão. Quando ligado, uma nota que chega a `READY` (100% dos itens resolvidos por `AUTO_MAP`/`AUTO_EAN`/`IGNORED` e `needsReview = false`) é lançada sem intervenção. Qualquer item `UNRESOLVED` ou nota em revisão **nunca** é lançada, e a UI mostra o motivo.

### 8.5 Cancelamento

| Estado da nota ao chegar o cancelamento | Efeito |
|---|---|
| `NOT_READY`, `PENDING_MATCH`, `READY` | `exportStatus = VOIDED`. Nunca é lançada. |
| `POSTED` | `status = CANCELED` e **alerta ao usuário**. A v1 **não estorna sozinha**: a peça pode já ter sido consumida por uma OS. A UI oferece **"Estornar entrada"** (`invoices.reconcile`). |

**Estorno manual** (`POST /invoices/:id/void-entry`), transação única: para cada movimento `PURCHASE` da nota, `UPDATE Part SET stockQty = stockQty − qty WHERE id = $partId AND stockQty >= qty` e grava `StockMovement(ADJUSTMENT, purchaseInvoiceItemId, note='Estorno NF-e cancelada …')`. O mesmo guarda de saldo de `service-orders.service.ts:265` vale aqui: se alguma peça já foi consumida e o saldo não cobre, **nada é estornado**, a resposta lista as peças em falta e o usuário resolve com ajuste manual. Sucesso → `exportStatus = VOIDED`. `Part.costPrice` **não** volta ao valor anterior (a v1 não guarda histórico de custo).

## 9. Retenção

- `xmlGz` e os itens ficam **5 anos no mínimo**; não há expurgo automático.
- `SupplierItemMap` é cumulativo e nunca expira.
- Notas `IGNORED` com XML também são guardadas.
- `onDelete: Restrict` em `Part` impede apagar uma peça que tenha item de nota ou vínculo.

## 10. Observabilidade e alertas

Banner na UI e log estruturado para:
- Certificado vence em ≤ 30 / 15 / 7 dias (checagem diária);
- Sync sem sucesso há > 7 dias (aviso) e > 30 dias (crítico; limite de NSU é 60 dias, §6.5);
- cStat 656 (indica bug de agendamento ou outro sistema no mesmo CNPJ, §6.6);
- Certificado/CNPJ rejeitado pela SEFAZ (sync é desligado);
- Nota `MANIFESTED` há > 24 h sem XML;
- Cancelamento de nota já `POSTED`;
- Nota com `needsReview`.

Métricas: `fiscal_sync_runs_total{cstat}`, `fiscal_documents_total{schema}`, `fiscal_invoices_by_export_status`. Entrega por e-mail/WhatsApp pelo serviço `notifications` existente fica para a fase 6; o stream atual é de OS e exigiria novo tipo de evento.

## 11. API e UI

| Método | Rota | Função | Permissão |
|---|---|---|---|
| GET | `/fiscal/status` | credencial (sem segredo), `nextPollAt`, `lastNsu`, alertas | `invoices.read` |
| GET/PUT | `/fiscal/company` | CNPJ, razão social e UF da empresa (pré-condição do upload). Rota própria: `fiscal/settings` é do módulo fiscal-settings (NFS-e) | `invoices.read` / `fiscal.manage` |
| POST | `/fiscal/credentials` | upload do `.pfx` (JSON, base64) | `fiscal.manage` |
| PATCH | `/fiscal/credentials` | `enabled`, `autoManifest` (exige `acknowledgeManifestDuty: true`), `autoExport` | `fiscal.manage` |
| DELETE | `/fiscal/credentials` | remove certificado, desliga sync e apaga a configuração fiscal e de precificação (dados da empresa, proveniência, perfil tributário, aceites das tabelas, regras de preço); notas, estoque e histórico ficam | `fiscal.manage` |
| POST | `/fiscal/sync` | sincronizar agora (409 se `nextPollAt` > now) | `invoices.reconcile` |
| POST | `/fiscal/sync/resume-from` | retoma de um NSU informado após 656 (§6.6), com auditoria | `fiscal.manage` |
| GET | `/invoices?view=&q=&take=&skip=` | lista paginada por aba (`pending`, `ready`, `posted`, `summary`, `canceled`, `ignored`, `all`), com `unresolvedCount` por nota; `q` busca fornecedor, CNPJ, número e chave | `invoices.read` |
| GET | `/invoices/summary` | contagem de cada aba | `invoices.read` |
| GET | `/invoices/:id` | nota + itens com a peça vinculada (sem o XML) | `invoices.read` |
| GET | `/invoices/:id/xml` | baixa o XML original | `invoices.read` |
| POST | `/invoices/:id/manifest` | dar ciência manual (zera as tentativas; 409 se a nota não é resumo, 502 se a SEFAZ está inacessível) | `invoices.reconcile` |
| PUT | `/invoices/:id/items/:n` | `{action: link \| ignore \| reset}`: vincula (com fator e `saveMapping`), marca "não é estoque" ou desfaz | `invoices.reconcile` |
| POST | `/invoices/:id/items/:n/create-part` | cadastra `Part` a partir do item (exige `sellPrice`; 409 se o SKU já existe) | `invoices.reconcile` |
| POST | `/invoices/:id/clear-review` | limpa `needsReview` | `invoices.reconcile` |
| POST | `/invoices/:id/confirm` | lança a entrada (§8.3) | `invoices.reconcile` |
| POST | `/invoices/:id/void-entry` | estorno manual (§8.5) | `invoices.reconcile` |

**Web** (`apps/web`): `/notas` (abas com contagem, busca, selo de itens sem peça e de ciência rejeitada), `/notas/[id]` (cabeçalho, avisos em linguagem de balcão, itens com vincular/cadastrar/"não é estoque"/desfazer, baixar XML, dar ciência, "revisei esta nota", "Lançar entrada no estoque") e `/configuracoes/notas` em 3 passos: dados da empresa (CNPJ com máscara e validação alfanumérica, UF), certificado (upload do .pfx em base64, avisos de A1, de outro sistema no mesmo CNPJ e de histórico não garantido, validade com alerta, substituir, remover) e sincronização (saúde em uma frase, ligar/desligar, ciência automática com o aceite da obrigação de manifestação conclusiva, última/próxima consulta). o interruptor de `autoExport` (lançamento automático) fica ao lado da ciência automática. O link "Notas" fica fora da tab bar do celular (ela tem 5 vagas) e no menu do desktop, na paleta de comandos e no atalho `g f`.

## 12. Testes (critérios de aceite)

Todos contra um **SEFAZ falso** que reproduz as respostas da NT (`138` com lote, `137`, `656` nas duas variantes de mensagem, `resNFe`, `procNFe`, evento de cancelamento).

**Sincronização e NSU**
- Mesmo lote entregue 2× → mesmas notas, sem duplicata, `lastNsu` igual.
- Erro de banco no meio do lote → transação inteira volta; `lastNsu` não avança; a rodada seguinte reprocessa o lote.
- Resposta **sem atributo `NSU`** nos `docZip` → processa normalmente e avança por `ultNSU` da resposta.
- `137` → `nextPollAt` ≥ 60 min à frente; `ultNSU = maxNSU` → idem; `656` → ≥ 65 min e alerta.
- `ultNSU < maxNSU` → continua paginando sem esperar 60 min.
- 2 réplicas em corrida no mesmo tick → só uma conquista o lease; a outra não faz chamada.
- Réplica morta com lease aberto → após 5 min outra assume.
- `656` com mensagem de sequência → `lastNsu` **não** é alterado automaticamente; 3 em 24 h desliga o sync.
- Sync sem sucesso há 8 dias → alerta de aviso; 31 dias → crítico.

**CNPJ alfanumérico**
- CNPJ `12ABC34501DE35` (exemplo oficial alfanumérico) e CNPJ numérico antigo validam; DV errado é recusado.
- Chave de acesso com letras na parte do CNPJ do emitente é aceita, com DV validado.
- Certificado com CNPJ-base igual e filial diferente do tenant → aceito; base diferente → recusado.

**Documento**
- `resNFe` depois `procNFe` da mesma chave → 1 nota, `FULL`, itens corretos.
- `procNFe` antes do `resNFe` atrasado → continua `FULL`.
- Nota em que somos emitente/transportador/`autXML` → `IGNORED` (`NOT_RECIPIENT`), sem itens.
- Chave de acesso inconsistente com o XML → `IGNORED` com motivo.
- `finNFe = 4` → `FULL` + `needsReview`; nunca `READY` automático, nem com `autoExport`.
- XML com DTD/entidade externa → rejeitado. `docZip` que descomprime acima do teto → rejeitado.
- Cancelamento chega antes da nota → fica registrado e a nota nasce `CANCELED` quando chegar.

**Manifestação**
- `autoManifest = false` → nenhum evento enviado, nota fica `SUMMARY`.
- `autoManifest = true` → um evento `210210` por nota; duplicidade tratada como sucesso.
- Evento assinado valida contra o certificado de teste.
- Nenhuma chamada `consChNFe` é feita pelo runner.

**Conciliação e lançamento**
- Mesmo fornecedor/código em 2 notas → 2ª resolve `AUTO_MAP` sem ação.
- EAN com 2 `Part` → `UNRESOLVED`.
- `unitFactor = 4`, `qCom = 2` → `stockQty` sobe 8.
- Confirmar 2× em paralelo → **1** entrada (`stockQty` sobe uma vez; 1 `StockMovement` por item).
- Falha no 3º item (ex.: `Part` apagada) → rollback; nota continua `READY`, saldo intacto.
- `autoExport = true` com 1 item `UNRESOLVED` → **não** lança. Com `needsReview` → **não** lança.
- Cancelamento com a nota em `POSTED` → alerta, **sem** estorno automático; estorno manual com saldo suficiente → `ADJUSTMENT` e `VOIDED`; com saldo insuficiente em 1 peça → nada estorna e a resposta lista a peça.
- `costPrice` recebe o custo com IPI e ICMS-ST rateados corretamente (caso com frete + desconto).

**Certificado e segredo**
- `.pfx` com CNPJ-base diferente, vencido, sem extensão de CNPJ ou com senha errada → recusado com erro claro, nada gravado.
- Upload sem `TenantFiscalSettings.cnpj` → recusado pedindo o cadastro do CNPJ.
- Nenhuma rota retorna `pfx`, senha ou DEK; log e erros serializados não os contêm (teste de varredura).
- Troca da chave ativa + `fiscal:rewrap` → credencial continua decifrando, `keyId` novo.
- Sem `FISCAL_ENC_KEYS` → API sobe, sync desligado, UI avisa.

**Homologação real (manual, antes da produção)**
- Fase 2 roda contra o ambiente de homologação da SEFAZ com certificado de teste e notas de homologação.

## 13. Riscos

| Risco | Mitigação |
|---|---|
| Bloqueio por consumo indevido (656) | `nextPollAt` em dado, lease único, "Sincronizar agora" travado, teste de corrida entre réplicas |
| Outro sistema (contador/ERP) consultando o mesmo CNPJ | Aviso no upload, `656` não adota NSU automaticamente, retomada humana com auditoria (§6.6) |
| NSU interrompido por > 60 dias, notas perdidas | Alertas em 7 e 30 dias; desligar o sync mostra o prazo (§6.5) |
| Histórico anterior à ativação não vem | Aviso no upload; notas antigas seguem o fluxo manual; a janela de 90 dias da SEFAZ é limite duro |
| Vazamento do certificado A1 | Cifra em repouso, chave mestra fora do banco, sem endpoint de leitura, permissão dedicada, auditoria; KMS na fase 6 |
| Vínculo errado corrompe estoque e custo | Nada sem vínculo é lançado; `autoExport` opt-in e só com 100% resolvido; vínculo editável até o lançamento |
| Entrada duplicada | Claim por `exportStatus='READY'` + `unique(purchaseInvoiceItemId, type)` + transação única por nota |
| Cancelamento depois da entrada | Alerta + estorno manual protegido por guarda de saldo, sem estorno automático |
| CNPJ/chave tratados como numéricos (CNPJ alfanumérico) | Tudo `String`, validação central em `cnpj.ts`, testes com valor alfanumérico |
| `Part.costPrice` sobrescrito por compra pontual atípica | v1 assume último custo e documenta; custo médio fica para depois; valores brutos preservados para recalcular |
| Certificado vence e o sync para em silêncio | Alertas em 30/15/7 dias, banner, alerta de sync parado |
| Mudança de schema/endpoint da SEFAZ (nota técnica) | `DfeSource` isolado; XSD versionado no repositório; fixtures por versão; URLs em configuração |
| PKCS#12 legado não abre no OpenSSL 3 | Leitura com `node-forge` |

## 14. Decisões tomadas, fontes e pontos abertos

### 14.1 Decisões

Revisáveis, mas a implementação segue estas até alguém contestar.

| # | Questão | Decisão | Motivo |
|---|---|---|---|
| 1 | Infra de jobs | Loop em processo na API com lease em tabela; sem BullMQ, sem `CronJob` | Padrão já existente (`OutboxRelay`); o estado que importa é o NSU, no Postgres |
| 2 | Onde guardar o A1 | Cifrado no banco do tenant (AES-256-GCM, envelope); chave mestra em Secret do Kubernetes via Terraform; `KeyProvider` para trocar por KMS | Upload self-service pela UI e coerência com o modelo atual de segredos |
| 3 | Estoque | **Schema local existente** (`Part`, `StockMovement`); sem serviço externo. A entrada é uma transação local, idempotente por `unique` | Decisão do produto: manter o estoque no schema atual. O mesmo banco elimina contrato HTTP, retry e a chave de idempotência externa |
| 4 | Vínculo item↔produto | `SupplierItemMap` com FK para `Part` | Tudo no mesmo banco |
| 5 | Manifestação | Só Ciência (210210), opt-in; sem fallback `consChNFe` | Ato fiscal da empresa; `consChNFe` pode bloquear o CNPJ |
| 6 | Estorno por cancelamento tardio | Manual, com alerta e guarda de saldo | A peça pode já ter sido consumida |
| 7 | **Dono do CNPJ e da UF** | `TenantFiscalSettings` (singleton). `FiscalCredential` só valida o certificado contra ele | Um dono único para o dado fiscal da empresa; já era o lugar previsto no catálogo; a regra do WS (CNPJ-base) casa com isso |
| 8 | Custo na entrada | Último custo, com IPI e ICMS-ST (Simples) | Coerente com a decisão de Simples primeiro; valores brutos guardados para recalcular |
| 9 | Autor do movimento em `autoExport` | `autoExportById` (quem ligou) | `StockMovement.createdById` é obrigatório |

### 14.2 O que foi verificado na NT 2014.002 v1.40

Lido do PDF oficial da NT (v1.40, 08/07/2026), não de memória:

| Item | Valor na NT |
|---|---|
| Layout do pedido | `distDFeInt versao="1.01"`; `tpAmb`; `cUFAutor` (opcional); `CNPJ` ou `CPF`; grupo `distNSU/ultNSU`, `consNSU/NSU` ou `consChNFe/chNFe` |
| Resposta | `retDistDFeInt` com `cStat`, `ultNSU`, `maxNSU`, `loteDistDFeInt/docZip` (gzip em base64), atributos `NSU` (facultativo desde v1.15) e `schema` |
| Lote | até **50** documentos, em ordem crescente de NSU |
| Códigos | `137` nenhum documento, `138` localizado, `656` consumo indevido, `593` CNPJ-base ≠ certificado, `473` certificado sem CNPJ/CPF, `589` NSU maior que o máximo, `632` fora do prazo, `108/109` serviço paralisado |
| Espera | 1 h após `137` ou com `ultNSU = maxNSU`; `656` bloqueia o CNPJ por 1 h e reinicia a contagem se consultar antes |
| `consChNFe`/`consNSU` | limite de **20 consultas/hora** |
| Janela | 90 dias de distribuição; `ultNSU` zerado devolve até 3 meses |
| NSU | gerado só para quem usou o serviço nos últimos 60 dias; novo usuário sem NSU retroativo |
| Autenticação | certificado PJ ICP-Brasil com extensão de CNPJ (OID 2.16.76.1.3.3); empresa autenticada pelo CNPJ-base, consulta qualquer filial |
| Destinatário | só resumo até haver manifestação; depois, NSU gerado automaticamente com o XML |
| v1.40 | campo `CNPJ` muda de tipo `N` para `C` (CNPJ alfanumérico), 08/07/2026 |

### 14.2b O que foi verificado na NT 2020.001 v1.00 (manifestação do destinatário)

Lido do PDF oficial (Portal Nacional da NF-e), não de memória:

| Item | Valor na NT |
|---|---|
| Método | `nfeRecepcaoEvento`, síncrono; lote de 1 a 20 eventos |
| Autoria | evento do destinatário, assinado com certificado de mesmo **CNPJ-base** (rejeição 213) |
| `cOrgao` | 91 = Ambiente Nacional |
| `Id` | `"ID" + tpEvento + chave + nSeqEvento`, 54 posições |
| Tipos | 210200 confirmação · **210210 ciência** · 210220 desconhecimento · 210240 não realizada (exige `xJust` de 15 a 255) |
| `descEvento` da ciência | `Ciencia da Operacao` (retorno: `Ciencia da Operacao registrada`) |
| Resultado | lote 128; evento 135 (vinculado), 136 (não vinculado); 573 duplicidade; 594 nSeq > 1; 596 fora do prazo; 650 NF-e cancelada/denegada; 655 ciência após manifestação final |
| Prazo | manifestação conclusiva em até **180 dias** da autorização (parametrizável) |
| Obrigação | "Após um período determinado, todas as operações com Ciência da Operação deverão ter a manifestação final" |
| Assinatura | sobre `infEvento`; erros 290–298 (certificado e padrão de assinatura) |

### 14.3 Ainda por conferir

1. **Endereços dos WS** (`NFeDistribuicaoDFe` e recepção de eventos, produção e homologação): a NT os remete à lista "Relação de Serviços Web" do Portal Nacional da NF-e, e a página não pôde ser lida nesta sessão. Ficam em configuração (§7.3) e precisam ser preenchidos antes da **fase 2**. A fonte secundária consultada cita `…/NFeRecepcaoEvento4/NFeRecepcaoEvento4.asmx` no domínio de homologação, sem confirmação oficial.
2. **Serviço de eventos**: o leiaute do evento, os `cStat` (135/136/573/596/650/655) e o código de órgão 91 foram **lidos da NT 2020.001** (ver §14.2b). Continuam por conferir: o **endereço** do `NFeRecepcaoEvento` (Relação de Serviços Web), a **versão do SOAP** (o cliente usa 1.2 por padrão e `FISCAL_EVENT_SOAP=1.1` troca; a NT dá só o método `nfeRecepcaoEvento`) e o namespace do WSDL (`…/NFeRecepcaoEvento4`, de fonte secundária). Só um ciclo em homologação fecha isso.
3. **Dígito verificador da chave de acesso com letras**: confirmar o cálculo oficial na NT/manual do CNPJ alfanumérico antes de implementar `cnpj.ts` (a regra de §4.1 segue o cálculo da Receita para o CNPJ).
4. **`TenantFiscalSettings`**: a tabela já existia no schema (catálogo); a fase 1 só acrescentou `cnpj`, `legalName` e `ufCode`, em migration aditiva própria (`20261011200000_nfe_import`). Resolvido.
6. **Cadeia ICP-Brasil dos servidores da SEFAZ**: o repositório de CAs do Node não a inclui. Sem ela, a primeira consulta real falha com erro de TLS (o cliente nunca desliga a verificação do servidor). Obter a cadeia no Portal Nacional da NF-e e entregá-la em `FISCAL_CA_BUNDLE` (Helm: `fiscal.caBundleConfigMap`). Não testado contra a SEFAZ real.
7. **SOAPAction e `Content-Type`**: o cliente usa SOAP 1.1 e `SOAPAction: "…/NFeDistribuicaoDFe/nfeDistDFeInteresse"` a partir do envelope do exemplo da NT; o valor exato do cabeçalho não está na NT e deve ser conferido no WSDL do serviço na primeira chamada em homologação.
8. **`cStat` de cancelamento (135/155)**: vêm de memória; o leiaute de eventos não foi lido. O parser trata como cancelamento efetivo só 135 e 155 (136 = registrado sem vínculo, ignorado).
5. **Primeiro papel com `fiscal.manage`**: não há tela nem seed de papéis/permissões no Fixer, e isto afeta todas as rotas com `@RequirePermission` (fiscal, notas, aprendizado). Em **dev**, [infra/dev/grant-admin.sql](../../infra/dev/grant-admin.sql) cria o papel Admin com todas as permissões conhecidas e o liga a um e-mail. Em **produção** falta o equivalente no provisionamento do tenant (Terraform/seed). Enquanto isso, as rotas respondem 403 (falha fechado).

## 15. Fases de entrega

| Fase | Entrega | Pronto quando |
|---|---|---|
| 1 ✅ | Schema (`TenantFiscalSettings`, credencial, notas, vínculo, alterações em `Part`/`StockMovement`), `cnpj.ts`, `KeyProvider`/cifragem, upload e validação do `.pfx`, `nfe.parser` e `dist-response.parser` com fixtures, segredo no Terraform/Helm | Parsers passam nas fixtures (incl. CNPJ alfanumérico); upload recusa CNPJ-base errado/vencido; nada de segredo em log. **Entregue**; falta rodar a migration num Postgres real e validar o Terraform (§14.3) |
| 2 ✅ | `SefazDfeClient` + scheduler + `sync.runner` em **homologação**; lote transacional; lease (depende de §14.3-1) | Testes de NSU/lease verdes; ciclo real em homologação sem 656. **Código e testes entregues**; o ciclo real em homologação depende dos endereços, do certificado de teste e da cadeia ICP-Brasil (§14.3) |
| 3 ✅ | Manifestação (210210) + `SUMMARY→MANIFESTED→FULL` + cancelamento | Nota de homologação chega `FULL` após ciência automática. **Código e testes entregues** (assinatura verificada, mTLS contra servidor local, Postgres real); falta o ciclo em homologação (§14.3-2) |
| 4 ✅ | Matcher, `SupplierItemMap`, cadastro de peça pelo item, telas `/notas` e conciliação | Segunda nota do mesmo fornecedor resolve sem ação. **Entregue** (API testada em Postgres real); as telas passam no typecheck mas não foram exercitadas num navegador; as rotas que elas usam são testadas por HTTP em Postgres real (fiscal.http.integration.spec.ts) |
| 5 | `stock-posting` (entrada, custo, estorno manual), `autoExport` | Testes de idempotência, rollback e estorno verdes; entrada reflete em `Part.stockQty` e `StockMovement` |
| 6 | Produção: KMS, alertas por canal, runbook, tenant piloto | Piloto 2 semanas sem 656 e sem divergência de estoque |
