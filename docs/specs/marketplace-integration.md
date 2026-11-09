# Integração com o serviço `marketplace` da plataforma

Configurações → Marketplaces conecta a conta de vendedor do Mercado Livre da oficina. O Fixer é só cliente: contas, OAuth, cofre e conexões vivem no serviço `marketplace` (repositório platform-marketplace, `docs/specs/marketplace-connections.md`).

## Como fala com o serviço
- `apps/api/src/marketplace`: único ponto de saída. Autentica como o client `fixer-marketplace` (client credentials, token em cache) e escolhe a organização por `X-Org-Id`; a concessão dessa organização vem do control plane (projeção do serviço), que fecha por padrão.
- **Qualquer marketplace**: a lista vem de `GET /v1/providers` do serviço (com o direito da oficina e como ligar cada um); o Fixer não tem lista própria. Acrescentar um provider no serviço o faz aparecer na tela. Só o texto de ajuda para criar o app é por marketplace (`GUIDES` em `apps/web/src/lib/marketplace.ts`), com texto genérico para os que não têm.
- A API do Fixer nunca recebe nem devolve token ou segredo: só estado da conta, perfil e conexão.
- O Fixer não tem lojas: a conexão usa o id da organização como `storeId`.
- Direito do plano: `marketplace.provider.<marketplace>` (control plane), conferido pelo serviço e também pelo Fixer (`PlanLimits.assertFeature`: chave ausente = liberada, `false` = 402).
- Permissões: `marketplace.read` (ver) e `marketplace.manage` (conectar, vincular, pausar, desconectar), dadas ao papel Admin pelo catálogo de permissões.

## Dois jeitos de autorizar (ambos prontos no backend)
| Modo | App no marketplace | A oficina faz |
|---|---|---|
| **Compartilhado** (`source: platform`) | um app da Max Gateway por marketplace, cadastrado só pelo operador | só dá um nome à conta e autoriza |
| **Próprio** (`source: tenant`) | o app da própria oficina (exige a flag `marketplace.byo_app`) | cria o app (assistente na tela), cola ID e chave, autoriza |

O app compartilhado exige cadastro de desenvolvedor e validação de documentos de cada marketplace; enquanto não existir, `ready` é falso e a tela oferece o assistente do app próprio. Quando o operador cadastrar o app compartilhado (runbook `marketplace-app-compartilhado.md` no repositório da plataforma), a mesma tela passa a pedir só o nome, sem mudança de código. Se a oficina já tem app próprio, ele tem preferência.

## Autoatendimento da oficina
O backend monta o ambiente a partir do que a oficina informa (`MarketplaceService.connect`), em ordem:
1. se vieram credenciais, cadastra o app da oficina no cofre do serviço (ou troca o segredo do ativo); o segredo nunca volta;
2. escolhe o app: o da oficina, senão o compartilhado;
3. registra a `MARKETPLACE_RETURN_URL` em `oauth.allowedReturnUrls` da oficina (preserva o resto, usa `If-Match`, idempotente);
4. inicia a autorização e devolve a `authorizeUrl`.
Na volta, a tela vincula a conta (`POST /marketplace/accounts/:id/link`; o marketplace da conta vem do serviço) e limpa a URL.

Fora do alcance da oficina (decisão comercial no control plane): o direito `marketplace.provider.<marketplace>` e a flag `marketplace.byo_app` da assinatura. Sem eles o serviço recusa com mensagem clara, mostrada na janela.

## Configuração (apps/api/.env.example)
`MARKETPLACE_URL`, `MARKETPLACE_TOKEN_URL`, `MARKETPLACE_CLIENT_SECRET` e `MARKETPLACE_RETURN_URL` ligam a integração (sem elas a tela diz "não disponível"). `MARKETPLACE_PUBLIC_URL` só serve para mostrar o endereço de retorno no assistente.

## Operação (uma vez por ambiente)
- Segredo do client `fixer-marketplace` no ambiente da API do Fixer (`KC_SECRET_FIXER_MARKETPLACE` do Keycloak da plataforma).
- Direito do provider e `byo_app` concedidos às assinaturas do Fixer (`grant-marketplace.sh`).
- O Fixer depende de `GET /v1/providers` e do campo `source` de `GET /v1/apps`: o serviço precisa estar na versão com o app compartilhado (migração 020) **antes** de o Fixer novo subir.
