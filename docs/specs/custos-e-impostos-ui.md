# Spec — UI de custos, despesas e impostos

Status: **rascunho para revisão** · Escopo: `apps/web` do Fixer (cliente dos motores) e o console interno de curadoria (`platform`) · Depende de: [tax-engine.md](../../../platform/docs/specs/tax-engine.md), [cost-engine.md](../../../platform/docs/specs/cost-engine.md) · Evolui: [pricing.md](pricing.md) §7 e [tax-rules.md](tax-rules.md) §4.12

## 1. Problema

Os dois motores respondem perguntas difíceis: quanto custa de verdade, quanto vai de imposto, quanto a estrutura come e qual é o preço mínimo. Isso só vale se o dono da oficina **entender e confiar** na resposta. Os riscos de UI são três:

1. **Opacidade:** um número sem motivo. O dono não confia e volta ao "custo × 2".
2. **Jargão:** CST, MVA, CSOSN e rateio na tela de quem não é contador. Ele desiste.
3. **Cadastro infinito:** pedir 40 campos antes do primeiro preço. Ele nunca termina.

A UI ideal mostra **um número, o motivo em português de balcão e o próximo passo**, e chega a um preço confiável em poucos minutos, mesmo antes de todo o cadastro estar completo.

## 2. Quem usa

| Pessoa | Quer | Vê | Permissões |
|---|---|---|---|
| **Dono / gestor** | Saber se está ganhando dinheiro e definir preço | Tudo | `costs.manage`, `pricing.write`, `payables.manage` |
| **Comprador / estoque** | Lançar a nota e precificar rápido | Custo, imposto, preço sugerido | `invoices.read`, `pricing.write`, `costs.read` |
| **Balcão / atendente** | Vender e dar desconto sem prejuízo | Preço e **limite de desconto**, **sem custo nem margem** | `pricing.read` |
| **Contador** (externo, convidado) | Validar o que a oficina usa e dar o aceite | Perfil fiscal, tabelas, enquadramentos, memória de cálculo | `fiscal.verify`, `costs.read` |
| **Curador da plataforma** (interno) | Manter as tabelas fiscais certas e frescas | Console de curadoria (§10) | Operador da plataforma |

As permissões novas são `costs.read` (ver a composição de custo) e `costs.manage` (cadastrar despesas e publicar o perfil). O papel "Contador" passa a ser um papel pronto em `/configuracoes/acessos`.

## 3. Princípios

1. **Número primeiro, motivo a um toque.** Toda cifra calculada abre a mesma gaveta "Por que esse valor?" (§7), com a cascata e a origem de cada parte.
2. **Português de balcão na frente, termo técnico atrás.** "Imposto já pago pelo fornecedor" na tela; "ICMS-ST retido, CST 60" no detalhe e na memória de cálculo do contador.
3. **Confiança sempre visível, com o mesmo vocabulário em todo o app** (§3.1).
4. **Todo "não sei" tem saída.** `FORA_DA_COBERTURA`, `ATRIBUTO_FALTANDO` e `SEM_BASE_DE_RATEIO` aparecem como pergunta respondível ali mesmo, nunca como erro.
5. **Prever o impacto antes de salvar.** Mudar uma despesa, o regime ou o mix mostra "isso muda o preço de 312 peças em +2,1% em média" antes do botão.
6. **Pronto antes de completo.** O assistente (§5) chega a um primeiro preço `ESTIMADO` em menos de 10 minutos; o resto do cadastro melhora a confiança depois.
7. **Recalcular sem esperar.** Margem e preço mudam a cada tecla com a `formula` do motor ([cost-engine.md](../../../platform/docs/specs/cost-engine.md) §6.6); só a troca de item, canal ou perfil vai ao servidor.
8. **R$ e % juntos**, e margem e markup juntos, como já faz o `MarkupSlider`.

### 3.1 Vocabulário de confiança (componente `ConfidenceChip`)

| Estado | Chip | Cor (token) | Ícone | Texto do tooltip |
|---|---|---|---|---|
| `CONFIRMADO` | Confirmado | `--ok` | check | "Validado pelo seu contador nesta versão" |
| `ESTIMADO` | Estimado | `--warn` | círculo tracejado | "Calculado, mas falta: …" (lista o que falta, com link) |
| `DEFINIDO` | Definido por você | `--info` | lápis | "Valor informado por {quem} em {quando}" |
| `FORA_DA_COBERTURA` / `SEM_REGRA` | Sem dado | `--muted` | traço | "Ainda não temos essa regra: informe o percentual" |
| `INVIAVEL` | Inviável | `--danger` | alerta | "Custos e impostos passam de 100% do preço" |

A cor nunca é o único sinal: ícone e texto sempre acompanham (WCAG AA). Os tokens têm versão clara e escura.

## 4. Arquitetura de informação

Nova seção **Custos** na navegação principal (`nav-items.ts`: `id: 'custos'`, `goKey: 'k'`, `mobile: false`, palavras-chave "despesas, margem, impostos, rateio, preço, lucro"). As ações "Nova despesa" e "Revisar preços" entram em `NAV_ACTIONS` e, portanto, na paleta de comandos.

```
Custos  /custos
├── Visão geral         /custos                 painel de saúde (§6.1)
├── Despesas            /custos/despesas        cadastro e sugestões (§6.2)
├── Vendas              /custos/vendas          canais, formas de pagamento e taxas (§6.3)
├── Estrutura           /custos/estrutura       centros de custo, rateio, custo da hora (§6.4)
├── Impostos            /custos/impostos        perfil fiscal, prontidão, tabelas e cobertura (§6.5)
├── Preços              /custos/precos          saúde dos preços e reprecificação em lote (§6.6)
├── Simular             /custos/simular         e se? (§6.7)
└── (peça) Histórico    aba e gaveta da peça    fotografia de cada entrada (§6.8)

Configurações
├── Precificação        /configuracoes/precificacao   só "Regra de preço" (margem-alvo, arredondamento, travas)
└── Acessos             papel "Contador"

Revisão do contador     /revisao                tela própria do contador (§8)
```

As abas "Imposto" e "Tabelas" de `/configuracoes/precificacao` **mudam** para `/custos/impostos`, com redirecionamento de `?aba=imposto` e `?aba=tabelas`. Em Configurações fica só a política de preço.

## 5. Assistente de custos (primeiro uso)

Aparece na primeira visita a `/custos`, ou no "Precificar" da nota quando não há perfil. São cinco passos, cada um já preenchido com o que o sistema sabe, e o usuário só **confirma ou corrige**:

| Passo | Pergunta | Pré-preenchido com | Pulável? |
|---|---|---|---|
| 1. Sua empresa | Regime e faturamento dos últimos 12 meses | Regime do `cnpj-lookup`; faturamento somado das OS e vendas do Fixer | Não (sem regime não há imposto) |
| 2. Situação em PE | "Sua empresa está em dia com a SEFAZ-PE?" (sim / não / não sei) | — | Sim, e então o motor usa o pior caso, com aviso |
| 3. Despesas do mês | Lista do modelo "oficina" (aluguel, folha, pró-labore, contador, energia, sistemas, água, internet...) com campos de valor; e "importar do contas a pagar" | Médias dos `Payable` pagos dos últimos 3 meses, por categoria | Sim: cada linha vazia fica de fora e o perfil sai `ESTIMADO` |
| 4. Como você recebe | Mix de pagamento e taxas da maquininha | Mix das OS pagas; taxas em branco, com valores típicos como dica cinza, não como valor | Sim |
| 5. Peças × serviço | "Quanto da sua estrutura é da oficina e quanto é do balcão?" (um controle deslizante) e quantos mecânicos | 50/50; mecânicos dos usuários com papel técnico | Sim |

No fim, o resultado em uma frase e um gráfico (§6.1): "**De cada R$ 100 que você vende em peças, R$ 15 pagam a estrutura.** Sua margem atual de 35% na verdade é de 20%." Em seguida vêm dois botões: "Ver peças abaixo do mínimo" e "Continuar depois".

O assistente salva a cada passo e pode ser retomado. Cada resposta vira o mesmo cadastro das telas normais, sem dado paralelo.

## 6. Telas

### 6.1 Visão geral (`/custos`)

```
┌ Custos ─────────────────────────────────────────────── Perfil v14 · out/2026 · [Estimado ⓘ] ┐
│                                                                                               │
│  De cada R$ 100 vendidos em PEÇAS                                                             │
│  ██████████████████████████████████░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░    │
│  Custo da peça 64,9 │ Impostos 6,0 │ Vendas 4,1 │ Estrutura 15,0 │ Lucro 10,0                   │
│                                                                                               │
│  Este mês          Faturamento R$ 148.200   ▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓░░░░  equilíbrio R$ 171.000        │
│                    faltam R$ 22.800 para cobrir a estrutura (12 dias úteis)                    │
│                                                                                               │
│  Para resolver                                                                                │
│  ⚠ 23 peças vendem abaixo do mínimo depois da última mudança        [Revisar preços]           │
│  ⚠ "Energia" veio 31% acima do previsto em set e out               [Atualizar despesa]        │
│  ● 2 tabelas fiscais novas para o contador validar                  [Enviar ao contador]       │
│  ● Sugestão: "Software de gestão" aparece todo mês no contas a pagar [Adicionar]               │
│                                                                                               │
│  O que mais pesa no seu preço        Folha 6,2 pp · Aluguel 3,8 pp · Maquininha 2,1 pp · …    │
└───────────────────────────────────────────────────────────────────────────────────────────────┘
```

- A barra "De cada R$ 100" é um **gráfico de barra empilhada horizontal**, um por centro de custo (Peças, Serviço). Cada segmento abre a gaveta de §7 filtrada. É o gráfico mais importante do produto: explica o markup sem a palavra markup.
- **Equilíbrio do mês:** faturamento acumulado contra o de equilíbrio (`reports/break-even`), com projeção linear.
- **Para resolver:** fila única de ações, ordenada por impacto em R$. Junta os avisos do perfil, as sugestões, os `profile.published` e os `pack.published`.
- **O que mais pesa:** `reports/sensitivity`, as 5 maiores despesas em pontos percentuais do preço.

### 6.2 Despesas (`/custos/despesas`)

Lista agrupada por categoria, com total mensal equivalente por grupo e total geral fixo × variável no topo. Cada linha mostra nome, valor ou percentual, a recorrência em texto ("todo mês", "por ano ÷ 12", "em 24× até mar/2028"), o centro de custo, o chip de tipo e a variação contra o realizado ("+31% no realizado").

**Adicionar ou editar** em `Sheet` lateral (tela cheia no celular), em **linguagem de pergunta**, que define o `kind` por trás:

```
Nova despesa
  Nome            [ Aluguel                    ]
  Categoria       [ Ocupação ▾ ]
  Como ela muda?  (•) Valor fixo por mês         → FIXED
                  ( ) % de cada venda            → SALE_PCT
                  ( ) Valor por peça vendida     → PER_UNIT
                  ( ) Valor por pedido           → PER_ORDER
                  ( ) Valor sobre cada compra    → PURCHASE
  Valor           [ R$ 6.500,00 ]  por [ mês ▾ ]   (mês | ano | parcelado em N meses)
  Desde           [ 01/2026 ]  até [ sem fim ]
  De quem é       Balcão ▓▓▓▓▓▓▓░░░ 70%  ·  Oficina 30%     (um controle para 2 centros; lista para mais)
  Tem nota fiscal? [ ] sim → pede tipo de documento e regime do fornecedor (crédito: cost-engine §6.4)
  ─────────────────────────────────────────
  Impacto: Estrutura das peças 15,0% → 15,4%  ·  preço médio +0,5%      [Salvar]
```

- **Valor típico como dica:** a taxa da maquininha mostra "comum: 2% a 5%" em cinza. Nunca vira valor sozinho.
- **Sugestões** ficam numa faixa no topo ("3 despesas encontradas no contas a pagar"), com Aceitar (abre o formulário preenchido) e Dispensar.
- **Folha:** o tipo "Pessoal" abre campos de salário e quantidade de pessoas, e mostra as provisões que nascem junto (13º, férias, encargos), cada uma editável e com o chip "estimado, confirme com o contador".
- **Imposto cadastrado como despesa** (DAS, ICMS): o formulário bloqueia e explica que "o imposto da venda já é calculado pelo sistema; cadastrar aqui contaria duas vezes". Taxas que não são da venda (IPTU, alvará) passam.

### 6.3 Vendas (`/custos/vendas`)

- **Canais** (Balcão, OS) em cartões: centro de custo, contexto fiscal padrão do comprador ("consumidor final em PE", em português) e as despesas variáveis que se aplicam.
- **Formas de pagamento:** tabela de taxas por forma e parcela (PIX, débito, crédito 1×, 2–6×, 7–12×, antecipação), editável, e o **mix** dos últimos 3 meses calculado das OS ("PIX 30% · crédito 1× 25% · crédito 2–6× 35% · dinheiro 10%"), com a opção de fixar um mix manual.
- **Preço por forma** (decisão do cost-engine §15.5): um quadro "Para uma peça de custo R$ 100" mostra o preço do mix e o preço por forma, lado a lado. É informativo; oferecer desconto à vista é escolha da oficina, ligada em Configurações > Precificação.

### 6.4 Estrutura (`/custos/estrutura`)

Dois cartões, um por centro produtivo, cada um com a **conta à vista**, em números reais:

```
Peças (balcão)                                   Serviço (oficina)
Estrutura do balcão     R$ 21.000/mês            Estrutura da oficina   R$ 18.000/mês
+ parte da administração R$ 9.000                + folha dos mecânicos  R$ 12.000
÷ faturamento médio (12 meses) R$ 200.000        ÷ horas vendidas       396 h  (3 × 176 h × 75% de ocupação)
= 15,0% de cada venda                             = R$ 75,76 por hora de custo
                                                 Preço da hora sugerido R$ 98,51  [Usar no catálogo de serviços]
```

- **Base de rateio** num seletor simples: "Últimos 12 meses (recomendado)", "Últimos 3 meses", "Meta de faturamento", com uma frase sobre quando usar cada uma.
- **Administração** (centro `SUPPORT`): controle de divisão entre os centros, com "por faturamento" como opção automática.
- **Avisos** do perfil (`BASE_CURTA`, `ESTRUTURA_ACIMA_DO_FATURAMENTO`) aparecem aqui, no cartão afetado, com a explicação.
- **Publicar:** as mudanças desta tela geram rascunho. Uma barra fixa no rodapé mostra "Rascunho: preço médio +1,8% · 41 peças mudam de faixa" com os botões [Descartar] e [Publicar perfil].

### 6.5 Impostos (`/custos/impostos`)

Herda a aba "Imposto" atual (checklist de prontidão, formulário só com os campos do regime) e acrescenta:

- **Situação na SEFAZ-PE** (regularidade do art. 393-A), com data de referência e a explicação "muda o percentual da antecipação nas compras de fora do estado". Sem resposta, o motor calcula pelo pior caso e mostra esse aviso.
- **Tabelas que sua empresa usa:** só os pacotes que aparecem nos traces da oficina nos últimos 90 dias, não o catálogo inteiro. Cada um com versão, vigência, fontes com link, "o que não cobre", o **diff da versão nova** em linguagem simples ("a MVA de pastilha de freio passou de X para Y, vale desde 01/11") e o status de aceite do contador.
- **Cobertura:** "Coberto para sua operação: compras de qualquer UF para PE, vendas em PE, ISS em Recife. Não coberto: venda para outros estados." Isso evita a surpresa do `FORA_DA_COBERTURA`.
- **Enviar ao contador:** gera um convite ou lembrete com o link de `/revisao` (§8).

### 6.6 Preços (`/custos/precos`)

Tabela de **saúde dos preços** das peças, em quatro faixas com contagem no topo e filtro por faixa:

| Faixa | Regra |
|---|---|
| Prejuízo | preço < mínimo (contribuição negativa) |
| Não cobre a estrutura | mínimo ≤ preço < equilíbrio |
| Abaixo da meta | equilíbrio ≤ preço < preço da margem-alvo |
| Saudável | ≥ margem-alvo |

- Colunas: peça, custo, preço atual, preço sugerido, margem atual → nova, confiança e última venda (peça parada não é urgente).
- **Reprecificar em lote:** seleciona, pré-visualiza (arredondamento, `PRICE_DOWN` nunca automático, `BIG_JUMP` destacado) e confirma com as mesmas travas da nota (pricing.md §5.4). Usa `determination-jobs` para catálogos grandes, com barra de progresso.
- Chega aqui pelos avisos "23 peças abaixo do mínimo" e pelo evento `profile.published`.

### 6.7 Simular (`/custos/simular`)

Cartões de cenário empilháveis ("aluguel +10%", "contratar 1 mecânico", "mix 50% PIX", "sair do Simples"), cada um editável, e o resultado lado a lado: atual × cenário em estrutura %, custo da hora, preço médio, equilíbrio do mês e lucro projetado. "Sair do Simples" usa o `profileOverride` do tax-engine e mostra o chip "simulação, não é parecer". Nada aqui publica; o botão final é "Aplicar estas mudanças", que leva às telas certas já preenchidas.

### 6.8 Histórico da peça (snapshot de cada entrada)

Cada lançamento de nota grava uma **fotografia imutável** do momento ([stock-entry-snapshot.md](stock-entry-snapshot.md)): custo e componentes, estoque e custo médio antes e depois, preço, regra, imposto, perfil fiscal, aceites do contador e versões das tabelas. Ela aparece em três lugares.

**a) Aba "Histórico" na peça** (a partir da busca de peças, da nota ou da OS; dados de `GET /parts/:id/entries`):

```
Pastilha de freio dianteira · PAST-001                               [Custo] [Preço] [Ambos]
  R$
  48 ┤                                              ●───────── preço 43,90
  40 ┤ ●──────────────●─────────────────────────────┘
  24 ┤                                    ┌──────── custo 23,20
  10 ┤ ●──────────────●───────────────────┘          ◆ médio 18,80
     └─ mai ──────── jul ──────── set ──────── out ─────────────────────────────
  ──────────────────────────────────────────────────────────────────────────────
  18/10  NF 123 · Fornecedor X (SP)   +10 un   custo 10,00 → 23,20   preço 40,00 → 43,90   [Estimado]   ›
  02/07  NF  98 · Fornecedor Y (PE)   +5 un    custo 9,80 → 10,00    preço mantido           [Confirmado] ›
```

- **Gráfico de degraus** (custo e preço mudam por evento, não continuamente), com o custo médio como linha tracejada. Cada degrau é um lançamento clicável. "Ver como tabela" está sempre disponível.
- **Lista de entradas**: data, documento, fornecedor e UF, quantidade, custo antes e depois, preço antes e depois ou "mantido", "não pedido" ou "travado" (`price.outcome`), e o `ConfidenceChip` do imposto **daquele momento**.
- Cada linha abre a **gaveta do lançamento** (abaixo).

**b) Gaveta do lançamento** (a "Por que esse valor?" de §7, no modo histórico):

- O mesmo layout da §7, mas **com os dados congelados**: componentes do custo, imposto, regra e margem como estavam. O cabeçalho diz "Como foi calculado em 18/10/2026 às 14:02 por Ana".
- **"O que mudou desde então"**: a tela compara o snapshot com o estado atual e lista, em português, só o que difere: "regra de preço: margem 35% → 40%", "tabela simples-comercio: versão nova", "peça: ST confirmada pelo contador", "perfil: RBT12 atualizada". Responde a pergunta mais comum: por que o preço sugerido hoje é diferente do de antes.
- **Selo de integridade**: `intact: true` mostra "Registro original, sem alterações" com um cadeado discreto. `false` (nunca deveria acontecer) mostra um alerta vermelho e avisa o suporte.
- **Memória de cálculo** (PDF) do lançamento, com o hash impresso no rodapé: é o documento que o contador anexa numa fiscalização.

**c) Na nota já lançada** (`/notas/[id]`, status Lançada): cada item mostra o resultado congelado ("custo 23,20 · preço 40,00 → 43,90") com o link para a gaveta do lançamento, no lugar dos controles de preço.

**Na OS:** o lucro de cada peça usa o `unitCost` congelado na saída do estoque. A linha mostra "custo na saída R$ 12,50" para quem tem `costs.read`. OS anteriores à valorização mostram "custo não registrado" e ficam fora dos totais de lucro.

Permissão: a aba Histórico e as gavetas exigem `pricing.read` (mostram custo). O balcão (`pricing.read` sem `costs.read`, §2) vê só a linha do preço no gráfico.

## 7. Gaveta "Por que esse valor?" (componente único)

Usada em todo número calculado: preço do item na nota, preço na OS, custo, imposto, estrutura e custo da hora. Evolui a gaveta atual de `price-details.tsx`.

```
Por que R$ 154,08?                                              [Estimado ⓘ falta: aceite do contador]
──────────────────────────────────────────────────────────────────────────────────────────
Custo da peça                         R$ 100,00
  Produto na nota                       R$ 86,20   NF 12345 · Fornecedor X (SP)
  ST paga na entrada (PE)               R$ 11,30   comprado de SP: o fornecedor não reteve  [ver regra]
  Frete rateado                         R$  2,50
Impostos na venda              6,0%   R$   9,24   Simples, faixa 3 · ICMS já pago por ST     [ver regra]
Taxas de venda                 4,1%   R$   6,32   maquininha (mix) 2,1% · comissão 2,0%      [ver despesas]
Estrutura                     15,0%   R$  23,11   R$ 30.000/mês ÷ R$ 200.000                 [ver estrutura]
Lucro                         10,0%   R$  15,41
──────────────────────────────────────────────────────────────────────────────────────────
Mínimo R$ 111,23 · Equilíbrio R$ 133,51 · Para 10%: R$ 154,08         [Memória de cálculo ↓]
```

- **Três níveis:** a linha em português; "ver regra", que abre o trace do motor com o nome da regra, a lei e o link para a fonte; e **memória de cálculo**, um PDF ou impressão com todos os campos técnicos (CST, MVA, base, alíquota, versões), feito para o contador.
- Quem tem só `pricing.read` (balcão) não abre esta gaveta. Vê só o preço e o limite de desconto (§9.2).
- Os números deste exemplo são os da [cost-engine.md](../../../platform/docs/specs/cost-engine.md) §6.5, ilustrativos.

## 8. Revisão do contador (`/revisao`)

Uma tela feita para alguém que **não usa o Fixer no dia a dia** e entra por um link do e-mail:

- **Fila do que precisa de aceite:** perfil fiscal (o que mudou desde o último aceite), tabelas novas ou alteradas (com diff), peças com enquadramento estimado agrupadas por NCM ("38 peças NCM 8708.30: ST de autopeças? [Confirmar todas] [Ver]") e provisões de folha estimadas.
- **Aceite em lote** com nome e registro (CRC) gravados no `PackReview` e no aceite do perfil.
- **Discordar** em vez de só aceitar: abre um override (tax-engine §7.2) com motivo obrigatório. O valor passa a `DEFINIDO`, com o nome do contador.
- **Memória de cálculo** de qualquer item e **relatório mensal** em PDF: carga média por regime, itens estimados e o que mudou nas tabelas.
- **E-mail mensal** com o resumo ("3 coisas aguardam você"), sem login para ler, com login para aceitar.

## 9. Fluxos do dia a dia

### 9.1 Nota de compra (`/notas/[id]`)

O passo "Precificar" já existe (pricing.md §7). Muda:

- **Custo com o imposto de entrada:** quando a peça veio de fora de PE sem ST retida, a linha mostra "ST paga na entrada R$ 11,30" e, no topo da nota, um aviso único: "Esta nota tem **R$ 214,80 de ICMS a pagar na entrada** (ST e antecipação). [Criar conta a pagar]". O botão cria um `Payable` com a categoria "Tributos de entrada", o valor **estimado** e o vencimento em branco, a preencher com o extrato da SEFAZ-PE. Nunca cria a conta sozinho.
- **Slider de preço** (`MarkupSlider`) ganha **zonas**: vermelha abaixo do mínimo, âmbar até o equilíbrio e verde depois, além dos marcadores "regra" e "atual" que já existem.
- **Etiqueta de confiança** por item, com o `ConfidenceChip` (§3.1).

### 9.2 Ordem de serviço (`/ordens/[id]`)

- **Preço da hora** sugerido pelo custo da hora (§6.4), com o chip de confiança.
- **Desconto seguro:** no balcão, o campo de desconto mostra "até R$ 18,40 sem prejuízo" (até o equilíbrio) e trava no mínimo. Acima do equilíbrio, desconto livre; entre o equilíbrio e o mínimo, pede a ciência de quem tem `pricing.write`. O atendente nunca vê custo nem margem, só o limite.
- **ISS do serviço** aparece no resumo da OS como "imposto do serviço (Recife 5%)", sem ser uma linha a mais para o cliente.

### 9.3 Contas a pagar (`/contas-a-pagar`)

- **Categoria** passa de texto livre a seletor do plano gerencial (cost-engine `ExpenseCategory`), com a sugestão automática pelo fornecedor.
- Ao pagar, a parcela vai para o `cost-engine` como realizado (cost-engine §8). Um selo discreto "conta para o custo" mostra que entrou.
- Despesa recorrente sem cadastro vira a sugestão de §6.2, e nunca bloqueia o pagamento.

## 10. Console de curadoria (interno, `platform`)

UI de operador do `tax-engine`, só para o time da plataforma, no mesmo padrão da UI de operador do `dfe-gateway` (dfe-gateway §11):

| Tela | Conteúdo |
|---|---|
| **Fila** | Achados dos monitores (tax-engine §12.5.2): fonte, trecho alterado com diff, pacotes e regras possivelmente afetados, resumo marcado "triagem automática". Ações: abrir tarefa, descartar com motivo |
| **Pacote** | Regras, vigências, fontes, casos-ouro e resultado do `check:rules`. **Edição gera PR** no repositório; o console não grava regra direto (tax-engine D4) |
| **Frescor** | Grade pacote × prazo (`checkedAt`, `maxAgeDays`), com os `STALE` no topo |
| **Corpus** | Divergência por pacote e UF contra as notas reais, com os exemplos clicáveis (XML anonimizado) |
| **Cobertura** | Mapa UF × tributo (Pernambuco cheio, o resto vazio por ora), com a contagem de `FORA_DA_COBERTURA` por célula: mostra onde a demanda está chegando |
| **Revisor** | PRs aguardando o contador revisor da plataforma (tax-engine §15.6), com o prazo de 3 dias úteis |

## 11. Estados especiais

| Situação | O que a tela faz |
|---|---|
| Motor tributário fora (`FISCAL_INDISPONIVEL`) com cache | Calcula normalmente; rodapé discreto "impostos da versão de 14:02" |
| Motor tributário fora, sem cache | Preço sem a parte do imposto, bloqueado para salvar, com o aviso "Imposto indisponível agora. Tente em instantes ou informe o percentual" e um campo para `DEFINIDO` |
| `FORA_DA_COBERTURA` | Pergunta inline: "Qual o percentual de {tributo} nesta venda? Seu contador sabe." O valor vira override com motivo pré-preenchido |
| `INVIAVEL` | Cartão vermelho no lugar do preço, com as 3 maiores parcelas e links: "Estrutura 52% · revise despesas ou faturamento" |
| Perfil sem base (`BASE_CURTA`) | Chip "Estimado" e frase: "com menos de 3 meses de histórico, usamos sua meta de faturamento" |
| Celular sem rede | Mostra a última fórmula e o último preço calculados, com o selo "offline"; não salva preço |

## 12. Padrões de interface

- **Componentes:** os que já existem em `components/ui` (Sheet, Tabs, Table, Slider, Tooltip, Alert, Accordion, Command), mais `ConfidenceChip`, `WhyDrawer` (§7), `ImpactBar` (rodapé de rascunho com impacto), `CostStackBar` (barra "de cada R$ 100") e `ZonedSlider` (evolução do `MarkupSlider` com zonas).
- **Números:** `tabular-nums`, formato pt-BR, R$ com 2 casas, percentual com até 2 casas e "pp" para pontos percentuais. Valores negativos com sinal e cor, nunca só cor.
- **Celular:** despesas, assistente, OS e nota funcionam em 360 px. A Estrutura e a tabela de Preços têm uma versão em lista no celular; a tabela completa fica no desktop.
- **Atalhos:** `g k` abre Custos; na lista de preços, `j`/`k` navegam e `a` aceita a sugestão. Seguem `use-nav-shortcuts.ts`.
- **Acessibilidade:** AA de contraste, foco visível, todo gráfico com tabela equivalente acessível ("ver como tabela") e o slider operável por teclado com passo de 0,5 pp.
- **Gráficos:** barras horizontais empilhadas e barras de progresso; nada de pizza, gauge ou 3D. A paleta segue os tokens de confiança e o guia de visualização do design system.

## 13. Medidas de sucesso

| Métrica | Meta (90 dias após a fase 2) |
|---|---|
| Tempo do primeiro acesso ao primeiro preço com perfil | < 10 min (mediana) |
| Oficinas com perfil publicado | > 70% das ativas |
| Peças vendidas com imposto `CONFIRMADO` | > 50% |
| Peças com preço abaixo do equilíbrio | queda de 50% contra a linha de base |
| Tempo de aceite do contador (convite → aceite) | < 7 dias (mediana) |
| Uso da gaveta "Por que esse valor?" | medida de confiança; queda brusca = ninguém mais duvida, ou ninguém mais olha. Acompanhar com entrevista |

## 14. Fases (alinhadas aos motores)

| Fase | UI | Depende de |
|---|---|---|
| **A** | `ConfidenceChip`, `WhyDrawer` e zonas no slider, ainda sobre o cálculo atual do Fixer; aviso de imposto de entrada na nota com o pacote PE no `tax-rules`; **Histórico da peça** (§6.8), já com a API pronta | tax-engine §12.5 (pacote PE no Fixer); `GET /parts/:id/entries` (feito) |
| **B** | Seção Custos: assistente, Despesas, Vendas, Estrutura e Visão geral | cost-engine fases 0 e 1 |
| **C** | Impostos em `/custos/impostos`, Revisão do contador, memória de cálculo | tax-engine fase 2 |
| **D** | Preços (lote), desconto seguro na OS, Simular | cost-engine fases 2 e 4 |
| **E** | Console de curadoria | tax-engine fase 3 |

## 15. Decisões

1. **Acesso do contador: convite na organização**, com o papel "Contador" (usuário próprio, login normal). O aceite grava identidade e registro, então precisa de autenticação forte; link sem conta não serve como prova. O e-mail mensal pode ser lido sem login, mas aceitar exige entrar.
2. **Lucro projetado do mês:** **resolvido.** A OS agora congela o custo médio da peça no momento da saída do estoque (`ServiceOrderPartLine.unitCost`, [stock-entry-snapshot.md](stock-entry-snapshot.md) D6), e a devolução volta pelo mesmo custo. A Visão geral mostra o lucro projetado assim que houver 30 dias de OS com custo registrado; as OS anteriores ficam fora, sem estimativa retroativa.
