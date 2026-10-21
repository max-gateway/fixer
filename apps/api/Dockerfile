# Built from the monorepo root: docker build -f apps/api/Dockerfile .
# Multi-stage so the final image carries only production deps + compiled output.

FROM node:22-alpine AS base
WORKDIR /repo

FROM base AS deps
COPY .npmrc package.json package-lock.json turbo.json ./
COPY packages/db/package.json packages/db/package.json
COPY packages/domain/package.json packages/domain/package.json
COPY packages/catalog/package.json packages/catalog/package.json
COPY packages/config/package.json packages/config/package.json
COPY apps/api/package.json apps/api/package.json
# O token de leitura do registro @max-gateway entra só como segredo de build (nunca em camada).
RUN --mount=type=secret,id=npm_token NODE_AUTH_TOKEN="$(cat /run/secrets/npm_token)" npm ci

FROM deps AS build
COPY packages/db packages/db
COPY packages/domain packages/domain
COPY packages/catalog packages/catalog
COPY packages/config packages/config
COPY apps/api apps/api
RUN npm run build --workspace=@fixer/db
RUN npm run build --workspace=@fixer/domain
RUN npm run build --workspace=@fixer/catalog
RUN npm run build --workspace=@fixer/api

FROM base AS runtime
ENV NODE_ENV=production
COPY --from=build /repo/node_modules node_modules
COPY --from=build /repo/packages packages
COPY --from=build /repo/apps/api apps/api
WORKDIR /repo/apps/api
EXPOSE 3000
CMD ["node", "dist/main.js"]
