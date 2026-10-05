# @fixer/api

NestJS backend do Fixer.

## Rodando localmente

```bash
npm install
npm run start:dev --workspace=@fixer/api
```

## Módulos

- `PlateEventsModule` (`src/plate-events/`) — consome os eventos de leitura de
  placa publicados pelo microservice `apps/plate-reader` (Python) via Redis
  Streams, com consumer group, retry e reivindicação de mensagens travadas.
  Ver `src/plate-events/README.md`.

Próximos módulos por área de domínio (service-orders, stock, customers, auth)
conforme o blueprint de arquitetura do Fixer.

## Autenticação

`AuthModule` (`src/auth/`) aplica um guard global: toda rota exige
`Authorization: Bearer <access token>` do Keycloak do tenant (assinatura via JWKS,
issuer do realm). No primeiro acesso o usuário é criado em `User` (upsert por `sub`).
Use `@Public()` para liberar uma rota e `@CurrentUser()` para obter o usuário.

Env obrigatórias (o boot falha sem elas): `KEYCLOAK_AUTH_SERVER_URL`, `KEYCLOAK_REALM`.
