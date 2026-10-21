# Built from the monorepo root: docker build -f apps/notifications/Dockerfile .
# Independente de @fixer/db e @fixer/domain: só o próprio workspace entra na imagem.

FROM node:22-alpine AS base
WORKDIR /repo

FROM base AS deps
COPY .npmrc package.json package-lock.json turbo.json ./
COPY apps/notifications/package.json apps/notifications/package.json
# O token de leitura do registro @max-gateway entra só como segredo de build (nunca em camada).
RUN --mount=type=secret,id=npm_token NODE_AUTH_TOKEN="$(cat /run/secrets/npm_token)" npm ci --workspace=@fixer/notifications --include-workspace-root

FROM deps AS build
COPY apps/notifications apps/notifications
RUN npm run build --workspace=@fixer/notifications

FROM base AS runtime
ENV NODE_ENV=production
COPY --from=build /repo/node_modules node_modules
COPY --from=build /repo/apps/notifications apps/notifications
WORKDIR /repo/apps/notifications
USER node
EXPOSE 3002
CMD ["node", "dist/main.js"]
