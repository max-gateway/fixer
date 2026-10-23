# Integra Contador (SERPRO): RBT12 e regime tributário

Status: **fase de prova concluída em produção (2026-10-21); serviço implementado** em `platform/services/integra-contador` (RBT12 e perfil do Simples; regime por DARF pendente, §5) · Escopo: serviço de plataforma ao lado de `cnpj-lookup`, cliente em `apps/api/src/fiscal-autofill` · Relacionadas: [fiscal-autofill.md](fiscal-autofill.md), [tax-rules.md](tax-rules.md), [dfe-gateway.md](dfe-gateway.md)

> O que está marcado **a confirmar** veio da documentação pública do SERPRO lida em 2026-10-19. Os itens de §3 e §4 foram confirmados na prova de 2026-10-21 (§8.1); §5 (pagamentos/DARF) segue sem teste.

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

**Resolvido (§8.1): o caminho 2 funciona**, sem e-CAC. Se algum dia só o caminho 1 funcionar, a tela de consentimento ([fiscal-autofill.md](fiscal-autofill.md) §7) ganha um passo a passo com link para o e-CAC, e o job fica `AGUARDANDO_CONSENTIMENTO` até a primeira consulta passar.

O token do termo vale até a meia-noite do dia seguinte (confirmado); reenviar um termo ainda válido devolve 304. O serviço guarda o token por tenant em memória ou Redis, com TTL, e pede um termo novo à API do tenant quando expira.

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

## 8.1 Resultado da prova (2026-10-21, produção)

Contratante MAX ESHOP LTDA; duas empresas reais do Simples (uma com 1 atividade, outra com 4 atividades).

| Item | Resultado |
|---|---|
| Caminho de autorização (§3) | **Termo assinado pelo próprio contribuinte basta.** Sem termo: `403 [AcessoNegado-ICGERENCIADOR-022]` ("não tem procuração autorizada no Portal eCAC"). Com o termo (`AUTENTICAPROCURADOR/ENVIOXMLASSINADO81`, em `/Apoiar`) vem um `autenticar_procurador_token` e a consulta passa. O termo precisa do e-CNPJ do **estabelecimento** consultado |
| Autenticação | `/authenticate` exige mTLS com o e-CNPJ do contratante (sem ele: 400 "Não foi possível identificar um certificado digital válido"). Devolve `access_token` e `jwt_token`; o `Consultar` leva os dois |
| Resposta de `CONSULTIMADECREC14` | JSON com `numeroDeclaracao`, `declaracao.pdf` e `recibo.pdf` em base64. Período sem declaração: status 200, `dados` vazio e `[Aviso-PGDASD-MSG_ISN_005]` |
| Conta da §4.2 | Confirmada nas duas empresas: a RBT12 do PA seguinte = receitas anteriores da declaração de `m-1` dentro da janela + RPA |
| **Início de atividade** | O PDF traz a **RBT12p** (proporcional). Com menos de 12 meses de atividade, é ela que vale para a alíquota: média dos meses anteriores × 12 (Res. CGSN 140, art. 22). A regra implementada confere com a impressa nas duas declarações. Quase toda oficina nova cai aqui |
| Texto do PDF | `pdftotext -layout` embaralha colunas (o valor da RBT12 cai na linha da RPA). A leitura é por coordenada das palavras (`pdfplumber`) |
| Mais dados na declaração | Atividades com Anexo, ST de ICMS, tributação monofásica, ISS retido, sublimite, impedimento de ICMS/ISS no DAS, Fator R, município/UF, tributos por atividade. Tudo vai para o motor tributário como evidência da RBT12 |
| Serviço de pagamentos (§5), preço por faixa | **Não testados** |

Implementação: o `dfe-gateway` assina o termo (`POST /v1/companies/{cnpj}/signatures/integra-contador-term`; a chave privada não sai dele, D2); o serviço troca o termo por token e extrai a declaração; o Fixer renova o termo sozinho ao receber `401 AUTORIZACAO_EXPIRADA`. Variáveis do Fixer: `INTEGRA_CONTADOR_URL` e `INTEGRA_CONTADOR_API_KEY`. O contratante e o certificado dele ficam só no serviço.

### 8.2 Conferência com o cálculo da Receita

O Fixer compara, a cada leitura, a alíquota que **a tabela do `tax-rules`** daria para cada atividade do Anexo I com a que a **Receita declarou** (`simples-conferencia.ts`): efetiva da faixa − parcela do ICMS (se ST) − parcelas de PIS e Cofins (se monofásica), com a RBT12 que a Receita usou no período (a proporcional, em início de atividade). Resultado na evidência da RBT12: `CONFERE` | `DIVERGE` | `SEM_COMPARAVEL`; `DIVERGE` vira aviso no passo do preenchimento.

Nas duas empresas da prova a tabela reproduz a Receita (diferença máxima de 0,0001 ponto, arredondamento da Receita): 2,6400% com ST de ICMS; 6,0681% comum; 5,1275% monofásica.

**ST × monofásico:** a descrição da atividade ("Com substituição tributária/tributação monofásica/antecipação…") é o nome da opção e cobre os três casos. O que vale é a observação da atividade ("Substituição tributária de: ICMS." / "Tributação monofásica de: COFINS, PIS."). A primeira versão do parser lia a descrição e marcava ST numa atividade só monofásica; a própria conferência apontou o erro (3,0946% esperado × 5,1275% declarado).

**Anexo III (serviços), incluído:** `simplesServicoRate` (`packages/tax-rules`, faixas 1 a 4, RBT12 até R$ 1,8 milhão, até 2026) reproduz as duas atividades de serviço da oficina da prova, tributo a tributo e também com ISS retido na fonte (esperado = efetiva − ISS). A tolerância da conferência cresce quando a receita é pequena: a alíquota declarada vem de tributos arredondados a centavos (erro de até 0,035 R$ sobre a receita). **Estado da tabela:** transcrita com o Planalto fora do ar (2026-10-21), sustentada por duas fontes secundárias, pela soma de 100 em cada faixa e pela declaração real; **não** está em `TABLES` nem carimbada por `verify:sources`. Falta conferir contra o texto oficial e registrar. A 5ª e a 6ª faixas (ISS limitado a 5%, com redistribuição) e o Anexo III de 2027 em diante (Anexo XVIII da LC 214) ficam sem tabela: a função devolve `null`.

**Sublimite, tratado nas peças:** `saleTax` passa a devolver `SUBLIMITE_ESTADUAL` quando a RBT12 passa de R$ 3,6 milhões (o ICMS sai do DAS e seria omitido do preço), salvo alíquota efetiva informada pelo contador. Limite geral da LC 123: estados com sublimite menor (a declaração traz o valor real em `fatos.sublimite`) ainda não são distinguidos.

**Ainda não feito:** o preço de mão de obra não usa o Anexo III. Hoje o Fixer só sugere preço de **peça** (entrada de nota); serviço fica em `Service.defaultPrice`/hora, sem imposto. Ligar o Anexo III exige decidir como o preço do serviço é sugerido (ISS por fora, retenção do tomador, Fator R).
