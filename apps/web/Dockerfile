# Built from the monorepo root: docker build -f apps/web/Dockerfile .
# Multi-stage so the final image carries only Next.js's standalone output.

FROM node:22-alpine AS base
WORKDIR /repo

FROM base AS deps
COPY .npmrc package.json package-lock.json turbo.json ./
COPY packages/ui/package.json packages/ui/package.json
COPY packages/config/package.json packages/config/package.json
COPY apps/web/package.json apps/web/package.json
# O token de leitura do registro @max-gateway entra só como segredo de build (nunca em camada).
RUN --mount=type=secret,id=npm_token NODE_AUTH_TOKEN="$(cat /run/secrets/npm_token)" npm ci

FROM deps AS build
COPY packages/ui packages/ui
COPY packages/config packages/config
COPY apps/web apps/web
# Next.js needs `output: "standalone"` in next.config for this build to
# produce apps/web/.next/standalone — set that when the app is scaffolded.
RUN npm run build --workspace=@fixer/web

FROM base AS runtime
ENV NODE_ENV=production
COPY --from=build /repo/apps/web/.next/standalone ./
COPY --from=build /repo/apps/web/.next/static ./apps/web/.next/static
COPY --from=build /repo/apps/web/public ./apps/web/public
WORKDIR /repo/apps/web
EXPOSE 3001
ENV PORT=3001
CMD ["node", "server.js"]
