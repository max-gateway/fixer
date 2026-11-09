# Integração com o serviço `marketplace` da plataforma

Configurações → Marketplaces conecta a conta de vendedor do Mercado Livre da oficina. O Fixer é só cliente: contas, OAuth, cofre e conexões vivem no serviço `marketplace` (repositório platform-marketplace, `docs/specs/marketplace-connections.md`).

## Como fala com o serviço
- `apps/api/src/marketplace`: único ponto de saída. Autentica como o client `fixer-marketplace` (client credentials, token em cache) e escolhe a organização por `X-Org-Id`; a concessão dessa organização vem do control plane (projeção do serviço), que fecha por padrão.
- A API do Fixer nunca recebe nem devolve token ou segredo: só estado da conta, perfil e conexão.
- O Fixer não tem lojas: a conexão usa o id da organização como `storeId`.
- Direito do plano: `marketplace.provider.mercadolivre` (control plane). O serviço o confere e o Fixer também (`@RequireFeature`, chave ausente = liberada, `false` = 402).
- Permissões: `marketplace.read` (ver) e `marketplace.manage` (conectar, vincular, pausar, desconectar), dadas ao papel Admin pelo catálogo de permissões.

## Autoatendimento da oficina
A oficina cadastra o próprio ambiente pela tela, sem ajuda da equipe. O assistente (`connect-dialog.tsx`) explica, em linguagem simples, como criar o app no painel do Mercado Livre (com o endereço de retorno para copiar) e pede o ID e a chave secreta. O backend monta o resto a partir disso (`MarketplaceService.connect`), em ordem:
1. cadastra o app da oficina no cofre do serviço (ou troca o segredo, se já houver um ativo); o segredo nunca volta;
2. registra a `MARKETPLACE_RETURN_URL` em `oauth.allowedReturnUrls` da oficina (preserva o resto da configuração, usa `If-Match`; idempotente);
3. inicia a autorização e devolve a `authorizeUrl`.
Na volta, a tela vincula a conta à oficina (`POST /marketplace/accounts/:id/link`) e limpa a URL.

Fora do alcance da oficina (decisão comercial no control plane): o direito `marketplace.provider.mercadolivre` e a flag `marketplace.byo_app` da assinatura. Sem eles o serviço recusa com mensagem clara, mostrada na janela.

## Configuração (apps/api/.env.example)
`MARKETPLACE_URL`, `MARKETPLACE_TOKEN_URL`, `MARKETPLACE_CLIENT_SECRET` e `MARKETPLACE_RETURN_URL` ligam a integração (sem elas a tela diz "não disponível"). `MARKETPLACE_REDIRECT_URI` é só o texto mostrado no assistente.

## Operação (uma vez por ambiente)
- Segredo do client `fixer-marketplace` no ambiente da API do Fixer (`KC_SECRET_FIXER_MARKETPLACE` do Keycloak da plataforma).
- Direito do provider e `byo_app` concedidos às assinaturas do Fixer (`grant-marketplace.sh`).
