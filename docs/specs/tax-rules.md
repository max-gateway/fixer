# Tabelas de regra tributária (`packages/tax-rules`)

Status: **rascunho para revisão** · Escopo: `packages/tax-rules` (dado + funções puras), integração futura em `apps/api/src/pricing` e `fiscal-inbound/tax` · Relacionada: [pricing.md](pricing.md) §5.5, §12, §13, §14

> **Isto não é parecer contábil.** As tabelas foram transcritas do texto oficial (Planalto, lido em 2026-10-13), mas nenhuma foi validada por contador. Toda tabela nasce com `validatedBy: null` e a lista de `caveats` do que não cobre.

## 1. Decisão

O [pricing.md](pricing.md) §12/§14 proibia o sistema de trazer alíquota própria porque nada tinha sido conferido na lei. Agora o texto oficial foi lido, então **o sistema passa a trazer as tabelas legais**, e o que continua sendo do tenant é o que a lei não decide:

| Dado | Quem fornece |
|---|---|
| Anexo I do Simples (faixas, alíquota nominal, parcela a deduzir, repartição) | `packages/tax-rules` |
| Lista de autopeças monofásicas (Lei 10.485/2002) | `packages/tax-rules` |
| Calendário e alíquotas fixas da transição IBS/CBS | `packages/tax-rules` |
| RBT12, regime, enquadramento confirmado por peça, aceite do contador | tenant (`TenantTaxProfile`, sob RLS) |
| Alíquota de referência de CBS/IBS, MVA e alíquota interna de ST por UF, lista de produtos com alíquota reduzida da reforma | **ainda sem fonte**: ficam fora (§5) |

`TenantTaxProfile.simplesEffectiveRatePct` e as `*SharePct` deixam de ser o caminho principal e viram **override** do contador, como `PricingRule.taxPctOverride` já é.

## 2. O que está implementado (2026-10-13)

Dez tabelas em `packages/tax-rules`, todas de texto oficial (Planalto, Confaz, Câmara), com `sources`, `retrievedAt`, vigência, `caveats` e `validatedBy: null`. `TAX_RULES_PACKAGE_VERSION` junta as versões e vai no snapshot de cada preço.

| Tabela | Fonte | Vigência | API |
|---|---|---|---|
| `simples-comercio` | LC 123/2006, Anexo I (LC 155/2016); **LC 214/2025, Anexo XVIII** (arts. 519 e 544, III) | 2018 a 2026; 2027-28; 2029; 2030; 2031; 2032; 2033+ | `simplesRate(rbt12, data)`: faixa, alíquota efetiva, cada tributo (inclui CBS e IBS) |
| `monofasico-autopecas` | Lei 10.485/2002, Anexos I e II e art. 5º | até **2026-12-31** (revogada pela LC 214, art. 542) | `monofasicoAutopeca(ncm, data)` |
| `ibs-cbs-transition` | LC 214/2025, arts. 342 a 369, 501, 542 | 2026 a 2033 | `transitionFor`, `legacyTaxes` |
| `ibs-cbs-referencia` | LC 214/2025, arts. 349 a 359, Anexos I a XVI | 2027 a 2033, **pendente** | `referenceRate(ano)`, `reducedRateForNcm(ncm)` |
| `st-autopecas-anexo-ii` | Convênio ICMS 142/2018, Anexo II (131 itens CEST+NCM) | 2022-05-02 em diante | `stAutopecaItems(ncm)`, `stAutopecaCest(cest)` |
| `st-autopecas-protocolo` | Protocolo ICMS 41/2008 (UFs de destino por período; SP sai em 2026-10-01) | 2023-02-01 em diante | `stProtocolo(cest, uf, data)` |
| `icms-interestadual` | Res. Senado 22/1989 e 13/2012 | 2013 em diante | `interstateRate(origem, destino, importado)` |
| `federal-lucro` | Leis 9.249/95, 7.689/88, 9.715/98, 9.718/98, 10.637/02, 10.833/03; LC 224/2025 | PIS/Cofins até 2026-12-31 | `presumidoCommerce(data, acimaDe5M)`, `federalLines` |
| `cfop` | Convênio s/nº 1970, Anexo II (Ajustes SINIEF 03/24 e 39/25), 695 códigos | 2024-06-01 em diante | `cfopInfo`, `cfopProfile` |
| `cst-csosn` | Convênio s/nº 1970, Tabelas A e B, CRT e CSOSN (Ajustes SINIEF 39/23 e 20/24) | 2023-12-01 em diante | `icmsCreditAllowed`, `isStPaidBefore` |

Achados que mudam o produto:

- **O Anexo I do Simples muda em 2027.** PIS e Cofins saem da repartição, entram CBS e IBS, e o ICMS migra para o IBS até 2033. A 6ª faixa tem nominal 18,90% em 2027-28 no texto da lei.
- **O monofásico acaba em 2027-01-01.** A função devolve `FORA_DE_VIGENCIA` depois disso.
- **Autopeças não têm alíquota reduzida na reforma**, exceto os acessórios para pessoas com deficiência do Anexo V (60%, NCM 8708.29.99 e 8708.99.10).
- **A alíquota de referência da CBS e do IBS ainda não existe** (Senado, art. 349). A tabela guarda o rito e o prazo.

### 2.1 Regras que o código segue

- **Aritmética em `bigint`**, sem ponto flutuante; saídas em string, prontas para `Prisma.Decimal`.
- **Toda consulta leva a data**; fora da vigência a função diz isso, não devolve o valor antigo.
- **Entrada mais específica ganha** no monofásico; **desdobramento herda o regime do código-pai** (Cosit 220/2021).
- **`DEPENDE`** significa que o NCM sozinho não decide (ex-tarifário ou Anexo II): a pessoa confirma.
- **Não inventa**: o que a lei deixa para ato do Senado ou do TCU fica `null`.
- **O que é regra do Fixer, e não texto legal**, está marcado: as naturezas de CFOP que contam como revenda e os CST/CSOSN que dão crédito.

## 3. Pronto para a nova tributação

| Período | Regra | Efeito no Fixer |
|---|---|---|
| **2026** | CBS 0,9% e IBS 0,1% de teste, compensados com PIS/Cofins; **não se aplicam a optantes do Simples** (art. 348, III, c) | Preço pelo regime atual |
| **2027–2028** | IBS 0,05% + 0,05%; CBS = referência − 0,1 p.p.; PIS/Cofins extintos; Simples com Anexo XVIII | Simples calcula (CBS e IBS dentro da efetiva); Presumido e monofásico viram `REFORMA_SEM_ALIQUOTA` e `REGRA_FORA_DE_VIGENCIA` |
| **2029–2032** | ICMS reduzido 10, 20, 30 e 40%; IBS cresce na repartição do Simples | `legacyTaxes(data)` diz quanto do ICMS resta |
| **2033** | ICMS extinto | IBS ocupa a parcela do ICMS |

## 4. Integração (feita)

1. `TenantTaxProfile` ganhou `rbt12`, `rbt12AsOf` e `icmsSalePct`. Mudar qualquer percentual derruba a validação do contador.
2. `saleTax()` calcula **Simples** (pela tabela da data, com override do contador) e **Lucro Presumido** (IRPJ 1,2% + CSLL 1,08% + PIS 0,65% + Cofins 3% + ICMS informado; zera PIS/Cofins se monofásico e ICMS se ST; majoração da LC 224 quando a RBT12 passa de R$ 5 milhões). **Lucro Real** continua sem cálculo: IRPJ e CSLL incidem sobre o lucro e PIS/Cofins admitem crédito.
3. Motivos de indisponibilidade: `SEM_ALIQUOTA`, `REPARTICAO_FALTANDO`, `RBT12_FORA_DO_SIMPLES`, `REGRA_FORA_DE_VIGENCIA`, `REFORMA_SEM_ALIQUOTA`, `REGIME_NAO_SUPORTADO`.
4. `rules.ts` do fiscal-inbound reexporta CFOP/CST do pacote; `TAX_RULES_VERSION` é a versão do pacote.
5. Tela `/configuracoes/precificacao`: RBT12, data de referência, ICMS na venda; alíquota efetiva manual virou override.

6. **Avisos por item** (`apps/api/src/pricing/tax-notes.ts`): cruzam o XML com `monofasicoAutopeca` e `stAutopecaItems` (nota diz monofásico e o NCM não está na lista, NCM na lista sem indicação na nota, NCM "Ex" ou do Anexo II, ST na nota fora do Anexo II e o inverso). Aparecem no painel da nota e não mudam o cálculo.
7. **Aceite por tabela e versão:** ver §6.
8. **Tela** `/configuracoes/precificacao`, seção 4: cada tabela com versão, vigência, fontes oficiais com link e o que não cobre (`GET /pricing/tax-tables`).

9. **Verificação contra o texto oficial** (`npm run verify:sources` em `packages/tax-rules`): baixa as fontes (Planalto, Confaz, Câmara), extrai os dados de novo e compara com as tabelas. Cobre as 10 tabelas em 11 verificações: Anexo I e XVIII do Simples (faixas, deduções e repartições), Anexos I e II da Lei 10.485, os 131 itens do Anexo II do Convênio 142, as UFs e CEST do Protocolo 41/2008 (acusa alteração nova do protocolo), CFOP (acusa nova versão no menu do Confaz), CST, CSOSN e CRT, as frases-chave das resoluções do Senado e das leis federais, os artigos da LC 214 e o cruzamento dos anexos de redução com os NCM de autopeças. Avisa quando passa o prazo do Senado (31/10) sem a alíquota de referência preenchida. Saída 0 = tudo bate, 1 = alguma tabela diverge da lei, 2 = não deu para baixar. `-- <id ou tabela>` roda só uma; `--json` para máquina.

10. **Agendamento (máquina de desenvolvimento):** `scripts/register-weekly.ps1` registra no Agendador de Tarefas do Windows a tarefa "Fixer - verificar tabelas tributarias" (segunda 9h; se o computador estava desligado, roda ao ligar; só com rede). `scripts/verify-weekly.ps1` grava o relatório em `%LOCALAPPDATA%\fixer\tax-rules-verify\` (`ultimo.txt` e os 20 mais recentes) e mostra uma notificação do Windows quando alguma tabela diverge, não dá para baixar ou há aviso. Remover: `register-weekly.ps1 -Remove`. Em CI ou no servidor, o mesmo `npm run verify:sources` serve (saída 1 = lei mudou).

11. **Prontidão do imposto** (`apps/api/src/pricing/tax-readiness.ts`): a mesma conta alimenta a tela de configuração (`GET /pricing/tax-profile` devolve `readiness`) e o passo "Precificar" da nota (`taxReadiness` no plano): regime informado, dados do regime (RBT12 no Simples, ICMS da venda no Presumido), perfil validado e tabela do regime validada; a de monofásico é opcional. Lucro Real não é suportado.
12. **UI.** Configuração (`/configuracoes/precificacao`) em três abas: Regra de preço (regra padrão e exceções), Imposto (checklist de prontidão e formulário que mostra só os campos do regime; percentuais do contador num bloco recolhido) e Tabelas (agrupadas por função, com "validar as tabelas do seu regime" de uma vez). A aba aberta vem de `?aba=`. Nota (`/notas/[id]`): aviso único no topo com o que falta e link para a aba certa, etiqueta de imposto por item (confirmado, estimado, definido, indisponível) e gaveta "Por que esse preço?" com a conta, o imposto parte a parte, os avisos fiscais, o histórico e a confirmação do enquadramento.

13. **Componentes (shadcn).** `apps/web/src/components/ui/` ganhou Tooltip, Alert, Checkbox, Switch, ToggleGroup, RadioGroup, Accordion, Collapsible, InputGroup, Table, Kbd, AlertDialog, Slider e Command (`cmdk`); `Hint` (dica no mouse e no teclado, popover no toque) e `UnitInput` (campo com R$ ou %) são composições do projeto. O seletor deslizante `MarkupSlider` serve à regra de preço (margem 0 a 70% ou markup 0 a 200%, com conversão entre os dois) e a cada item da nota (botão "Ajustar o preço pelo markup": arrasta, vê preço e margem líquida, avisa abaixo da margem mínima ou do custo e só grava ao soltar; os marcadores "regra" e "atual" levam ao preço exato). A conta do cliente é só prévia: a API recalcula ao salvar.

**Falta:** adicional do IRPJ e Lucro Real por margem.

## 5. Fora do escopo (sem fonte federal única)

- **ICMS interno por UF, MVA e base de cálculo da ST**: vêm da legislação de cada um dos 27 estados. O custo não precisa (o XML traz o ST pago); o ICMS da venda do Presumido é informado pelo tenant.
- **Antecipação e DIFAL por UF.**
- **Alíquotas de referência de CBS e IBS**, até o Senado fixar; **cClassTrib** da NF-e (tabela da Nota Técnica); regimes específicos e Imposto Seletivo.
- **Alterações por decreto** na lista monofásica (Lei 10.485, art. 3º, § 1º): conferir na TIPI.
- **Optante do Simples recolhendo IBS/CBS por fora do DAS**; **proporcionalização da RBT12**; adicional do IRPJ.

## 6. Validação pelo contador (por tabela)

O pacote nunca marca uma tabela como validada (`validatedBy` é sempre nulo): quem valida é a organização, e o aceite é dado **tabela a tabela, na versão em uso** (`TaxTableReview`: `tableId`, `version`, `reviewedBy`, `reviewedAt`; RLS por `orgId`). Mudou a versão da tabela, o aceite daquela tabela cai, e só ela.

O imposto sobre a venda sobe de `ESTIMADO` a `CONFIRMADO` quando **todas** estas condições valem (`saleTax` e `requiredTables`):

1. o contador validou o perfil (RBT12 e percentuais; muda qualquer um, cai);
2. a peça tem o enquadramento confirmado (ou dado fiscal verificado);
3. as tabelas de que o cálculo depende estão validadas na versão em uso: `simples-comercio` no Simples, `federal-lucro` no Presumido e, nas peças monofásicas, também `monofasico-autopecas`.

`POST /pricing/tax-tables/:id/review` exige `fiscal.verify` (mesma permissão da validação do perfil). `GET /pricing/tax-tables` lista cada tabela com `review` (`current` falso = aceite de versão anterior). A tela `/configuracoes/precificacao`, seção 4, mostra o status e o botão por tabela.

## 7. Fontes

Todas lidas no texto oficial em 2026-10-13:

- [LC 123/2006 (Planalto)](https://www.planalto.gov.br/ccivil_03/leis/lcp/lcp123.htm), Anexo I.
- [Lei 10.485/2002, texto compilado (Planalto)](https://www.planalto.gov.br/ccivil_03/leis/2002/l10485compilado.htm), Anexos I e II, arts. 3º e 5º.
- [LC 214/2025 (Planalto)](https://www.planalto.gov.br/ccivil_03/leis/lcp/lcp214.htm), arts. 342–369, 501, 542 (com as alterações da LC 227/2026).
