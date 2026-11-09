# Integração com o serviço `marketplace` da plataforma

Configurações → Marketplaces conecta a conta de vendedor do Mercado Livre da oficina. O Fixer é só cliente: contas, OAuth, cofre e conexões vivem no serviço `marketplace` (repositório platform-marketplace, `docs/specs/marketplace-connections.md`).

## Como fala com o serviço
- `apps/api/src/marketplace`: único ponto de saída. Autentica como o client `fixer-marketplace` (client credentials, token em cache) e escolhe a organização por `X-Org-Id`; a concessão dessa organização vem do control plane (projeção do serviço), que fecha por padrão.
- A API do Fixer nunca recebe nem devolve token ou segredo: só estado da conta, perfil e conexão.
- O Fixer não tem lojas: a conexão usa o id da organização como `storeId`.
- Direito do plano: `marketplace.provider.mercadolivre` (control plane). O serviço o confere e o Fixer também (`@RequireFeature`, chave ausente = liberada, `false` = 402).
- Permissões: `marketplace.read` (ver) e `marketplace.manage` (conectar, vincular, pausar, desconectar), dadas ao papel Admin pelo catálogo de permissões.

## Fluxo
1. `POST /marketplace/accounts {label}` → o serviço devolve `authorizeUrl`; o navegador vai ao Mercado Livre.
2. O serviço recebe o callback e redireciona para `MARKETPLACE_RETURN_URL?status=&accountId=&reason=`.
3. A tela vincula a conta autorizada (`POST /marketplace/accounts/:id/link`) e limpa a URL.

## Configuração (apps/api/.env.example)
`MARKETPLACE_URL`, `MARKETPLACE_TOKEN_URL`, `MARKETPLACE_CLIENT_SECRET`, `MARKETPLACE_RETURN_URL` (as quatro ligam a integração; sem elas a tela diz "não disponível").

## Para ativar em produção (ações fora deste repositório)
- Segredo do client `fixer-marketplace` no ambiente da API do Fixer.
- No serviço, `oauth.allowedReturnUrls` da organização com a `MARKETPLACE_RETURN_URL` exata.
- Aplicativo OAuth (`app_credential`) ativo do Mercado Livre para a organização, e o direito do provider concedido à assinatura.
