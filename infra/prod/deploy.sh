#!/usr/bin/env bash
# Deploy do Fixer (ambiente de teste) na mg-platform. Rode NA VM, de qualquer pasta, ou de fora:
#   ssh ubuntu@mg-platform 'bash ~/fixer/infra/prod/deploy.sh [branch]'
# Pelo Tailscale SSH o usuário é obrigatório: sem ele vai o usuário local, e a política do tailnet recusa.
# O token de leitura do GitHub Packages (build de @max-gateway/*) vem de NODE_AUTH_TOKEN
# ou do arquivo ~/.fixer-npm-token (chmod 600), nesta ordem.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
BRANCH="${1:-$(git -C "$ROOT" rev-parse --abbrev-ref HEAD)}"
COMPOSE=(docker compose --env-file "$ROOT/infra/prod/.env" -f "$ROOT/infra/prod/docker-compose.yml")

if [ -z "${NODE_AUTH_TOKEN:-}" ] && [ -f "$HOME/.fixer-npm-token" ]; then
  NODE_AUTH_TOKEN="$(tr -d '[:space:]' < "$HOME/.fixer-npm-token")"
fi
: "${NODE_AUTH_TOKEN:?defina NODE_AUTH_TOKEN ou crie ~/.fixer-npm-token}"
export NODE_AUTH_TOKEN
[ -f "$ROOT/infra/prod/.env" ] || { echo "falta infra/prod/.env (copie de .env.example)"; exit 1; }

echo "==> atualizando $BRANCH"
git -C "$ROOT" fetch --quiet origin "$BRANCH"
git -C "$ROOT" checkout --quiet "$BRANCH"
git -C "$ROOT" merge --ff-only "origin/$BRANCH"
echo "    $(git -C "$ROOT" log --oneline -1)"

echo "==> build e subida (migrate -> db-roles -> api -> web)"
"${COMPOSE[@]}" up -d --build --remove-orphans

echo "==> estado"
"${COMPOSE[@]}" ps

HOST="$(grep -E '^FIXER_HOST=' "$ROOT/infra/prod/.env" | cut -d= -f2)"
echo "==> verificando https://$HOST/login"
for i in $(seq 1 20); do
  code="$(curl -s -o /dev/null -w '%{http_code}' "https://$HOST/login" || true)"
  [ "$code" = 200 ] && { echo "    ok (200)"; docker image prune -f >/dev/null; exit 0; }
  sleep 3
done
echo "    sem resposta 200 (último: $code). Veja: ${COMPOSE[*]} logs --tail=100 fixer-api fixer-web"
exit 1
