# Fixer online (ambiente de teste)

Sobe api, web, Postgres e Redis numa VPS com Docker Compose, sob um domínio provisório, usando o Keycloak, o catálogo e o dfe-gateway
já publicados pela plataforma (`id.`, `catalog.` e `dfe.maxgateway.com.br`). Não é o desenho de produção (esse é `infra/helm` + Terraform).

## Desenho (VM `mg-platform`)

```
navegador ─:443─▶ Envoy (SNI fixer.) ─TCP puro─▶ platform_nginx:8443 ─▶ fixer-web:3001 ─▶ fixer-api:3000 ─▶ postgres / redis (do projeto)
                                                                              │                  ├─▶ mg_control_plane:3400 e mg_rabbitmq:5672 (platform_net)
                                                                              │                  └─▶ catalog. / dfe.maxgateway.com.br
                                                                              └─ login OIDC ─▶ id.maxgateway.com.br
```

- **Só o web é público**, em `https://fixer.maxgateway.com.br`. O web faz proxy server-side para a API (`apps/web/src/app/api/[...path]/route.ts`),
  então a API não precisa de host nem de CORS. O Envoy só passa o host novo em TCP puro por SNI; quem termina o TLS é o `platform_nginx`.
- `NEXT_PUBLIC_API_URL` é lido em **runtime** pelo servidor Next; no compose vale `http://fixer-api:3000`, nunca o host público.
- `fixer-web` e `fixer-api` entram na `platform_net` (externa, dona: platform-broker). Postgres e Redis ficam só na rede do projeto.

## Configuração: o que muda do dev para o online

| Variável | Dev | Online |
|---|---|---|
| `AUTH_URL` (web) | `http://localhost:3001` | `https://$FIXER_HOST` |
| `NEXT_PUBLIC_API_URL` (web) | `http://localhost:3000` | `http://fixer-api:3000` |
| `KEYCLOAK_REALM` | `fixer-dev` | `maxgateway` (realm da plataforma) |
| `KEYCLOAK_AUTH_SERVER_URL` | `http://localhost:8180` | `https://id.maxgateway.com.br` |
| `KEYCLOAK_WEB_CLIENT_ID` | `fixer-web` (realm de dev) | `fixer-web` (client de produção da plataforma) |
| `DATABASE_URL` / `SYSTEM_DATABASE_URL` | `fixer_app` / `fixer_system` com senha `password` | `fixer_rls` / `fixer_system` com senhas geradas |
| `DEV_HOST`, `DEFAULT_ORG_ID` | opcionais | **não usar** |
| `KEYCLOAK_ORGANIZATIONS` | opcional | `true` |

## Passo a passo

Os arquivos abaixo do repo `platform-parts-search` (branch `feat/workforce`) já foram editados, **sem commit e sem aplicar na VM**:
`platform-broker/setup.sh` (usuário `fixer-svc`), `platform-edge/nginx/platform.conf` (bloco do `fixer.`) e `platform-edge/renew-edge-cert.sh` (certificado do `fixer.`).
Falta só preencher segredos e rodar, **nesta ordem**, na `mg-platform`:

1. **DNS:** registro A de `fixer.maxgateway.com.br` para o IP público da VM (o mesmo de `id.`). Sem ele o desafio ACME não passa.
2. **Keycloak:** em `infra/prod/platform-identity/.env` acrescente `FIXER_PUBLIC_URL=https://fixer.maxgateway.com.br` (o `KC_SECRET_FIXER_WEB` já é gerado pelo `bootstrap.sh`)
   e rode `keycloak/apply-tenants.sh`. Esse segredo (`grep KC_SECRET_FIXER_WEB .env`) é o `KEYCLOAK_WEB_CLIENT_SECRET` do `infra/prod/.env` do Fixer.
   Confira no console (túnel para `127.0.0.1:8081`) que `fixer-web` tem os mappers `audience-fixer-api` (sem ele a API recusa o `aud`) e `audience-parts-search` (sem ele o catálogo dá 403).
3. **Broker:** em `infra/prod/platform-broker/.env` acrescente `RABBIT_FIXER_PASSWORD=<senha nova>` e rode `bash setup.sh`. A mesma senha vai em `RABBITMQ_URL` do Fixer.
   O consumidor declara o exchange `mg.control-plane` (topic, durável) e as filas `fixer.control-plane` e `.dlq`; por isso o `configure` inclui o exchange.
   Não testei estas permissões: se o log da API mostrar `ACCESS_REFUSED`, é aqui que se ajusta.
4. **Certificado ANTES do nginx:** `CERTBOT_EMAIL=<email> ./renew-edge-cert.sh issue` em `platform-edge/` (emite o do `fixer.`; os outros três já existem e são mantidos).
   O `server` da `:8080` é `default_server`, então o desafio ACME passa mesmo antes de a configuração nova entrar. **Só depois** publique o `platform.conf` e recarregue o
   nginx: com o bloco `:8443` do `fixer.` e sem o certificado, o `nginx` recusa a configuração e o `id.` e o `dfe.` ficam sem recarga.
5. **Control plane:** `docker exec mg_control_plane node dist/cli.js create-key product fixer-teste fixer` (rótulo e produto; sem o 2º argumento a chave NÃO fica presa ao produto) → `CONTROL_PLANE_API_KEY` do Fixer.
6. O `envoy.yaml` não muda: SNI diferente de `catalog.` já cai no TCP puro para o `platform_nginx:8443`. O Fixer precisa estar de pé antes do primeiro acesso (o nginx resolve `fixer-web` em tempo de execução, então não quebra se ainda não estiver).

### Subir (na `mg-platform`, na raiz do repositório do Fixer)
```sh
cp infra/prod/.env.example infra/prod/.env     # preencha (o arquivo é ignorado pelo git)
export NODE_AUTH_TOKEN=<token do GitHub Packages com read:packages>   # build de @max-gateway/*
docker compose --env-file infra/prod/.env -f infra/prod/docker-compose.yml up -d --build
docker compose --env-file infra/prod/.env -f infra/prod/docker-compose.yml ps
```
Ordem automática: postgres → `migrate` (dono do banco) → `db-roles` (papéis de RLS) → fixer-api → fixer-web.

### Conferir
- `curl -I https://fixer.maxgateway.com.br/` responde (redireciona ao login).
- Login leva a `id.maxgateway.com.br` e volta para `https://fixer.maxgateway.com.br`.
- `docker compose ... logs fixer-api`: sem erro de `aud`, JWKS, `ACCESS_REFUSED` ou "Token sem organização".
- A API chama `id.` e `catalog.` pelos nomes públicos, da própria VM (hairpin pelo IP público). Se o log mostrar timeout nessas chamadas, é isso.

## Control plane
A organização do usuário vem das participações registradas por eventos do control plane, não do token. Com `CONTROL_PLANE_URL`, `CONTROL_PLANE_API_KEY` e `RABBITMQ_URL`
preenchidos (passo 1), a API consome os eventos. O usuário de teste precisa ser membro de uma organização com concessão do produto `fixer`, e só
é visto depois que o resync republica o estado (≤ 60 s). Sem as três variáveis o login funciona, mas a API responde 403 "Token sem organização".

## Fora do escopo deste teste
- `notifications` (e-mails/webhooks): sem ele o proxy `/api/notifications` responde 502 e o resto funciona.
- `workforce`, `cost-engine`, `plate-lookup`, `cnpj-lookup`: sem as URLs, cada recurso fica desligado ou usa o padrão do código (localhost), e o restante segue.
- Backups: o volume `pgdata` não tem rotina de backup aqui. Não use dados reais.
