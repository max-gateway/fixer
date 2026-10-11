# dfe-gateway — deploy na VM Oracle (junto do rocket)

Runbook de instalação e operação. Desenho e decisões: [docs/specs/dfe-gateway.md](../../../docs/specs/dfe-gateway.md).

## O que sobe

| Container | Função | Rede | Porta publicada |
|---|---|---|---|
| `dfe_postgres` | Banco **só do gateway** (certificados cifrados, NSU, documentos) | `dfe_net` | nenhuma |
| `dfe_api` | HTTP `/v1`, `/healthz` | `dfe_net` + `rocket_prod_network` | nenhuma (o nginx do rocket publica) |
| `dfe_worker` | Sincroniza com a SEFAZ, ciência, avisos | `dfe_net` + `rocket_prod_network` | nenhuma |

Memória: 512 MB + 384 MB + 384 MB (cabe na folga de 4–5 GB do orçamento da VM, ver `docker-compose.prod.yml` do rocket).
A imagem é multi-arquitetura (JS puro): roda igual na VM Ampere ARM.

## Instalação (primeira vez)

Pré-requisito: o compose da raiz do rocket está de pé (cria `rocket_prod_network`, RabbitMQ e nginx).

```bash
# 1. Código
git clone <repo-fixer> ~/fixer && cd ~/fixer/apps/dfe-gateway/deploy

# 2. Segredos (gerados NA VM; nunca copie de outra máquina)
mkdir -p secrets && openssl rand -hex 16 | tr -d '\n' > secrets/db_password && chmod 600 secrets/db_password
cp .env.example .env && chmod 600 .env
#   DFE_DATABASE_URL: use a senha de secrets/db_password
#   DFE_ENC_KEYS: {"k1":"<openssl rand -base64 32>"}  -> GUARDE UMA CÓPIA FORA DA VM (cofre de senhas)
#   RABBITMQ_URL: usuário/senha do RabbitMQ do rocket

# 3. Subir
docker compose -f docker-compose.prod.yml --env-file .env up -d --build
docker compose -f docker-compose.prod.yml ps        # tudo "healthy"

# 4. Publicar no nginx do rocket
#    DNS dfe.maxgateway.com.br -> IP da VM; emitir certificado; incluir nginx-dfe-gateway.conf em nginx/rocket.conf
curl -s https://dfe.maxgateway.com.br/healthz       # {"status":"ok"}
curl -si https://dfe.maxgateway.com.br/metrics | head -1   # HTTP/2 404 (não publicado)
```

> **Perder `DFE_ENC_KEYS` = perder todos os certificados** (os `.pfx` ficam cifrados no banco e não abrem). Cópia fora da VM é obrigatória.

## Cadastrar um cliente (tenant) e dar a chave

Não há API administrativa exposta: administre por SSH.

```bash
CLI="docker exec dfe_api node dist/cli.js"
$CLI tenant:create rocket ROCKET
$CLI key:create rocket "producao"        # imprime a chave UMA vez: dfe_<id>.<segredo>
$CLI tenant:create fixer-oficina-x FIXER
$CLI key:create fixer-oficina-x
$CLI status                              # CNPJs, certificado, NSU, cStat, próximo poll
$CLI key:revoke <idDaChave>              # rotação/vazamento
$CLI tenant:suspend <slug>               # corta o acesso na hora
$CLI grant <cnpj> <slug>                 # dá a outro tenant leitura dos documentos do CNPJ
```

Entregue a chave ao sistema cliente por canal seguro (ela entra no segredo do produto: `DFE_GATEWAY_API_KEY`).

## Operação

**Logs e saúde**

```bash
docker logs -f dfe_worker                 # cStat por CNPJ, ciência, falhas de entrega
docker exec dfe_api wget -qO- http://127.0.0.1:3010/metrics | grep ^dfe_   # métricas (só por dentro)
```

**Alertas mínimos** (métricas `dfe_*`): `dfe_blocked_companies > 0` (656), `dfe_delivery_pending{state="DEAD"} > 0`,
`dfe_credential_expiring{days="7"} > 0`, `dfe_sync_lag_seconds > 7200`.

**656 (consumo indevido)**: o runner espera 1 h 5 min sozinho. Se voltar a repetir, outro sistema consulta o mesmo CNPJ:
descubra quem e desligue-o (ver spec §8.4). Depois de 3 seguidos o sync desliga e exige `resume-from` humano.

**Backup do banco** (diário, e antes de qualquer atualização):

```bash
docker exec dfe_postgres pg_dump -U dfe -Fc dfe > /backup/dfe-$(date +%F).dump
```

Restauração: `docker exec -i dfe_postgres pg_restore -U dfe -d dfe --clean < dfe-AAAA-MM-DD.dump`. O dump contém os
certificados **cifrados**: sem a chave mestra ele não vale nada, então guarde dump e chave em lugares diferentes.

**Atualizar**: `git pull && docker compose ... up -d --build` (migrações rodam sozinhas, serializadas por advisory lock).

**Rotação da chave mestra**: adicione `"k2"` em `DFE_ENC_KEYS`, troque `DFE_ACTIVE_KEY_ID=k2`, reinicie. Certificados novos
usam `k2`; os antigos continuam abrindo com `k1` (mantenha as duas). O re-embrulho em massa é a fase 5 da spec.

## Firewall

Nenhuma porta nova: só 80/443 (nginx) e 22 (restrito ao seu IP), como no checklist do rocket
(`docs/superpowers/specs/oracle-vps-checklist.md`). O Postgres do gateway não tem `ports:`.
