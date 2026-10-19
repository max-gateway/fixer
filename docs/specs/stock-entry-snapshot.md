# Spec — Snapshot da entrada no estoque e valorização dos movimentos

Status: **implementado (2026-10-19)** · Escopo: `packages/db` (migração `20261019100000_stock_entry_snapshot`), `apps/api` (lançamento da nota, OS, `GET /parts/:id/entries`) · Relacionadas: [pricing.md](pricing.md) §4.3, [custos-e-impostos-ui.md](custos-e-impostos-ui.md) §6.8

## 1. Problema

O lançamento de uma nota decide custo, custo médio e (às vezes) preço. Depois disso, quase tudo de que essa decisão dependeu **muda**: a peça é reclassificada, o contador revisa o perfil, a regra de preço é editada, a tabela tributária ganha versão nova. Antes desta spec:

| O que existia | Limite |
|---|---|
| `PurchaseInvoiceItem.costSnapshot` / `saleTaxSnapshot` | Mutáveis (rascunho do último cálculo) e gravados **só** quando o lançamento pedia preço |
| `PartPriceHistory` | Só quando o preço **mudou**; sem documento, sem estoque, sem perfil, sem regra |
| `StockMovement` | Só quantidade e saldo: nenhum custo. Impossível reconstruir o custo médio ou o custo da peça vendida |
| `ServiceOrderPartLine` | Só `unitPrice`: o lucro da OS dependia do custo **atual** da peça, não do custo de quando ela saiu |

## 2. Decisões

| # | Decisão | Motivo |
|---|---|---|
| D1 | **Uma fotografia por entrada de nota** (`StockEntrySnapshot`, 1:1 com o `StockMovement` PURCHASE), gravada **sempre**, com ou sem preço, inclusive no lançamento automático | Histórico que só existe às vezes não é histórico |
| D2 | **Imutável**: trigger recusa `UPDATE`; correção é estorno + novo lançamento | Prova do que foi decidido; um registro editável não prova nada |
| D3 | `contentHash` = sha256 do `context` em **JSON canônico** (chaves ordenadas, decimais e datas em string) | Evidência de integridade que sobrevive ao JSONB (que reordena chaves). A API recalcula e expõe `intact` |
| D4 | Colunas tipadas para o que se consulta (custo, quantidade, preço depois, versões) + `context` JSON para o resto, com `schemaVersion` | Relatório sem ler JSON; formato livre para crescer sem migração |
| D5 | **Kardex valorizado**: todo movimento passa a ter `unitCost`, `avgCostBefore` e `avgCostAfter` | Custo médio reconstruível no tempo, CMV correto |
| D6 | Saída pela OS vale o **custo médio do momento**, congelado em `ServiceOrderPartLine.unitCost`; a devolução volta pelo **mesmo custo com que saiu** | O lucro da OS não muda quando a peça é recomprada mais cara depois |
| D7 | Sem backfill retroativo: movimentos e OS anteriores ficam com custo `null` | Inventar o custo de um momento passado seria pior que não ter |
| D8 | Campos reservados `rulesetVersion` (tax-engine) e `costProfileVersion` (cost-engine), nulos por ora | Quando o Fixer consumir os motores da plataforma, o snapshot já tem onde guardar a versão de cada um |

## 3. O que a fotografia guarda (`context`, `schemaVersion` 1)

| Bloco | Conteúdo |
|---|---|
| `document` | Chave, número, série, emissão, emitente (CNPJ, nome, UF, CRT), UF do destinatário, `idDest`, modalidade de frete |
| `item` | Nº do item, código do fornecedor, descrição, NCM, CEST, origem, CFOP, unidade, quantidade, fator, valores |
| `part` | Id, SKU, nome, modo de preço |
| `stock` | Quantidade que entrou; saldo, custo e custo médio **antes** e **depois** |
| `cost` | Custo unitário e total, perfil do CFOP, regime, **todos os componentes** (código, tratamento, valor, campo de origem, rateado?) e os alertas do item e da nota |
| `price` | Resultado (`APPLIED`, `UNCHANGED`, `NOT_REQUESTED`, `LOCKED`), preço antes e depois, sugerido, rascunho, ciência, margem, markup, flags, erro, id do `PartPriceHistory` e **a regra inteira** (escopo, método, valor, override de imposto, despesa, arredondamento, travas) |
| `saleTax` | Percentual, confiança, indisponibilidade e componentes com o motivo |
| `fiscal` | Regime e UF da oficina; enquadramento da peça (ST, monofásico, origem do dado, verificado); **perfil tributário** (RBT12, percentuais, quem validou) e **aceites do contador** por tabela e versão |
| `engines` | `taxRulesVersion` (hoje), `rulesetVersion` e `costProfileVersion` (futuros) |
| `posted` | Quando e por quem |

Mesmo sem pedido de preço o plano é calculado, para a fotografia registrar **o preço que a regra teria sugerido**. Se o plano não puder ser montado nesse caso, o lançamento segue e o motivo vai em `price.error`.

## 4. API

`GET /parts/:id/entries` (`pricing.read`, feature `fiscal`): as 50 entradas mais recentes da peça, cada uma com o resumo tipado, o `context` completo e `intact` (hash recalculado = hash gravado).

## 5. Fora do escopo

- **Estorno** da entrada (nfe-import §8.5) ainda é manual. Quando existir, ele grava um movimento `ADJUSTMENT` valorizado e referencia o snapshot estornado; o snapshot original nunca muda.
- **Entrada manual** de estoque (`POST /parts/:id/purchase`) não tem custo informado: o movimento fica com `unitCost` nulo e sem snapshot.
- Snapshot da **venda** (OS) com o imposto da saída: entra com a emissão fiscal da venda.

## 6. Testes

- Unitários: JSON canônico e hash independentes da ordem das chaves e estáveis na ida e volta pelo JSON; os quatro resultados de preço; plano ausente (`entry-snapshot.spec.ts`); custo congelado na saída e na devolução da OS (`service-orders.service.spec.ts`).
- Integração (Postgres real): snapshot com e sem preço, ligado ao movimento e ao histórico de preço; movimento valorizado; hash íntegro depois do JSONB; `UPDATE` recusado pelo trigger; `GET /parts/:id/entries` com `intact: true` (`invoices.integration.spec.ts`).
