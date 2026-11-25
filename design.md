# Fixer — Design System & UI Direction

> Direção visual e de experiência para o Fixer. Este documento orienta mudanças de interface sem alterar regras de negócio, contratos de API ou arquitetura de domínio.

## 1. Produto e objetivo

O Fixer é uma plataforma de gestão para oficinas mecânicas. A interface deve transmitir controle operacional, agilidade, confiança e profissionalismo. Deve funcionar bem em balcões, escritórios e ambientes de oficina, com legibilidade e ações rápidas.

**Conceito visual: Workshop Control.** Um SaaS operacional contemporâneo: estrutura grafite, superfícies claras, tipografia objetiva e cor de marca aplicada com intenção.

Evitar aparência de template administrativo genérico, excesso de gradientes, sombras fortes, cards aninhados, bordas desnecessárias, ícones sem rótulos em ações pouco óbvias e gráficos decorativos.

## 2. Diagnóstico da base atual

A implementação atual já oferece uma boa fundação:
- Next.js App Router, React e Tailwind CSS v4.
- Componentes locais com Radix UI, Lucide e Motion.
- Fonte Bai Jamjuree.
- Branding por tenant com cores e logo injetados em runtime.
- Cabeçalho horizontal, navegação desktop, tab bar mobile, busca global e atalhos.
- Dashboard com KPIs, gráficos, funil, ocupação, carga da equipe, pendências e atividade recente.

A direção é evoluir progressivamente, não reescrever o frontend. Preservar componentes e fluxos úteis, reorganizando hierarquia, navegação e padrões visuais.

## 3. Direção visual e tokens

A estrutura visual deve ser comum a todos os tenants. A cor da oficina personaliza a marca, mas não altera o significado dos estados.

| Token | Valor inicial | Uso |
|---|---|---|
| app-bg | #F5F6F8 | Fundo geral |
| surface | #FFFFFF | Cards, menus e painéis |
| surface-muted | #F0F2F5 | Campos e áreas secundárias |
| ink | #182230 | Texto principal |
| ink-muted | #667085 | Texto auxiliar |
| line | #E4E7EC | Bordas e divisórias |
| nav-bg | #17212B | Navegação |
| nav-text | #D7DEE7 | Texto da navegação |
| success | #16845B | Concluído, pago, saudável |
| warning | #B7791F | Atenção e prazo próximo |
| danger | #C43D3D | Atraso crítico, erro e bloqueio |
| info | #2876B8 | Informação neutra |
| brand-primary | runtime por tenant | CTA, seleção e detalhes de marca |
| brand-soft | derivado da marca | Destaque sutil |

Os valores são ponto de partida, não obrigação. Validar contraste em marcas claras, escuras e saturadas. Usar WCAG AA como referência para contraste de texto.

### Regras de cor
- A cor do tenant nunca define status operacional.
- Status deve ter texto e, quando útil, ícone; nunca depender apenas da cor.
- Estados success, warning, danger e info são semânticos e compartilhados.
- Não usar a cor da marca em grandes áreas se isso prejudicar leitura.
- Não codificar laranja como cor obrigatória de ação.

## 4. Tipografia e geometria

Manter Bai Jamjuree inicialmente; evitar adicionar outra família sem justificativa.

| Elemento | Tamanho sugerido |
|---|---:|
| Título de página | 24–28 px / 600 |
| Título de seção | 16–18 px / 600 |
| Título de card | 14–16 px / 600 |
| Corpo | 14 px / 400 |
| Auxiliar | 12–13 px |
| Métrica principal | 26–32 px / 600–700 |

Usar números tabulares em valores, datas, placas, quantidades e números de OS. Evitar textos longos em caixa alta.

Espaçamento em múltiplos de 4 px: 4 para microespaços; 8 para elementos relacionados; 12–16 para conteúdo interno; 20–24 entre blocos; 28–32 entre seções.

Raios sugeridos: 8 px em controles, 12 px em cards, 16 px em modais e drawers. Usar pílulas apenas para badges e elementos realmente arredondados. Preferir borda sutil a sombra quando ambos cumprem a mesma função.

## 5. Layout e navegação

### Desktop
Evoluir para uma aplicação com sidebar persistente:
1. Sidebar grafite com marca e navegação.
2. Área principal clara e fluida.
3. Cabeçalho contextual com título, descrição e ações.
4. Conteúdo com largura confortável para leitura.

Navegação prioritária:
- Painel
- Ordens de serviço
- Clientes
- Notas / Fiscal
- Notificações
- Conta e configurações, conforme rotas existentes

Destacar Nova OS como ação principal, sem competir com o conteúdo. Busca global, notificações e conta devem permanecer acessíveis. Sidebar recolhível em larguras intermediárias. Estado ativo inequívoco.

### Mobile
Preservar a tab bar inferior para até cinco destinos prioritários. Ações secundárias ficam em menus ou no contexto da tela.
- Não comprimir tabelas desktop até ficarem ilegíveis.
- Converter linhas em cards/listas quando necessário.
- Formulários em uma coluna.
- Alvos de toque com pelo menos 44 px.
- Respeitar safe areas e teclado virtual.
- Manter ações essenciais acessíveis sem rolagem excessiva.

## 6. Componentes compartilhados

Criar ou consolidar padrões reutilizáveis:
- PageHeader: título, descrição, breadcrumbs opcionais e ações.
- SectionHeader: título, descrição e ação contextual.
- StatCard: métrica, variação e contexto.
- StatusBadge: estado semântico com texto e ícone opcional.
- DataTable: ordenação, seleção, paginação e comportamento responsivo.
- FilterBar: busca, filtros e limpeza.
- EmptyState: explicação e próxima ação.
- LoadingState: skeleton que reflita o conteúdo.
- ErrorState: mensagem útil e recuperação.
- ConfirmDialog: confirmação de ações destrutivas.
- FormField: label, controle, ajuda e erro.
- EntitySummary: resumo de cliente, veículo ou OS.
- ActivityTimeline: histórico cronológico.
- MoneyDisplay: formatação monetária consistente.

Não criar abstrações genéricas excessivamente complexas. Compartilhar padrões reais e manter composição simples.

## 7. Direção por tela

### Painel
Deve responder rapidamente:
1. O que acontece na oficina agora?
2. O que exige atenção?
3. Como está o desempenho financeiro e operacional?
4. Qual é a próxima ação?

Estrutura:
- Cabeçalho contextual, período e CTA Nova OS.
- Resumo operacional: OS em andamento, aguardando aprovação, prontas para entrega e atrasadas.
- Indicadores: faturamento, quantidade de OS, ticket médio e taxa de aprovação.
- Operação: ordens por status, ocupação, carga da equipe e serviços relevantes.
- Pendências prioritárias e atividade recente.

Manter cálculos e dados vindos da API. Não inventar métricas nem apresentar dados de demonstração como reais. Identificar claramente dados demonstrativos. No mobile, priorizar pendências e ações antes de gráficos.

### Ordens de serviço
A listagem é uma das telas mais importantes.
- Busca por número, placa, cliente ou veículo, conforme suporte real.
- Filtros visíveis por status e período.
- Contagem de resultados e filtros ativos.
- Tabela desktop com OS, veículo/placa, cliente, status, responsável, valor e atualização, conforme dados disponíveis.
- Badge semântico para status; ações secundárias agrupadas.
- No mobile, cards com OS, veículo, cliente, status e próxima ação.

Definir estados: carregando, vazio sem filtros, vazio com filtros, erro, resultado parcial e paginação quando aplicável.

### Nova OS
Transformar o cadastro em fluxo guiado e rápido:
1. Identificar veículo por placa, busca ou cadastro.
2. Confirmar ou selecionar cliente.
3. Registrar reclamação, sintomas e observações.
4. Adicionar serviços e itens se fizerem parte do fluxo atual.
5. Revisar e criar.

Exibir contexto do veículo e cliente após identificação. Não pedir novamente dados já disponíveis. Preservar todos os campos, validações e regras existentes. Indicar obrigatoriedade, apresentar erros junto aos campos e evitar perda de dados ao voltar etapas. Confirmar criação apenas após resposta positiva da API.

### Clientes
Busca em primeiro plano e ação Novo cliente. Lista limpa com nome, documento mascarado quando necessário, contato e atividade de OS se disponível. Perfil organizado em dados cadastrais, veículos, ordens e histórico.

### Veículos
Placa e identificação em destaque; marca, modelo, versão e ano agrupados; proprietário claramente identificado; histórico de OS em timeline. Identificar dados provenientes de consulta externa e tratar carregamento/falha claramente.

### Notas e fiscal
Apresentar situação, número/série/tipo, cliente ou fornecedor, valor e datas relevantes. Ações críticas exigem confirmação e explicam o efeito. Nunca indicar autorização fiscal sem confirmação da API.

### Portal do cliente
Manter identidade da oficina com experiência ainda mais simples: veículo/OS, etapa atual, orçamento e aprovações quando disponíveis, atualizações relevantes e próxima ação. Não expor notas internas ou dados de outros clientes.

## 8. Estados e feedback

Toda tela operacional deve definir:
- Loading: skeleton coerente com a estrutura.
- Empty: explicar ausência de dados e indicar como começar.
- Error: linguagem simples e ação de recuperação.
- Success: confirmação contextual.
- Disabled: explicar indisponibilidade quando necessário.
- Pending: indicar operação em andamento e evitar duplicidade.

Ações destrutivas ou irreversíveis exigem confirmação. Operações assíncronas não devem bloquear a aplicação inteira.

## 9. Acessibilidade e movimento

- Navegação integral por teclado e foco visível.
- Labels associados aos campos e ordem de tabulação lógica.
- Contraste WCAG AA.
- Não usar apenas cor para comunicar status.
- Dialogs com foco controlado e retorno ao acionador.
- Respeitar prefers-reduced-motion.
- Testar larguras 360, 390, 768, 1024 e 1440 px.
- Textos longos, placas e nomes não podem quebrar o layout.

Motion deve ajudar a compreensão: transições curtas, feedback de menus/dialogs e atualizações sutis. Preferir 120–200 ms para interações pequenas. Evitar animação contínua e efeitos de entrada excessivos.

## 10. Regras técnicas

Respeitar a stack existente: Next.js App Router, React, Tailwind CSS v4, Radix UI, Lucide, Motion e tokens CSS. Não introduzir outra biblioteca sem justificativa.

- Componentes visuais não chamam diretamente serviços de domínio.
- Não duplicar lógica de negócio em componentes.
- Não criar mocks ou valores fictícios em runtime.
- Não alterar contratos de API, DTOs, permissões ou status em tarefas exclusivamente visuais.
- Reutilizar hooks, tipos e funções existentes.
- Manter componentes Server/Client conforme necessidade real.
- Não transformar páginas inteiras em Client Components sem necessidade.
- Preservar branding runtime e logo por tenant.
- Cor da marca não altera semântica de estados.

## 11. Estratégia de implementação

Executar em etapas pequenas, revisáveis e sem big bang.

### Fase 1 — Fundação visual
Consolidar tokens; ajustar PageHeader, StatusBadge, EmptyState, LoadingState e FormField; validar white-label e responsividade.

### Fase 2 — Estrutura global
Evoluir navegação desktop para sidebar; preservar tab bar mobile; reorganizar busca, notificações, conta e CTA; validar atalhos e paleta de comandos existentes.

### Fase 3 — Operação
Redesenhar listagem e criação de OS, clientes e detalhes de veículo; melhorar loading, erro e estados vazios.

### Fase 4 — Painel
Reorganizar hierarquia, priorizar operação e pendências, refinar gráficos existentes e validar mobile.

### Fase 5 — Acabamento
Revisar portal do cliente, fiscal e notificações; testar acessibilidade, estados extremos e diferentes marcas; remover inconsistências e estilos duplicados.

## 12. Critérios de aceite

- [ ] Funciona em desktop, tablet e mobile.
- [ ] Mantém funcionalidades, permissões e fluxos existentes.
- [ ] Não introduz dados fictícios em runtime.
- [ ] Mantém white-label e contraste.
- [ ] Possui loading, empty, error e success adequados.
- [ ] Possui foco visível e labels acessíveis.
- [ ] Não depende apenas de cor para comunicar informação.
- [ ] Reutiliza tokens e componentes compartilhados.
- [ ] Não duplica lógica de negócio.
- [ ] Passa lint e typecheck aplicáveis.
- [ ] Foi verificada em ao menos uma largura mobile e uma desktop.

## 13. Instrução para agentes de desenvolvimento

Antes de alterar uma tela:
1. Inspecione a implementação atual, componentes, tipos, chamadas de API e rotas relacionadas.
2. Identifique o fluxo operacional e os dados reais necessários.
3. Consulte este documento e reutilize os padrões existentes.
4. Faça alterações visuais sem reimplementar regras de negócio.
5. Preserve white-label, acessibilidade, responsividade e estados.
6. Se a melhoria exigir mudança de contrato ou domínio, apresente essa necessidade separadamente.
7. Ao concluir, informe arquivos alterados, decisões visuais, comportamentos preservados e verificações executadas.

**Princípio central:** o Fixer deve parecer um único produto coeso. Cada tela pode ter necessidades próprias, mas não pode inventar sua própria linguagem visual ou suas próprias regras de negócio.
