# Integra Contador (SERPRO): RBT12 e regime tributário

Status: **rascunho para revisão; depende de teste no ambiente trial** · Escopo: novo serviço de plataforma `integra-contador` (ao lado de `cnpj-lookup`), cliente em `apps/api/src/fiscal-autofill` · Relacionadas: [fiscal-autofill.md](fiscal-autofill.md), [tax-rules.md](tax-rules.md), [dfe-gateway.md](dfe-gateway.md)

> O que está marcado **a confirmar** veio da documentação pública do SERPRO lida em 2026-10-19, mas não foi testado. A fase de prova (§8) existe para isso.

## 1. Por quê

Os dois dados que mais pesam no imposto da oficina só existem na Receita:

- **RBT12** (Simples): sem ela, a alíquota efetiva do Anexo I/III não sai, e o preço fica `ESTIMADO`. A oficina quase nunca sabe o valor.
- **Presumido × Real**: a consulta pública de CNPJ só diz "não optante do Simples".

O Integra Contador é a API oficial (Receita + SERPRO) para software ler e entregar dados do e-CAC. Ele exige e-CNPJ, e o Fixer já guarda o e-CNPJ A1 da oficina.

## 2. Arquitetura

```
 Fixer api (tenant)                         plataforma                         SERPRO
 ┌──────────────────────┐   termo assinado  ┌─────────────────────┐  OAuth2 + mTLS ┌──────────────────┐
 │ FiscalAutofillJob    │──────────────────▶│ integra-contador    │───────────────▶│ Integra Contador │
 │  assina o termo com  │   + pedido        │  (cert. da          │                │  /Consultar      │
 │  o e-CNPJ do tenant  │◀──────────────────│   plataforma)       │◀───────────────│                  │
 └──────────────────────┘   dados extraídos └─────────────────────┘                └──────────────────┘
```

| # | Decisão | Motivo |
|---|---|---|
| D1 | **Um contrato** com o SERPRO, da plataforma (contratante = CNPJ do Fixer), num serviço `integra-contador` igual ao `cnpj-lookup` | O contrato é pago por faixa de consumo total: um contrato da rede inteira fica na faixa mais barata, e as credenciais OAuth2 não vão para cada tenant |
| D2 | **A chave privada do tenant não sai do tenant.** A API do tenant assina o termo de autorização e manda só o XML assinado | Mesma regra do cofre de certificados (`secret-box`). No modo gateway, quem assina é o `dfe-gateway`, que já guarda o certificado |
| D3 | O serviço devolve **dados extraídos** (RBT12, lista de códigos de receita), não o PDF | O PDF da declaração tem dado sigiloso que o Fixer não usa. A extração fica em um lugar só e é testada com amostras |
| D4 | O serviço **não guarda** nada do contribuinte, só métricas e contagem de consultas por tenant (para custo) | Igual ao `cnpj-lookup`: quem grava é o tenant, com proveniência |
| D5 | Só serviços de **consulta**. Os de entrega e emissão (`TRANSDECLARACAO11`, `GERARDAS*`) ficam bloqueados no serviço, não só ignorados | Evita uso acidental: entregar declaração é ato do contador |

## 3. Autorização (a confirmar)

Toda chamada leva três identificações: `contratante` (Fixer), `autorPedidoDados` (quem pede) e `contribuinte` (a oficina). O acesso exige que o contratante tenha permissão do contribuinte, por um destes caminhos:

1. **Autorização no e-CAC.** A oficina (ou o contador) entra no e-CAC e autoriza o CNPJ do Fixer nos serviços do Integra Contador. Desde dez/2025 a procuração eletrônica foi trocada pela "autorização de acesso" do e-CAC, que o beneficiário precisa confirmar em até 30 dias (**a confirmar** na fonte oficial). Dá trabalho manual, que é o que esta spec quer evitar.
2. **Termo de autorização assinado (serviço "Autenticar Procurador").** O autor do pedido assina com o próprio e-CNPJ um XML de termo de autorização para o contratante, e o serviço devolve um token de uso. **Hipótese principal:** como o Fixer tem o e-CNPJ da oficina, a própria oficina é o autor do pedido e assina o termo. Assim, nenhum passo manual no e-CAC.

A fase de prova (§8) decide entre 1 e 2. Se só o caminho 1 funcionar, a tela de consentimento ([fiscal-autofill.md](fiscal-autofill.md) §7) ganha um passo a passo com link para o e-CAC, e o job fica `AGUARDANDO_CONSENTIMENTO` até a primeira consulta passar.

O token do termo tem validade (**a confirmar**). O serviço guarda o token por tenant em memória ou Redis, com TTL, e pede um termo novo à API do tenant quando expira.

## 4. RBT12 pelo PGDAS-D

### 4.1 Serviços

| idServico | O que faz | Entrada |
|---|---|---|
| `CONSULTIMADECREC14` | Última declaração e recibo de um período de apuração | `periodoApuracao` (AAAAMM) |
| `CONSDECLARACAO13` | Declarações de um ano-calendário | `anoCalendario` |
| `CONSDECREC15` | Declaração e recibo pelo número | `numeroDeclaracao` |

A resposta de `CONSULTIMADECREC14` é JSON com `numeroDeclaracao` e a declaração e o recibo **em PDF base64**. Não há campo estruturado de receita.

### 4.2 Extração

O PDF da declaração do PGDAS-D traz a receita do período (RPA), a RBT12 do período e as receitas brutas dos 12 meses anteriores (**a confirmar com amostra real**). Para o período corrente `m`:

```
RBT12(m) = Σ receita bruta dos PA m-12 … m-1
         = receitas anteriores da declaração de m-1 (m-13 … m-2) − receita de m-13 + RPA(m-1)
```

Uma consulta por mês (a declaração de `m-1`) basta, e a conta usa só números do próprio PDF. Se a declaração de `m-1` ainda não existe (antes do dia 20, ou entregue em atraso), usa `m-2` e grava `rbt12AsOf` do período de referência correto.

- Extração com `pdfjs` (texto) e expressões presas ao rótulo de cada campo, **nunca à posição**. Todo rótulo esperado ausente = `SEM_DADO`, nunca um número parcial.
- **Testes com PDFs reais anonimizados**, um por layout encontrado (a Receita muda o PDF entre versões do PGDAS-D). Teste de regressão falha se aparecer layout novo.
- Mercado interno e externo: a RBT12 do Anexo I é a soma dos dois, mas os limites (R$ 4,8 milhões) se aplicam separadamente (LC 123, art. 3º, § 14). Guardar os dois valores no `evidence`.
- Retificadora: vale a última declaração do período, que é o que `CONSULTIMADECREC14` devolve.

### 4.3 Resultado

`rbt12`, `rbt12AsOf` = primeiro dia do PA de referência, proveniência `INTEGRA_PGDASD` / `OFICIAL`, `reference` = número da declaração.

## 5. Regime pelos pagamentos (DARF)

Quem não está no Simples paga IRPJ, CSLL, PIS e Cofins em DARF, com **código de receita** diferente para cada regime. O Integra Contador tem serviços de consulta de pagamentos (**a confirmar**: nome do sistema e `idServico`, provável "PAGTOWEB").

| Tributo | Lucro Presumido | Lucro Real |
|---|---|---|
| IRPJ | 2089 | 0220 (trimestral), 2362 (estimativa mensal), 2430 (ajuste) |
| CSLL | 2372 | 6012 (trimestral), 2484 (estimativa mensal) |
| PIS | 8109 (cumulativo) | 6912 (não cumulativo) |
| Cofins | 2172 (cumulativo) | 5856 (não cumulativo) |

**Todos os códigos a conferir** na tabela oficial de códigos de receita da RFB antes de virar tabela em `packages/tax-rules` (`codigos-receita-darf`, com fonte e verificação, como as outras).

Regra de inferência (regra do Fixer, marcada como tal):

1. Consultar os pagamentos dos últimos 12 meses.
2. **PIS e Cofins decidem primeiro**: são mensais e aparecem mesmo com prejuízo (no Real com prejuízo pode não haver IRPJ).
3. Todos os códigos achados apontam para o mesmo regime → `taxRegime` com confiança `INFERIDO`.
4. Códigos dos dois regimes no mesmo ano-calendário (troca de regime só em janeiro), ou nenhum pagamento → não grava; vai para a pergunta guiada ([fiscal-autofill.md](fiscal-autofill.md) §6.2), com o achado na tela ("Encontramos DARF de Lucro Presumido em 2026").
5. Pagamento de DAS no período → é do Simples; confere com o CNPJá e avisa se divergir.

## 6. Custo

O Integra Contador cobra por consulta, com preço por faixa de consumo mensal total do contrato (tabela na loja SERPRO, **a levantar**). Consumo previsto por tenant:

| Uso | Consultas |
|---|---|
| Envio do certificado | 1 (PGDAS-D) ou 1 a 2 (pagamentos) + 1 (termo, se cobrado) |
| Mensal (Simples) | 1 |
| Anual (regime, não Simples) | 1 a 2 |

O serviço conta consultas por tenant e por `idServico` (métrica e tabela para cobrança), e tem **teto mensal por tenant** configurável, para que erro em loop não vire custo.

## 7. Contrato do serviço

```
POST /v1/autorizacao        { cnpj, termoAssinadoXml }               → { expiresAt }
GET  /v1/simples/rbt12/:cnpj?pa=AAAAMM                               → { pa, rbt12, rbt12Interno, rbt12Externo, rpa, numeroDeclaracao } | 404 SEM_DECLARACAO
GET  /v1/pagamentos/regime/:cnpj?de=AAAA-MM&ate=AAAA-MM              → { codigos: [{ codigo, periodo, tributo }], regimeInferido: PRESUMIDO | REAL | SIMPLES | null, motivo }
```

Erros: `401 AUTORIZACAO_EXPIRADA` (a API do tenant assina um termo novo e repete uma vez), `403 SEM_AUTORIZACAO` (a autorização do contribuinte não existe: vira `AGUARDANDO_CONSENTIMENTO`), `429 TETO_MENSAL`, `502 SERPRO_INDISPONIVEL` (o job tenta de novo com backoff, sem passar do teto).

Autenticação tenant → serviço: a mesma do `cnpj-lookup`.

## 8. Fase de prova (antes de implementar)

No ambiente trial do Integra Contador e depois com um CNPJ real de cliente que autorizou:

1. Confirmar o caminho de autorização (§3): o termo assinado pelo próprio contribuinte basta?
2. Baixar declarações reais do PGDAS-D e confirmar os rótulos e a conta da §4.2. Guardar as amostras anonimizadas como fixtures.
3. Confirmar o serviço de pagamentos, o formato da resposta e os códigos da §5.
4. Levantar preço por faixa e validade do token.

Saída: esta spec atualizada, com os "a confirmar" resolvidos ou a decisão de não seguir (aí a RBT12 fica no fallback de [fiscal-autofill.md](fiscal-autofill.md) §5.3, e o regime, na pergunta guiada).

## 9. Fontes

- [Integra Contador: documentação (SERPRO)](https://apicenter.estaleiro.serpro.gov.br/documentacao/api-integra-contador/): papéis, procuração, serviço Autenticar Procurador, lista de serviços do PGDAS-D.
- [Cenários do PGDAS-D no trial (SERPRO)](https://apicenter.estaleiro.serpro.gov.br/documentacao/api-integra-contador/pt/cenarios_trial/cenarios_pgdasd/): `idServico` e entradas.
- [Consultar última declaração/recibo (SERPRO)](https://apicenter.estaleiro.serpro.gov.br/documentacao/api-integra-contador/pt/solucoes/integra-sn/pgdasd/servicos/consultar_ultima_declaracao_recibo/): resposta com PDF base64.
- [Receita Federal: lançamento do Integra Contador](https://www.gov.br/receitafederal/pt-br/assuntos/noticias/2022/setembro/receita-federal-e-serpro-disponibilizam-nova-plataforma-de-prestacao-de-servicos-contabeis-e-fiscais): exige e-CNPJ e autorização prévia.
- [SERPRO: software house com termo de autorização](https://serpro.gov.br/menu/noticias/noticias-2022/como-prestar-servicos-contabilidade).
- [e-Auditoria: autorização de acesso no e-CAC](https://www.e-auditoria.com.br/blog/autorizacao-de-acesso-e-cac-como-escale-o-acesso-da-carteira/): troca da procuração (fonte não oficial; confirmar).
