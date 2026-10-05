# Built from the monorepo root: docker build -f apps/whatsapp/Dockerfile .
# Independente de @fixer/db e @fixer/domain: só o próprio workspace entra na imagem.

FROM node:22-alpine AS base
WORKDIR /repo

FROM base AS deps
COPY package.json package-lock.json turbo.json ./
COPY apps/whatsapp/package.json apps/whatsapp/package.json
RUN npm ci --workspace=@fixer/whatsapp --include-workspace-root

FROM deps AS build
COPY apps/whatsapp apps/whatsapp
RUN npm run build --workspace=@fixer/whatsapp

FROM base AS runtime
ENV NODE_ENV=production
COPY --from=build /repo/node_modules node_modules
COPY --from=build /repo/apps/whatsapp apps/whatsapp
WORKDIR /repo/apps/whatsapp
USER node
EXPOSE 3006
CMD ["node", "dist/main.js"]
