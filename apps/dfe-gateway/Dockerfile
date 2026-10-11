# Built from the monorepo root: docker build -f apps/dfe-gateway/Dockerfile .
# Independente de @fixer/db e @fixer/domain: só o próprio workspace entra na imagem.
# Multi-arch (amd64/arm64): tudo é JS puro (node-forge, pg, amqplib), então roda igual na VM Ampere da Oracle.

FROM node:22-alpine AS base
WORKDIR /repo

FROM base AS deps
COPY package.json package-lock.json turbo.json ./
COPY apps/dfe-gateway/package.json apps/dfe-gateway/package.json
RUN npm ci --workspace=@fixer/dfe-gateway --include-workspace-root

FROM deps AS build
COPY apps/dfe-gateway apps/dfe-gateway
RUN npm run build --workspace=@fixer/dfe-gateway \
 && npm prune --omit=dev --workspace=@fixer/dfe-gateway --include-workspace-root

FROM base AS runtime
ENV NODE_ENV=production
COPY --from=build /repo/node_modules node_modules
COPY --from=build /repo/apps/dfe-gateway/dist apps/dfe-gateway/dist
COPY --from=build /repo/apps/dfe-gateway/migrations apps/dfe-gateway/migrations
COPY --from=build /repo/apps/dfe-gateway/package.json apps/dfe-gateway/package.json
WORKDIR /repo/apps/dfe-gateway
USER node
EXPOSE 3010
HEALTHCHECK --interval=15s --timeout=3s --start-period=20s --retries=5 \
  CMD wget -qO- http://127.0.0.1:3010/healthz >/dev/null || exit 1
CMD ["node", "dist/main.js"]
