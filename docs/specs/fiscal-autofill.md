# Preenchimento automático da configuração fiscal

Status: **F0 implementada (2026-10-19); F1 a F3 em rascunho** · Escopo: `apps/api/src/fiscal-settings`, novo `apps/api/src/fiscal-autofill`, `apps/web/src/app/(app)/configuracoes`, `packages/tax-rules` · Relacionadas: [integra-contador.md](integra-contador.md), [nfse-parametros-municipais.md](nfse-parametros-municipais.md), [tax-rules.md](tax-rules.md), [pricing.md](pricing.md) §12, [dfe-gateway.md](dfe-gateway.md)

## 1. Problema

Hoje, ao enviar o certificado de um CNPJ novo, o navegador consulta o CNPJ no CNPJá e grava razão social, UF, município (IBGE) e, **só se for do Simples/MEI**, o regime ([certificate-card.tsx](../../apps/web/src/app/(app)/configuracoes/certificate-card.tsx), [company-autofill.ts](../../apps/web/src/lib/company-autofill.ts)). Todo o resto a oficina digita, e normalmente não sabe os valores, porque eles estão com o contador:

| Campo | Onde fica | Hoje |
|---|---|---|
| `taxRegime` | `TenantFiscalSettings` | Só o Simples é preenchido. "Não optante" vira `null`, sem distinguir Presumido de Real |
| `issRate` | `TenantFiscalSettings` | Manual |
| `municipalServiceCode` | `TenantFiscalSettings` | Manual |
| `rbt12`, `rbt12AsOf` | `TenantTaxProfile` | Manual; sem ela o Simples fica `ESTIMADO`/indisponível |
| `icmsSalePct` | `TenantTaxProfile` | Manual (Presumido) |
| `stateTaxRegular` | `TenantTaxProfile` | Manual (PE); sem ela a antecipação usa o pior caso |

O certificado A1 só traz CNPJ, nome e validade. A consulta pública de CNPJ não traz receita, regime fora do Simples, nem dado municipal. **O certificado, porém, autentica a empresa em serviços do governo que têm esses dados.** É por aí que a automação passa.

## 2. Objetivos e não-objetivos

**Objetivos**
1. Depois do envio do certificado, a configuração fiscal fica **completa sem digitação** sempre que existe uma fonte oficial.
2. Todo valor preenchido sozinho diz **de onde veio, quando, e com que confiança** (§4).
3. Valores que mudam com o tempo (RBT12 todo mês, regime todo ano, ISS quando a lei municipal muda) são **atualizados sozinhos**, com aviso quando mudam.
4. Quando não há fonte, o sistema **pergunta uma coisa só, no lugar certo**, em vez de deixar o campo em branco sem explicar.

**Não-objetivos**
- Substituir o contador. O aceite do contador (`reviewedBy`, `TaxTableReview`) continua sendo o que leva o imposto de `ESTIMADO` a `CONFIRMADO` ([tax-rules.md](tax-rules.md) §6). O preenchimento automático só tira a digitação.
- Emitir declaração ou guia (PGDAS-D, DAS, DCTFWeb). Só **leitura**.
- Lucro Real com cálculo: o regime é identificado, mas o cálculo continua fora ([tax-rules.md](tax-rules.md) §4).

## 3. Fontes por campo

| Campo | Fonte primária | Fallback | Spec |
|---|---|---|---|
| Razão social, UF, município | CNPJá (já existe) | Nome do certificado | — |
| `taxRegime` = Simples/MEI | CNPJá (`company.simples`/`simei`, já existe) | Integra Contador | — |
| `taxRegime` = Presumido × Real | Integra Contador: **pagamentos (DARF)**, pelos códigos de receita | Pergunta guiada (§6.2) | [integra-contador.md](integra-contador.md) §5 |
| `rbt12`, `rbt12AsOf` | Integra Contador: **última declaração do PGDAS-D** | Estimativa pela receita registrada no Fixer (§5.3) | [integra-contador.md](integra-contador.md) §4 |
| Item da LC 116 / código de tributação nacional | **CNAE principal** (CNPJá) → `ServiceFiscalProfile` | Padrão de oficina: 14.01 | §5.1 |
| `issRate` | **NFS-e Nacional, parâmetros municipais** (mTLS com o certificado) | Tabela municipal curada em `packages/tax-rules` | [nfse-parametros-municipais.md](nfse-parametros-municipais.md) |
| `municipalServiceCode` | NFS-e Nacional, parâmetros municipais | Pergunta (o contador sabe) | [nfse-parametros-municipais.md](nfse-parametros-municipais.md) |
| `icmsSalePct` (Presumido) | Alíquota interna padrão da UF (`packages/tax-rules`; PE 20,5%) | Pergunta | §5.2 |
| `stateTaxRegular` (PE) | **Sem fonte definida** (questão aberta Q3) | Manual, pior caso enquanto não informado | — |
| Repartição ICMS/PIS/Cofins do Simples | Já calculada pela RBT12 (`simplesRate`) | — | [tax-rules.md](tax-rules.md) |

## 4. Proveniência

Cada valor preenchido pelo sistema guarda a origem. Sem isso não dá para saber se um valor pode ser atualizado sozinho, nem explicar o número na tela.

```prisma
enum FiscalValueSource {
  CNPJ_LOOKUP        // CNPJá
  INTEGRA_PGDASD     // Integra Contador, PGDAS-D
  INTEGRA_PAGAMENTOS // Integra Contador, DARF pagos
  NFSE_PARAMETROS    // NFS-e Nacional, parâmetros municipais
  TAX_RULES_DEFAULT  // valor padrão de packages/tax-rules (ex.: alíquota interna da UF)
  FIXER_ESTIMATE     // calculado com dados do próprio Fixer
  MANUAL             // digitado por alguém
}

// Um registro por campo: a origem do valor que está em uso hoje.
model FiscalFieldProvenance {
  orgId      String            @default(dbgenerated("app_org()")) @db.Uuid
  field      String            // "taxRegime", "issRate", "rbt12", ...
  source     FiscalValueSource
  confidence String            // OFICIAL | INFERIDO | ESTIMADO
  fetchedAt  DateTime
  reference  String?           // período (PA 2026-09), nº da declaração, código do serviço consultado
  evidence   Json?             // resumo do que a fonte respondeu (nunca o PDF ou o XML inteiro)
  updatedBy  String?           // userId quando MANUAL

  @@id([orgId, field])
  @@map("fiscal_field_provenance")
}
```

Regras:

- **R1. Valor manual não é sobrescrito sozinho.** Se o campo está `MANUAL` e uma fonte oficial traz valor diferente, o sistema **avisa** ("A Receita informa RBT12 de R$ X; o valor salvo é R$ Y") e a pessoa escolhe. Valor de fonte automática pode ser trocado por fonte de confiança igual ou maior.
- **R2. Confiança:** `OFICIAL` = a fonte é o próprio registro do governo (PGDAS-D, parâmetros municipais). `INFERIDO` = deduzido de dado oficial por regra do Fixer (regime pelos códigos de DARF, LC 116 pelo CNAE). `ESTIMADO` = calculado sem fonte oficial (receita no Fixer, alíquota padrão da UF). `INFORMADO` = digitado por alguém (fonte `MANUAL`).
- **R1a. Valor sem proveniência** (gravado antes desta tabela existir) conta como digitado: não se sabe de onde veio.
- **R3. Mudou valor que entra no imposto → cai o aceite do contador**, como já acontece hoje com qualquer percentual (`TenantTaxProfile`). Atualização mensal da RBT12 é o caso comum: ver Q1.
- **R4.** `FiscalAuditLog` registra cada consulta feita com o certificado (serviço, período, resultado, sem conteúdo fiscal).

## 5. Regras de derivação (sem integração nova)

### 5.1 Serviço pela CNAE

A CNAE principal já vem na consulta (`cnae_principal`). Uma tabela em `packages/tax-rules` (`cnae-lc116`) liga CNAE a item da LC 116 e ao código de tributação nacional da NFS-e, com fonte na tabela de correspondência da CONCLA/IBGE (**a confirmar**). Para oficina:

| CNAE | Descrição | LC 116 | cTribNac |
|---|---|---|---|
| 4520-0/01 | Manutenção e reparação mecânica de veículos automotores | 14.01 | 14.01.01 (**conferir no anexo da NFS-e Nacional**) |
| 4520-0/02 … 4520-0/07 | Lanternagem, elétrica, alinhamento, tapeçaria, lavagem, instalação | 14.01 / 14.05 / 14.06 | **a levantar** |

Se a principal não for serviço (oficina registrada como comércio de autopeças, 45.30), vale a primeira **CNAE secundária** que está na tabela, com confiança `INFERIDO`. O resultado aponta para um `ServiceFiscalProfile` que já existe (`LC116_14_01`). `verified` continua `false` até o contador confirmar. CNAE fora da tabela → fallback 14.01 com confiança `ESTIMADO`.

### 5.2 ICMS da venda (Presumido)

Se o regime é Presumido e `icmsSalePct` está vazio, usar a alíquota interna padrão da UF, se `packages/tax-rules` tiver a UF (hoje só PE, 20,5%), com confiança `ESTIMADO`. A tela explica que peça com ST não paga ICMS na venda e que o valor é a alíquota padrão, não a do produto.

### 5.3 Estimativa de RBT12 pelo Fixer

Fallback quando o Integra Contador não responde (sem contrato, sem autorização, empresa fora do Simples por pouco tempo): soma da receita das ordens de serviço faturadas nos 12 meses anteriores. Só vale se o tenant usa o Fixer há pelo menos 12 meses e fatura nele todas as vendas. Fica sempre `ESTIMADO`, com o período coberto na tela. Empresa com menos de 12 meses de atividade fica sem valor (a proporcionalização está fora do escopo de [tax-rules.md](tax-rules.md) §5).

## 6. Orquestração

### 6.1 Do navegador para a API

Hoje a sequência roda no navegador (`UploadForm.mutationFn`). Passa para a API, num serviço `FiscalAutofillService`:

```
POST /fiscal/credentials (certificado salvo)
  └─ outbox: fiscal.credential.enrolled
       └─ FiscalAutofillJob(orgId, motivo = ENROLL)
            1. CNPJá               → empresa, município, Simples/MEI, CNAE      (já existe, sai do browser)
            2. CNAE → LC 116       → serviço                                  (§5.1)
            3. NFS-e parâmetros    → issRate, municipalServiceCode            (precisa de 1 e 2)
            4. Integra Contador    → regime (se não for Simples), RBT12       (precisa do consentimento, §7)
            5. Defaults            → icmsSalePct                              (precisa de 4)
            6. Readiness           → recalcula taxReadiness e grava o resumo
```

- Cada passo é **idempotente** e independente: falha num passo não desfaz os outros, e o job registra o estado de cada um (`OK`, `SEM_DADO`, `FALHOU`, `PULADO`, `AGUARDANDO_CONSENTIMENTO`).
- `GET /fiscal/autofill` devolve o último job, passo a passo. A tela mostra o progresso ("Consultando a prefeitura…") e o resultado de cada campo, com a origem.
- `POST /fiscal/autofill` (permissão `fiscal.settings`) roda de novo sob demanda. Substitui o "Atualizar pela Receita" de `company-overview.tsx`.
- Troca de CNPJ (certificado de outra empresa): mesmo comportamento de hoje (`settingsFromHints(..., reset = true)`), agora no servidor. Zera também as proveniências e os campos de imposto do CNPJ antigo.

### 6.2 Quando não há fonte: a pergunta guiada

Se, depois do job, o regime continua `null` e a empresa não é do Simples, a tela mostra **uma pergunta**: "Sua empresa é do Lucro Presumido ou do Lucro Real? Se não souber, pergunte ao contador." com as duas opções e "não sei" (que mantém `null` e o aviso de prontidão). O mesmo vale para os outros campos sem fonte: a pergunta aparece no lugar onde o campo é usado, nunca como formulário genérico.

### 6.3 Atualização periódica

| Gatilho | O que roda |
|---|---|
| Todo mês, no dia 21 (o PGDAS-D vence no dia 20) | Passo 4, RBT12 (Simples) |
| Janeiro, e quando a Receita muda a situação no Simples | Passo 4, regime; passo 1 |
| Todo mês | Passo 3, ISS (lei municipal muda pouco, mas muda) |
| Município ou CNAE mudou na consulta | Passos 2 e 3 |
| Certificado renovado (mesmo CNPJ) | Nada novo; continua o calendário |

O agendamento usa o mesmo worker da sincronização fiscal (`sync.runner`), com lease por tenant. A atualização segue R1 e R3. Quando um valor muda, a tela de configuração e o aviso da nota mostram o que mudou ("RBT12 atualizada com o PGDAS-D de 09/2026: R$ X → R$ Y").

## 7. Consentimento

Consultar a Receita (Integra Contador) com o certificado é diferente de baixar notas (DF-e). O envio do certificado **não** autoriza isso sozinho. A tela de certificado ganha uma opção separada, desligada até a pessoa marcar:

> **Buscar os dados de imposto na Receita Federal.** O Fixer usa o certificado para ler o regime tributário, as declarações do Simples (PGDAS-D) e os pagamentos de tributos federais. Só leitura: nada é declarado nem pago. Você pode desligar quando quiser.

`FiscalCredential.taxDataConsent` (`Boolean`, padrão `false`), `taxDataConsentAt` e `taxDataConsentById`. Desligar apaga os dados sem valor fiscal em uso (evidências) e para as atualizações; os valores já gravados ficam, marcados como sem atualização. A consulta aos parâmetros municipais da NFS-e é pública para quem tem certificado e não lê dado sigiloso da empresa: não precisa desse consentimento (ver [nfse-parametros-municipais.md](nfse-parametros-municipais.md) §6).

### 6.4 O que a F0 implementou

- `POST /fiscal/autofill` (`fiscal.manage`) roda **síncrono** e devolve o relatório (passos e campos, com `PREENCHIDO`, `IGUAL`, `CONFLITO`, `LIMPO`, `SEM_DADO`); `GET /fiscal/autofill` (`invoices.read`) devolve a proveniência e `simplesOptant`. O job em fila (§6.1) fica para a F2, quando entram consultas pagas e lentas.
- O envio do certificado chama `POST /fiscal/autofill { cnpj }` em vez de consultar o CNPJ no navegador (`company-autofill.ts` saiu).
- Troca de CNPJ: **outra raiz** zera regime e perfil de imposto (RBT12, ICMS, percentuais, aceite do contador); **mesma raiz** (outro estabelecimento) zera só município, ISS, código municipal, CNAE e serviço.
- `TenantFiscalSettings` ganhou `cnae` e `lc116Item`; `PUT /fiscal/settings` e `PUT /pricing/tax-profile` marcam como `MANUAL` o que mudou.
- Tela: origem de cada dado, avisos de conflito e a pergunta do regime, que salva a resposta e roda o preenchimento de novo (o ICMS padrão do Presumido depende dela).
- `packages/tax-rules`: tabela `cnae-lc116` (com `verify:sources` contra o Planalto e o IBGE) e `internalModalRatePct`.

## 8. Fases

| Fase | Entrega | Custo externo | Depende de |
|---|---|---|---|
| **F0** ✅ | Preenchimento na API (§6.1, síncrono: §6.4) com os passos 1, 2, 5 e 6; proveniência (§4); pergunta guiada do regime (§6.2); tabela `cnae-lc116` | nenhum | — |
| **F1** | ISS e código municipal pela NFS-e Nacional | nenhum | F0, Q4 |
| **F2** | Integra Contador: RBT12 e regime; consentimento (§7) | contrato SERPRO, por consulta | F0, Q2 |
| **F3** | Atualização periódica (§6.3), avisos de divergência, estimativa de RBT12 pelo Fixer (§5.3) | por consulta (F2) | F1, F2 |

F0 já resolve o pior caso de hoje: Presumido/Real deixam de ficar em branco sem explicação.

## 9. Dependências em `packages/tax-rules`

- **Anexo III do Simples (serviços).** A oficina presta serviço (Anexo III) e vende peça (Anexo I). Hoje só existe `simples-comercio` (Anexo I). Para optante do Simples, o ISS da NFS-e não é a alíquota municipal: é a parcela do ISS dentro da alíquota efetiva do Anexo III, que depende da RBT12. Sem essa tabela, `issRate` do Simples não fecha mesmo com a RBT12 automática. Nova tabela `simples-servicos`, com o mesmo padrão de fonte e verificação.
- **`cnae-lc116`** (§5.1).
- **Alíquota interna padrão por UF** fora de PE (§5.2), quando houver clientes nessas UFs.

## 10. Questões abertas

- **Q1.** A RBT12 muda todo mês. Se cada atualização derrubar o aceite do contador (R3), o Simples fica `ESTIMADO` quase sempre. Proposta: o aceite do contador vale para o **perfil** (percentuais e overrides), e a RBT12 vinda do PGDAS-D (`OFICIAL`) não derruba o aceite, porque foi o próprio contribuinte que a declarou. Precisa de decisão de produto e de um contador.
- **Q2.** Modelo de autorização no Integra Contador: dá para o contribuinte autorizar o Fixer só assinando o termo com o próprio e-CNPJ, sem passar pelo e-CAC? Ver [integra-contador.md](integra-contador.md) §3.
- **Q3.** Fonte da regularidade na SEFAZ-PE (`stateTaxRegular`): existe consulta pública por CNPJ ou um serviço com certificado? Levantar.
- **Q4.** Cobertura real dos parâmetros municipais nos municípios dos clientes (Recife, Jaboatão, Olinda, Caruaru…). Ver [nfse-parametros-municipais.md](nfse-parametros-municipais.md) §7.
