# Spec — `dfe-gateway`: Distribuição DF-e centralizada para toda a rede

Status: **rascunho para revisão** · Escopo: novo `apps/dfe-gateway`, adaptadores em `apps/api` (Fixer) e no `rocket`, `infra/terraform` + `infra/helm`

Base normativa: a mesma de [nfe-import.md](nfe-import.md) (NT 2014.002 v1.40 para `NFeDistribuicaoDFe`, NT 2020.001 para a manifestação do destinatário). Este documento **não repete** o que a NT define; refere-se a ele por seção.

## 1. Contexto e problema

Hoje dois sistemas falam sozinhos com a SEFAZ:

| | `rocket` | Fixer (`fiscal-inbound`) |
|---|---|---|
| Consulta | poller `setTimeout` de 20 min por CNPJ, sem olhar o `cStat` | decide pelo `cStat`, lease, NSU transacional |
| Certificado | `.pfx` e senha em texto puro no Mongo | envelope AES-256-GCM |
| TLS com a SEFAZ | `rejectUnauthorized: false` | TLS mútuo, cadeia ICP-Brasil |
| Escopo | N empresas, 1 processo | 1 empresa por instância (1 tenant = 1 banco) |

A SEFAZ **bloqueia por CNPJ** (cStat 656, 1 h), não por sistema. Dois consumidores do mesmo CNPJ competem pelo `ultNSU` e se bloqueiam (nfe-import §6.6). Com uma rede de clientes, cada um com seu CNPJ, N instâncias do Fixer e o `rocket`, a coordenação "ninguém mais consulta este CNPJ" é impossível de garantir por convenção. Precisa ser **uma propriedade do sistema**.

## 2. Objetivos e não-objetivos

**Objetivos**
1. **Exatamente um consumidor por CNPJ**, garantido pelo sistema, não por procedimento.
2. Um único lugar com o cliente SEFAZ, o cofre de certificados e a política de consulta.
3. Entrega **at-least-once, ordenada por NSU e idempotente** aos sistemas clientes, sem perda de documento.
4. Cada produto (Fixer, `rocket`) cadastra o certificado **na sua própria interface**; o gateway nunca é exposto ao usuário final.
5. Isolamento entre clientes: um tenant não lê nem sabe da existência de outro.
6. Operável: métricas, alertas, runbooks, rotação de chave, recuperação de desastre.

**Não-objetivos (v1)**
- Conciliação, matching e entrada em estoque (ficam no Fixer; o gateway é fiscal, não de negócio).
- Emissão de NF-e, NFS-e, CT-e. Outros serviços de distribuição (CT-e, MDF-e) ficam como extensão (§16).
- Painel para o usuário final. Só há UI de operador (§11).
- Manifestação conclusiva (Confirmação, Desconhecimento, Não Realizada) no v1: a API expõe, mas a decisão é do produto cliente (§8.3).

## 3. Decisões de arquitetura

| # | Decisão | Motivo |
|---|---|---|
| D1 | `CNPJ` é a unidade de consumo; no máximo **uma credencial ativa por CNPJ** em todo o gateway | Garante o item 1 dos objetivos. Registro duplicado devolve `409` |
| D2 | Separar **dono da credencial** (um `Tenant`) de **assinantes** (`Subscription`, N por CNPJ) | `rocket` e Fixer podem receber as notas do mesmo CNPJ sem consultar duas vezes |
| D3 | O gateway **guarda o documento** (XML) até todos os assinantes confirmarem, mais retenção | Reentrega, reprocessamento e recuperação sem nova consulta à SEFAZ (o NSU já consumido não volta) |
| D4 | Entrega por **outbox** com transporte por assinatura (**webhook assinado**, **RabbitMQ** ou **Redis Streams**), e **reconsulta por NSU** como fonte da verdade | O transporte é só aviso; o cursor garante a correção, então trocar de transporte não afeta dados |
| D5 | Autenticação serviço a serviço por **OAuth2 client credentials** (Keycloak, que o Fixer já usa) | Padrão, rotacionável, escopos por tenant |
| D6 | **Postgres** próprio, sem Mongo | Lease com `FOR UPDATE SKIP LOCKED`, transações para NSU+documentos, mesma base de conhecimento do Fixer |
| D7 | Reaproveitar `fiscal-inbound` quase sem alteração: cliente SEFAZ, parsers, `decide.ts`, `secret-box`, `key-provider`, `pfx`, `event-xml` | Código já testado e revisado. Muda o **entorno** (multi-CNPJ, entrega), não o protocolo |
| D8 | O gateway **nunca** guarda regra de negócio de nenhum cliente | Evita que ele vire gargalo de produto |
| D9 | O `rocket` e o Fixer **perdem** o cliente SEFAZ próprio: passam a usar o gateway | Sem isso o item 1 dos objetivos não vale |

## 4. Visão geral

```
 Browser ─▶ Fixer web ─▶ Fixer api ─┐                          ┌─▶ SEFAZ (AN)
 Browser ─▶ rocket web ─▶ rocket ───┤  (OAuth2 + HTTPS)        │   NFeDistribuicaoDFe
                                    ▼                          │   NFeRecepcaoEvento
                            ┌───────────────┐   lease por CNPJ │
                            │  dfe-gateway  │──────────────────┘
                            │   api  +      │
                            │   worker(s)   │──▶ webhook assinado ─▶ Fixer api / rocket
                            └──────┬────────┘
                                   ▼
                         Postgres (dfe) · KMS · Redis (rate limit)
```

Componentes (um deploy, dois papéis, escalam separado):

- **api**: REST `/v1`, autenticação, cadastro de credencial, leitura de documentos, administração.
- **worker**: scheduler por CNPJ, cliente SEFAZ, parsing, manifestação, relay do outbox. Sem porta pública.

## 5. Modelo de dados

```prisma
model Tenant {                 // quem integra: "fixer:oficina-do-ze", "rocket"
  id          String   @id @default(cuid())
  slug        String   @unique
  kind        TenantKind          // FIXER | ROCKET | OTHER
  status      TenantStatus        // ACTIVE | SUSPENDED
  createdAt   DateTime @default(now())
  companies   Company[]
  subscriptions Subscription[]
}

model Company {                // um CNPJ de 14 posições
  id          String   @id @default(cuid())
  cnpj        String   @unique   // D1: global
  ownerId     String
  owner       Tenant   @relation(fields: [ownerId], references: [id])
  legalName   String?
  ufCode      Int?
  credential  Credential?
  syncState   SyncState?
  documents   Document[]
  subscriptions Subscription[]
}

model Credential {             // cifrada em repouso, igual a nfe-import §7.2
  id              String   @id @default(cuid())
  companyId       String   @unique
  environment     DfeEnvironment   // PRODUCTION | HOMOLOGATION
  pfxCiphertext   Bytes
  pfxPassCiphertext Bytes
  keyId           String           // qual chave mestra decifra
  subject         String
  certCnpj        String
  notBefore       DateTime
  notAfter        DateTime
  status          CredentialStatus // ACTIVE | DISABLED | EXPIRED
  enabled         Boolean  @default(false)
  autoManifest    Boolean  @default(false)
  version         Int      @default(1)
  uploadedBy      String           // sub do cliente + usuário final, para auditoria
}

model SyncState {              // 1 linha por CNPJ (era `id = 1` no Fixer)
  companyId           String   @id
  lastNsu             BigInt   @default(0)
  maxNsu              BigInt   @default(0)
  nextPollAt          DateTime @default(now())
  leaseUntil          DateTime?
  leaseOwner          String?
  lastStatusCode      Int?
  lastError           String?
  lastRunAt           DateTime?
  lastSuccessAt       DateTime?
  consecutiveFailures Int      @default(0)
  @@index([nextPollAt])
}

model Document {               // um documento distribuído, imutável
  id         String   @id @default(cuid())
  companyId  String
  nsu        BigInt
  schema     String             // resNFe | procNFe | resEvento | procEventoNFe
  accessKey  String?
  xml        Bytes              // gzip, como a SEFAZ entrega
  receivedAt DateTime @default(now())
  @@unique([companyId, nsu])    // idempotência da gravação
  @@index([companyId, accessKey])
}

model Subscription {           // quem recebe os documentos de um CNPJ
  id          String   @id @default(cuid())
  companyId   String
  tenantId    String
  transport   Transport         // WEBHOOK | RABBITMQ | REDIS_STREAM (§7.1)
  target      Json              // por transporte: { url } | { exchange, routingKey } | { stream }
  secretCiphertext Bytes?       // segredo de assinatura (só WEBHOOK)
  ackedNsu    BigInt   @default(0)   // cursor de confirmação, por assinante
  status      SubscriptionStatus     // ACTIVE | PAUSED | FAILING
  @@unique([companyId, tenantId])
}

model Delivery {               // outbox por assinante
  id             String   @id @default(cuid())
  subscriptionId String
  fromNsu        BigInt
  toNsu          BigInt
  attempts       Int      @default(0)
  nextAttemptAt  DateTime
  state          DeliveryState  // PENDING | DELIVERED | DEAD
  @@index([state, nextAttemptAt])
}

model AuditLog { id String @id @default(cuid()) at DateTime @default(now()) actor String action String companyId String? detail Json ip String? }
```

Notas:
- `Document` é gravado **na mesma transação** que avança `SyncState.lastNsu` (igual ao runner atual: o NSU só anda junto com os documentos).
- O `Document` guarda o **XML bruto**; o parsing em notas, itens e matching é do cliente. O gateway só extrai `schema` e `accessKey` para indexar.
- `Subscription.ackedNsu` é o que faz o cursor do cliente sobreviver a qualquer falha de webhook (D4).

## 6. API pública `/v1`

Convenções: JSON, erros em **RFC 9457** (`application/problem+json`), paginação por **cursor** (nunca offset), `Idempotency-Key` em todo `POST`/`PUT`, `Request-Id` devolvido, versionamento por prefixo.

### 6.1 Autenticação e autorização

- **Cliente a cliente**: OAuth2 **client credentials**; um client por tenant (`fixer:<slug>`, `rocket`). Token JWT com `tenant` e escopos: `credentials:write`, `documents:read`, `subscriptions:write`, `manifest:write`.
- **Isolamento**: toda consulta é filtrada por `tenantId` do token. Um recurso de outro tenant responde **`404`**, nunca `403`, para não revelar que existe.
- **Usuário final**: o gateway **não o autentica**. Quem autentica e autoriza o usuário (permissão `fiscal.manage`) é o produto; ele repassa o `X-Actor` (id do usuário) só para a auditoria.

### 6.2 Endpoints

```
PUT    /v1/companies/{cnpj}/registration         CADASTRO ÚNICO e idempotente: empresa + certificado (instala só se mudou) + flags + retomada de NSU. É o que os produtos chamam ao salvar
PUT    /v1/companies/{cnpj}                      cria/atualiza dados da empresa (nome, UF)
GET    /v1/companies/{cnpj}                      estado: credencial, sync, assinaturas

POST   /v1/companies/{cnpj}/credential/inspect   lê o .pfx e devolve subject/CNPJ/validade; não grava
PUT    /v1/companies/{cnpj}/credential           grava (pfxBase64, password, environment); 409 se outro tenant é dono do CNPJ
PATCH  /v1/companies/{cnpj}/credential           enabled, autoManifest (+ acknowledgeManifestDuty)
DELETE /v1/companies/{cnpj}/credential           remove; o SyncState e os documentos permanecem

GET    /v1/companies/{cnpj}/documents?afterNsu=&limit=      reconsulta por cursor (fonte da verdade)
GET    /v1/companies/{cnpj}/documents/{accessKey}           XML mais recente da chave

PUT    /v1/companies/{cnpj}/subscription         { transport, target }; devolve o segredo (WEBHOOK) UMA vez
POST   /v1/companies/{cnpj}/subscription/ack     { nsu }  confirma processamento até esse NSU
POST   /v1/companies/{cnpj}/sync/resume-from     { nsu }  decisão humana após 656 (nfe-import §6.6)

POST   /v1/companies/{cnpj}/manifestations       { accessKeys[], type }  (CIENCIA no v1)
GET    /v1/companies/{cnpj}/manifestations/{id}

GET    /healthz   /readyz   /metrics
```

### 6.3 Segurança do upload do certificado

O usuário envia o `.pfx` pela tela do **produto** (como hoje). O produto repassa ao gateway **em memória**, na hora, por TLS, sem gravar em disco, log, fila ou banco. O gateway é o único que o persiste, cifrado. A resposta do upload **nunca** devolve o `.pfx` nem a senha, só `subject`, `notAfter`, `certCnpj`. Não existe endpoint de leitura do material.

## 7. Entrega aos consumidores

A mensagem de aviso é **sempre a mesma**, qualquer que seja o transporte; o XML nunca viaja nela. O transporte é só **como o aviso chega**, escolhido por assinatura. O cursor (`GET /documents?afterNsu=` + `ack`) é a fonte da verdade em todos os casos.

### 7.1 Transportes

| Transporte | Para quem | Como publica | Garantia |
|---|---|---|---|
| `WEBHOOK` (padrão) | Qualquer consumidor com URL pública | `POST` HTTPS assinado (§7.2) | at-least-once, retry com backoff |
| `RABBITMQ` | `rocket` (já opera RabbitMQ via `amqplib`) | Exchange `dfe.documents` (topic), routing key `dfe.<tenantSlug>.<cnpj>`; publisher confirms; mensagem persistente | at-least-once; DLQ da fila do consumidor |
| `REDIS_STREAM` | Fixer (já usa Redis, sem broker novo) | `XADD dfe:<tenantSlug>` com `MAXLEN ~`; grupo de consumidores; `XACK` | at-least-once; `XAUTOCLAIM` recupera pendentes |

- Mensagem: `{ "v": 1, "companyCnpj", "fromNsu", "toNsu", "count", "emittedAt" }`, com `messageId` determinístico (`<subscriptionId>:<toNsu>`) para **deduplicação**.
- O **outbox** (`Delivery`) é o único ponto de decisão: um *relay* lê `Delivery PENDING` e publica pelo transporte da assinatura. Trocar de transporte **não** muda o modelo, o cursor nem o `ack`.
- Publicar só depois do commit do `Document` + `SyncState` (mesma transação do outbox), nunca antes: sem mensagem fantasma e sem documento sem aviso.
- **Isolamento por tenant**: cada consumidor recebe credenciais que só enxergam o próprio vhost/exchange/stream (RabbitMQ: usuário por tenant com permissão só na sua fila; Redis: ACL por prefixo `dfe:<tenantSlug>`). Um tenant não consome mensagem de outro.
- **Ordem**: dentro de um CNPJ é por NSU (uma partição lógica por CNPJ: routing key / stream por tenant com `toNsu` crescente). O consumidor **não** depende da ordem de chegada: aplica `afterNsu` e deduplica por `messageId`.
- **Consumidor atrasado ou fora do ar**: o aviso se acumula no broker (com limite). Estourou o limite ou a retenção do stream, perde-se o aviso e **não o dado**; o consumidor se recupera pelo cursor periódico (§7.3).
- Os transportes de fila não substituem o webhook para consumidores externos: são opcionais, ativados por assinatura.

### 7.2 Webhook

- `POST` ao `webhookUrl` com corpo `{ "companyCnpj", "fromNsu", "toNsu", "count" }`: **sem o XML**. O cliente busca por `GET /documents?afterNsu=` (D4). Isso mantém o payload pequeno, evita vazar XML em log de terceiros e deixa o gateway sem estado de entrega complexo.
- **Assinatura**: header `X-Dfe-Signature: t=<unix>,v1=<hex(HMAC-SHA256(secret, t + "." + body))>`. O cliente rejeita `t` com mais de 5 min (anti-replay) e compara em tempo constante.
- **Entrega**: at-least-once, retry com backoff exponencial e jitter (1 min → 6 h), **máximo 24 tentativas**, depois `DEAD` e `Subscription = FAILING`. Alerta ao operador. **Nenhum documento se perde**: o cliente se recupera pelo cursor.
- O endpoint do cliente responde `2xx` rápido e processa de forma assíncrona. `ack` só é enviado depois de persistir.
- **SSRF**: `target.url` só `https`, resolvida no envio e **bloqueando IPs privados, loopback e metadata** (`169.254.169.254`). Sem redirecionamento.

### 7.3 Contrato do consumidor (vale para os três transportes)

1. Ao receber o aviso, deduplicar por `messageId` e **buscar por cursor**: `GET /documents?afterNsu=<seu ackedNsu>` até esgotar.
2. Processar de forma idempotente (por `accessKey`/`nsu`) e só então chamar `ack`.
3. Rodar um **reconciliador** a cada 5 min: mesma busca por cursor, mesmo sem aviso. É ele que torna a entrega correta mesmo se o aviso se perder, o broker for limpo ou o consumidor ficar fora do ar.
4. Nunca confiar no conteúdo do aviso como dado fiscal: ele só diz "há coisa nova até o NSU X".

## 8. Sincronização

### 8.1 Scheduler e lease por CNPJ

Evolução do `SyncScheduler` atual: o lease sai de uma linha única para **uma linha por CNPJ**.

```sql
UPDATE "SyncState" s SET "leaseUntil" = now() + interval '5 minutes', "leaseOwner" = $owner
WHERE s."companyId" IN (
  SELECT s2."companyId" FROM "SyncState" s2
  JOIN "Credential" c ON c."companyId" = s2."companyId" AND c.enabled
  WHERE s2."nextPollAt" <= now() AND (s2."leaseUntil" IS NULL OR s2."leaseUntil" < now())
  ORDER BY s2."nextPollAt" LIMIT $batch
  FOR UPDATE OF s2 SKIP LOCKED)
RETURNING s."companyId";
```

- N workers disputam sem coordenação extra, e nenhum processa o mesmo CNPJ ao mesmo tempo.
- Concorrência por worker limitada (padrão **8** CNPJs simultâneos) e **taxa global** configurável (Redis), para não parecer ataque ao Ambiente Nacional.
- **Jitter** em `nextPollAt` para não alinhar todos os CNPJs no mesmo segundo.
- Renovação do lease por lote; perda do lease aborta sem gravar (como hoje).

### 8.2 Rodada e decisão

`runOnce(companyId)` é o `SyncRunner` atual parametrizado por CNPJ. **`decide.ts` é reaproveitado sem mudança**: 138 → `MORE`/`IDLE`, 137 → `IDLE`, 656 → `BLOCKED` por 1 h 5 min, 3 seguidos → desliga, rejeições de certificado → desliga, 589 → `RETRY` com alerta.

Intervalo mínimo entre consultas por CNPJ imposto **no gateway** (nunca abaixo do `nextPollAt` calculado), inclusive para `resume-from` e para qualquer chamada manual. Não existe endpoint "consultar agora".

### 8.3 Manifestação

`manifest.service` atual, por CNPJ. Ciência automática em lote (até 20 chaves) quando `autoManifest`. O dever de registrar depois a conclusiva (NT 2020.001, item 2.D) continua exigindo `acknowledgeManifestDuty`. As conclusivas ficam como endpoint, com decisão do produto (v1 só `CIENCIA`).

### 8.4 Casos de borda

| Caso | Tratamento |
|---|---|
| Certificado vence | alertas a 30, 15 e 7 dias; `EXPIRED` e `enabled=false` ao vencer; evento `credential.expiring` para a assinatura |
| Troca de certificado do **mesmo** CNPJ-base | preserva `SyncState` e documentos (renovação) |
| Troca de **raiz** de CNPJ | só depois de `DELETE` da credencial (regra do Fixer, rejeição 593) |
| CNPJ já tem dono | `409`, sem revelar quem. Para dividir o CNPJ, o dono cria `Subscription` para o outro tenant |
| 656 recorrente | desliga sozinho, alerta crítico, exige `resume-from` humano |
| Documento "veneno" | validado antes de gravar; contador `invalid`, nunca derruba o lote |
| Backlog grande no primeiro sync | teto de lotes por tick (já existe), `MORE` sem esperar o `idleDelay` |

## 9. Segurança

- **Cifragem**: envelope AES-256-GCM com DEK por segredo, AAD por campo, como em nfe-import §7.2. A diferença: o `KeyProvider` de produção é **AWS KMS** desde o dia 1, sem chave mestra em variável de ambiente (a plataforma já está na AWS). `EnvKeyProvider` só em dev/teste.
- **Rede**: o worker é a única peça que sai para a SEFAZ (egress restrito por NetworkPolicy aos hosts do Ambiente Nacional). A api não tem rota para a SEFAZ. O banco só aceita as duas.
- **Menor privilégio**: roles Postgres separados para api, worker e migração. A role da api **não lê** `*Ciphertext` além do necessário.
- **Segredos**: o `.pfx` decifrado vive só na memória do worker durante a rodada, nunca logado nem serializado em erro. Logs com redação (`pfx`, `password`, `secret`, XML).
- **Entrada**: limite de tamanho do `.pfx` (256 KB), validação de CNPJ (inclusive alfanumérico), rate limit por tenant, corpo máximo.
- **Auditoria**: todo upload, remoção, mudança de flag, `resume-from` e acesso administrativo grava `AuditLog` com `actor` (cliente + usuário final) e IP, **imutável** (sem `UPDATE`/`DELETE` para a role da aplicação).
- **Supply chain**: imagem distroless, dependências fixadas, SBOM e scan no CI, `npm audit` sem alta/crítica.
- **LGPD**: o XML tem dado pessoal de terceiros; retenção definida (§10), acesso só pelo tenant dono ou assinante, e sem XML em logs ou métricas.

## 10. Retenção e recuperação

- `Document` fica até **todos** os assinantes terem `ackedNsu ≥ nsu` **e** passados **90 dias** (configurável). Depois, purga em lotes.
- **Backup**: PITR do Postgres, RPO ≤ 5 min, RTO ≤ 1 h. Teste de restauração mensal.
- **Cursor perdido** (backup antigo): o NSU pode regredir; a SEFAZ reentrega a janela dos últimos documentos disponíveis (nfe-import §6.5). A idempotência por `(companyId, nsu)` e por `accessKey` nos clientes torna isso seguro.
- **Recuperação por reconsulta**: um cliente que perdeu dados reconsulta `GET /documents?afterNsu=0` sem tocar a SEFAZ.

## 11. Operação

### 11.1 Observabilidade

OpenTelemetry (traces, métricas, logs correlacionados por `request_id` e `company_id` hasheado).

Métricas mínimas:
- `dfe_sefaz_requests_total{cstat,env}`, `dfe_sefaz_latency_seconds`
- `dfe_sync_lag_seconds{company}` (agora − `lastSuccessAt`), `dfe_blocked_companies`
- `dfe_documents_ingested_total{schema}`, `dfe_invalid_documents_total`
- `dfe_delivery_pending`, `dfe_delivery_dead_total`, `dfe_delivery_latency_seconds`
- `dfe_credential_expiring{days}`
- `dfe_lease_lost_total`

### 11.2 SLOs e alertas

| SLO | Meta |
|---|---|
| Documento disponível para `GET /documents` após consulta da SEFAZ | 99,9% em < 1 min |
| Webhook entregue com sucesso na 1ª hora | 99% |
| Disponibilidade da api | 99,9% mensal |
| Sync "em dia" (CNPJ habilitado sem erro há < 2 h) | 99% dos CNPJs |

Alertas críticos (paginam): 3 × 656 seguidos, `DEAD` em entrega, certificado a 7 dias, worker sem lease por > 15 min, falha de KMS. Cada alerta aponta para um **runbook** em `docs/runbooks/dfe-gateway/`.

### 11.3 UI de operador

Superfície mínima e interna (não o usuário final): lista de CNPJs com estado, bloqueios, `resume-from`, reentrega e auditoria. Pode ser as próprias rotas administrativas da api com um client de escopo `admin`, atrás de VPN e SSO. **Não** é requisito do v1 além da leitura.

### 11.4 Deploy

Helm chart próprio (`infra/helm/dfe-gateway`), Terraform para Postgres, KMS e secrets. Rolling update; migrations compatíveis para frente (expand/contract). Réplicas: ≥ 2 api, ≥ 2 worker. **HPA** pelo `dfe_sync_lag_seconds`, não por CPU.

## 12. Integração nos clientes

### 12.1 Fixer

Já existe a interface `DfeSource` ([dfe-source.ts](../../apps/api/src/fiscal-inbound/sefaz/dfe-source.ts)) com `SefazDfeClient` como implementação. O plano:

1. Nova implementação **`GatewayDfeSource`**: `distribute` vira `GET /documents?afterNsu=`, `manifest` vira `POST /manifestations`.
2. O `SyncScheduler`/`SyncRunner` deixam de consultar a SEFAZ. Passam a ser **consumidores**: ao receber o webhook (ou periodicamente), puxam por cursor, rodam `processBatch` (que já é idempotente) e fazem `ack`.
3. `credential.service` deixa de guardar o `.pfx`. `upload`/`inspect`/`remove` viram chamadas ao gateway; a tela do passo 1 (**certificate-card**) não muda. `FiscalCredential` guarda só o estado espelhado (subject, validade, enabled).
4. `FISCAL_ENC_KEYS`, `fiscal.config.ts` (URLs da SEFAZ, `caPem`) saem do Fixer e vão para o gateway.
5. `matching/`, `invoices.service`, `batch.processor`, tela de conciliação e lançamento ficam **intactos**.

### 12.2 rocket

1. O poller `NfeDistributionPoller` é **removido**. O módulo ganha um cliente do gateway e um endpoint de webhook.
2. `legal-entity` deixa de guardar `certificatePfx`/`certificatePassword`; o upload da tela de entidade repassa ao gateway.
3. `NfeDistributionEventModel` é alimentado pelo mesmo `GET /documents`. `acknowledgeAutomatically` vira `autoManifest` no gateway.
4. **Certificados: o rocket CONTINUA com o dele** (a emissão de NF-e assina com o `.pfx`; só a *distribuição* sai do rocket). Ele cadastra e renova o certificado no gateway sozinho a partir da `LegalEntity` (ver 18.1); não há script de migração. O texto puro no Mongo é um problema à parte (fora desta spec).

### 12.3 Cutover seguro (por CNPJ)

1. Desligar o consumo antigo do CNPJ (Fixer `enabled=false` / `NFE_DISTRIBUTION_POLLER_ENABLED=false` no `rocket`).
2. Esperar **> 1 h** para o bloqueio da SEFAZ expirar.
3. Cadastrar no gateway com `lastNsu` do cliente anterior (`resume-from`), para não reprocessar. Documentos já consumidos pelo sistema antigo seguem no banco dele; a idempotência por `accessKey` evita duplicar.
4. Habilitar e acompanhar `dfe_sync_lag_seconds`.
5. Só então remover o código antigo (§15, fase 4).

## 13. Testes (critérios de aceite)

**Unidade e integração** (herdam os de nfe-import §12):
- `decide.ts` e `batch.processor` inalterados e verdes.
- Lease: 2 workers, 1 CNPJ → só um roda; worker cai → o outro assume em ≤ 5 min.
- Atomicidade: falha ao gravar o lote → `lastNsu` não anda.
- **Um consumidor por CNPJ**: segundo `PUT credential` do mesmo CNPJ por outro tenant → `409`; por um assinante → `404`.
- Isolamento: token do tenant A em recurso do tenant B → `404`, em **todos** os endpoints (teste parametrizado pela tabela de rotas).
- Transportes: aviso duplicado (mesmo `messageId`) processado uma vez; broker limpo e consumidor se recupera pelo cursor; usuário de um tenant sem permissão na fila/stream de outro; publicação só depois do commit.
- Webhook: assinatura inválida, `t` antigo, replay, redirect, IP privado (SSRF), entrega duplicada.
- Cursor: webhook perdido → o cliente se recupera por `GET /documents`.
- Retenção: purga só depois do `ack` de todos e do prazo.

**Contrato**: OpenAPI versionado; teste de contrato do Fixer e do `rocket` contra o spec (Pact ou equivalente).

**Carga**: 1.000 CNPJs, 1 consulta cada, sem passar o limite global; documentos em lote de 50; p99 da api < 300 ms.

**Caos**: matar worker no meio do lote; KMS indisponível (sync pausa, nada se perde); SEFAZ lenta (timeout, backoff).

## 14. Riscos

| Risco | Mitigação |
|---|---|
| Ponto único: gateway fora = nenhum cliente recebe notas novas | Os clientes continuam operando com o que já têm; alertas de lag; ≥ 2 réplicas; o atraso não perde nota (cursor) |
| Concentra **todos** os certificados da rede | KMS, rede restrita, auditoria imutável, role mínima, revisão de acesso trimestral, pentest antes do GA |
| Migração do `rocket` envolve certificados em texto puro | Script único e verificado; apagar o texto puro só depois de confirmar o cadastro no gateway; rotacionar o que vazou se o banco já foi exposto |
| Dois sistemas ainda consultando o CNPJ fora do gateway (ERP do contador) | Aviso na UI de cada produto (já existe), detecção de `656` com alerta, e cadastro bloqueado enquanto houver `656` recente |
| SEFAZ muda protocolo/versão | Camada `sefaz/` isolada, URLs e versão em configuração, testes com respostas gravadas |
| Webhook de cliente lento derruba a entrega | Fila por assinante, backoff, isolamento (um cliente `FAILING` não atrasa os outros) |

## 15. Fases de entrega

| Fase | Entrega | Saída verificável |
|---|---|---|
| 0 | Esta spec revisada, decisões da §17 fechadas | Aprovação |
| 1 | `apps/dfe-gateway` com modelo, cofre, scheduler multi-CNPJ, API de credencial e documentos, **sem** webhook | 1 CNPJ de homologação sincronizando de ponta a ponta, testes da §13 (unidade/integração) |
| 2 | Webhook + transportes RabbitMQ/Redis Streams + `ack` + manifestação + observabilidade e alertas | SLOs medidos, runbooks escritos |
| 3 | `GatewayDfeSource` no **Fixer**, em um tenant piloto | Piloto 7 dias sem 656 e sem divergência com o fluxo antigo |
| 4 | Migração do **`rocket`**, remoção dos clientes SEFAZ antigos, apagar certificados em texto puro | Zero código de consulta direta à SEFAZ fora do gateway |
| 5 | Rollout dos demais tenants Fixer; HPA, KMS multi-região, pentest | GA |

## 16. Extensões futuras (fora do v1)

- Outros serviços de distribuição (CT-e, MDF-e) pelo mesmo `Document.schema` e scheduler.
- Outros transportes (SQS/SNS, Kafka) como novos valores de `Transport`, sem mudar o contrato do §7.3.
- Certificado **A3 via HSM** / assinatura remota, para clientes que não podem entregar o `.pfx`.
- Painel de operador completo.

## 17. Decisões tomadas e pontos abertos

**Tomadas** (você decidiu): o cliente final cadastra o certificado na interface de cada produto; aviso por transporte por assinatura (webhook, RabbitMQ para o `rocket`, Redis Streams para o Fixer) + reconsulta por NSU; NestJS + Postgres em `apps/dfe-gateway` no monorepo do Fixer.

**Abertos, a decidir antes da fase 1:**
1. **Onde roda em produção**: o VPS do `rocket` ou AWS (onde já estão Terraform/KMS do Fixer)? Esta spec assume AWS pelo KMS; no VPS seria preciso outro `KeyProvider` (HashiCorp Vault ou KMS acessado de fora).
2. **Retenção de 90 dias** serve ao seu contrato com os clientes? Pode precisar ser maior por obrigação fiscal do cliente (5 anos), caso em que o gateway deve mandar o XML para o armazenamento do cliente e purgar o dele.
3. **Quem opera** o gateway (alertas, runbooks, acesso ao KMS), já que ele concentra todos os certificados.
4. Há **CNPJs que hoje são consultados por mais de um sistema** fora de vocês (ERP do contador)? Isso define a ordem do rollout e o texto dos avisos.
5. **Broker do gateway**: o RabbitMQ do `rocket` é compartilhado, ou o gateway sobe o seu (recomendado, para não acoplar disponibilidades)? E o Redis do gateway é separado do dos tenants Fixer?
6. **Ambiente de homologação**: pode usar certificado de teste próprio na fase 1? A SEFAZ de homologação costuma ter poucos dados.

## 18. Implementação v1: onde ela difere da spec (decisões de execução)

Implementado em [apps/dfe-gateway](../../apps/dfe-gateway/) (deploy: [deploy/README.md](../../apps/dfe-gateway/deploy/README.md)). As mudanças abaixo
vieram de executar na VM Oracle (sem AWS, sem Keycloak) e de testar contra Postgres real; **onde diz "spec" acima, vale esta seção**.

| Tema | Spec | Implementado | Por quê |
|---|---|---|---|
| Hospedagem e chave mestra | AWS KMS | VM Oracle; `EnvKeyProvider` (`DFE_ENC_KEYS` em `.env` `chmod 600`) | Sem KMS na VM. `KeyProvider` continua interface: OCI Vault entra sem migrar dado (só re-embrulha a DEK). **Risco assumido**: quem lê o `.env` e o dump do banco decifra os certificados |
| Autenticação | OAuth2 client credentials (Keycloak) | Chave de API por tenant (`dfe_<id>.<segredo>`, 256 bits, só o SHA-256 no banco, revogável) | Não há IdP na VM; o segredo tem entropia alta, então hash simples basta. Escopos por rota ficam para o v2 |
| Administração | API/UI de operador | CLI por SSH (`dfe_api node dist/cli.js`) | Superfície mínima: nenhuma rota administrativa exposta |
| Banco | Postgres próprio | Postgres próprio **em container** na VM, rede `dfe_net`, sem porta publicada | Decisão confirmada |
| `Idempotency-Key` | em todo POST/PUT | Não implementado | Todas as escritas já são idempotentes por construção (PUT, `ack` com GREATEST, ciência com UNIQUE) |
| Prisma | modelo em Prisma | SQL puro + `pg` (migrações em `migrations/`) | Mesmo padrão do `apps/notifications`; zero dependência de `@fixer/db` |
| Rate limit global na SEFAZ | Redis | Concorrência por worker (`DFE_CONCURRENCY`) + `nextPollAt` por CNPJ + jitter | Suficiente para a escala inicial; Redis fica para depois |
| RabbitMQ | broker próprio (recomendado) | **Broker do rocket** via `rocket_prod_network` (como os microservices do rocket) | Convenção já em uso na VM e o aviso não carrega dado sensível. Trocar é só mudar `RABBITMQ_URL` |
| Redis Streams | para o Fixer | Só para consumidor **na mesma rede** | Os tenants do Fixer ficam na AWS e não alcançam o Redis da VM: usam **WEBHOOK** (HTTPS) ou PULL |
| TLS | — | nginx do rocket, `dfe.maxgateway.com.br`, Let's Encrypt | Domínio e certbot já existem no rocket |
| Webhook (SSRF) | resolve e bloqueia IP interno | Idem, e **conecta no IP já validado** (sem nova resolução entre checagem e uso) | Fecha a janela de DNS rebinding |
| `FAILING` | — | Assinatura `FAILING` **não acumula avisos novos**; `PUT /subscription` reativa | O consumidor se recupera pelo cursor; evita fila infinita contra um destino morto |

Cobertura de teste: 132 testes (97 herdados do Fixer para cifra, parsers, decisão e cliente SEFAZ com TLS mútuo; 35 novos contra
Postgres real para API, isolamento por tenant, NSU atômico, 656, lease por CNPJ, ciência, outbox, webhook assinado, SSRF e ack).

### 18.1 Estado da integração

- **Fixer: implementada** em `apps/api/src/fiscal-inbound/gateway/` (ligada por `DFE_GATEWAY_URL` + `DFE_GATEWAY_API_KEY`; sem elas o módulo
  segue no modo direto). `CredentialService` envia o `.pfx` ao gateway e mantém só um espelho local (assunto, validade, flags; colunas de cifra vazias,
  `keyId = 'gateway'`); `GatewayConsumer` puxa por cursor, grava com o mesmo `processBatch` e só então faz `ack`; a ciência manual vira fila no gateway.
  O consumo é por **PULL** a cada 60 s (o gateway só tem documento novo de hora em hora, então consultar é barato); o webhook assinado é uma otimização
  opcional ainda não ligada no Fixer. Um tenant que já tinha NSU local retoma do mesmo NSU no gateway (`resume-from`).
- **rocket: implementada** em `backend/src/fiscal-distribution/gateway/` (branch `feat/dfe-gateway-consumer`; ligada pelas mesmas duas variáveis, sem elas vale o
  poller antigo). Correção de premissa: o rocket **não apaga** o certificado, porque a emissão de NF-e também o usa. `DfeGatewaySyncService` registra/renova o
  certificado no gateway sozinho (reenvia se a validade diferir; retoma do NSU que o rocket já tinha), consome por cursor, grava os mesmos `NfeDistributionEvent`
  (e guarda o `procNFe` no evento) e reage ao aviso do RabbitMQ (`dfe.rocket.*`, fila `q.dfe.documents`) com reconciliação a cada 5 min. Com o gateway ligado o
  poller antigo não roda e o `importXml` lê o XML do gateway por chave, **nunca** reconsulta a SEFAZ (isso consumiria o NSU e causaria 656).
- Contrato conferido de ponta a ponta: o `GatewayClient` do Fixer rodou contra o gateway real (inspect → empresa → certificado → flags → rodada com
  documentos → listagem por cursor → ack → ciência → resume-from → remoção), e um tenant não enxerga o CNPJ de outro (404).

### 18.2 Cadastro centralizado (`PUT /registration`)

Fixer e rocket reimplementavam as mesmas regras de cadastro e divergiam (o rocket só cadastrava no ciclo do reconciliador, até 5 min). As regras
foram para o gateway: **instala o certificado só se mudou** (mesmo titular, CNPJ, validade e ambiente; reenviar não gera versão nem auditoria),
**ciência automática exige `acknowledgeManifestDuty`**, **retoma do NSU do produto só com o NSU do gateway zerado** e **só liga a sincronização com certificado**.
Os produtos chamam um endpoint só, na hora de salvar. O reconciliador do rocket não reenvia certificado nem flags (não religa o que o gateway desligou de
propósito): só completa o cadastro se o gateway reportar que não tem certificado.
