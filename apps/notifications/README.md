> **Cópia legada.** A fonte deste serviço agora é [max-gateway/platform](https://github.com/max-gateway/platform) (`services/notifications`). Não edite aqui:
> o Fixer só mantém esta pasta até consumir a imagem da plataforma (ver `infra/MIGRATION.md` lá).

# @fixer/notifications

Serviço de notificações do Fixer. Recebe **todas as mudanças nas ordens de serviço** e as transforma em
e-mails e webhooks. Totalmente desacoplado: não importa `@fixer/db` nem `@fixer/domain`, não lê tabelas da
API e a API não conhece este serviço — a única ligação é o JSON publicado no Redis Stream.

```
 API (apps/api)                                         apps/notifications
 ┌──────────────────────────┐                  ┌────────────────────────────────────────────┐
 │ mudança na ordem         │                  │ StreamConsumer ──► IngestService           │
 │  + OutboxEvent (mesma tx)│   Redis Stream   │  (XREADGROUP,       inbox (dedup por id)   │
 │ OutboxRelay ─────────────┼─► fixer:order-   ├─►XAUTOCLAIM, DLQ)   route() → notifications│
 └──────────────────────────┘   events         │                         │ (PENDING)        │
                                               │ Dispatcher ◄────────────┘                  │
                                               │  SKIP LOCKED + lease, retry c/ backoff     │
                                               │  ├─ EmailChannel (SMTP | log)              │
                                               │  └─ WebhookChannel (HMAC-SHA256)           │
                                               └────────────────────────────────────────────┘
```

## Garantias

| Garantia | Como |
|---|---|
| Nenhuma mudança de ordem perde evento | Outbox transacional: o evento é gravado na mesma transação da mudança; o `OutboxRelay` publica depois (at-least-once). |
| Evento repetido não notifica duas vezes | `inbox.event_id` (PK) + `notifications.dedup_key` (`sha256(evento|regra|canal|destinatário)`), tudo na mesma transação que enfileira. ACK do stream só após o COMMIT. |
| Provedor fora do ar não perde nada | Ingestão e envio são separados: o evento vira linha `PENDING` e o `Dispatcher` tenta com backoff exponencial + jitter (`Retry-After` respeitado). |
| Crash no meio do envio | `locked_until` (lease): expirou, outra réplica reivindica. Entrega é at-least-once; o id da notificação vai como `Message-ID` / `X-Fixer-Delivery-Id`. |
| Erro permanente não gasta tentativas | `DeliveryError.retryable=false` (SMTP 5xx, HTTP 4xx exceto 408/429) → `DEAD` direto. |
| Mensagem venenosa não trava o stream | Payload/contrato inválido ou > 5 entregas → `fixer:order-events:dlq` (original + motivo) + ACK. |
| Várias réplicas | Consumer group no stream e `FOR UPDATE SKIP LOCKED` na fila. Migrações serializadas por advisory lock. |

## Contrato (v1)

Definido em `apps/api/src/outbox/order-events.ts` e copiado (de propósito) em `src/contract/order-event.ts`.
Tipos: `order.created`, `order.status_changed`, `order.message_posted`, `order.problem_reported`,
`order.checklist_item_added`, `order.checklist_item_answered`, `order.customer_data_updated`.
O envelope traz um snapshot da ordem (cliente, veículo, responsável, link do portal), então o serviço nunca
precisa consultar a API. Campos novos são ignorados; `version` ≠ 1 vai para a DLQ; tipo desconhecido é
registrado e não notifica.

## Quem é notificado

Regras em `src/routing/rules.ts` (função pura, testada). O autor da ação não é notificado dela:

- **Cliente (e-mail):** OS aberta, mudança de status, mensagem da oficina, item novo no checklist.
- **Equipe (e-mail do responsável, senão de quem abriu):** mensagem do cliente, problema relatado, item de checklist marcado como `ISSUE`.
- **Webhooks (`WEBHOOKS`):** evento cru, assinado, para qualquer tipo que o endpoint assinou (`order.*` ou tipos específicos).

Webhook: `POST` JSON com `X-Fixer-Signature: t=<unix>,v1=<hmac_sha256(secret, "<t>.<corpo>")>`,
`X-Fixer-Event-Id` e `X-Fixer-Delivery-Id`. O receptor deve validar a assinatura, rejeitar `t` antigo e deduplicar por `X-Fixer-Delivery-Id`.

## Configuração

Ver `.env.example`. Obrigatória: `NOTIFICATIONS_DATABASE_URL` (tabelas no schema `notifications`, criado
automaticamente). Marca (nome/cor nos e-mails) vem de `TENANT_DISPLAY_NAME` e `BRAND_PRIMARY_COLOR`, os mesmos do ConfigMap do tenant.
A API precisa de `PORTAL_BASE_URL` (o chart já define) para montar o link do portal no evento.

## Operação

- `GET /health/live`, `GET /health/ready` (Postgres + Redis), `GET /metrics` (Prometheus).
- Alertas sugeridos: `notifications_oldest_due_age_seconds` crescendo (fila atrasada), `notifications_queue_depth{status="DEAD"}` > 0,
  `notifications_events_consumed_total{result="dead_lettered"}` > 0, `XLEN fixer:order-events:dlq` > 0.
- Reprocessar uma `DEAD`: `UPDATE notifications SET status='PENDING', attempts=0, next_attempt_at=now() WHERE id=...`.
- Descadastro: `INSERT INTO suppressions (channel, recipient, reason) VALUES ('email','x@y.com','unsubscribe')` — as próximas viram `SUPPRESSED`.
- Replay de DLQ: copiar o campo `data` da entrada de volta para `fixer:order-events` após corrigir a causa.

## Caixa de entrada da equipe (in-app) e API `/v1`

A equipe também recebe na caixa de entrada do sistema (sino do frontend). O canal `inapp` nasce já
entregue (`SENT`) na ingestão — não depende de provedor — e é avisado em tempo real depois do COMMIT via
Redis pub/sub → SSE. A chave do usuário é o **e-mail** (o evento traz o e-mail do responsável da ordem; o JWT traz o mesmo claim).

Todas as rotas exigem `Authorization: Bearer <access token do Keycloak do tenant>` (validado por JWKS; sem consulta à API).
O frontend as chama via proxy (`apps/web` → `/api/notifications/*`), então o serviço não é exposto na internet.

| Rota | Descrição |
|---|---|
| `GET /v1/inbox?limit&cursor&unread=true` | Itens do usuário (paginação por cursor) + `unreadCount` |
| `POST /v1/inbox/read` `{ids}` ou `{all:true}` | Marca como lidas — só as do próprio usuário |
| `GET /v1/inbox/stream` (SSE) | Evento `notification` por item novo; `ping` a cada 25 s. Sem replay: ao reconectar o cliente relista |
| `GET /v1/orders/:orderId/deliveries` | Auditoria de e-mails/webhooks da ordem (host do webhook, nunca a URL completa) |
| `POST /v1/deliveries/:id/retry` | Reenfileira uma entrega `DEAD` (409 se não estiver) |

## Circuit breaker

Cada canal tem o seu (por réplica): 5 falhas transitórias seguidas abrem o circuito; passados 30 s (dobrando até 5 min)
deixa passar **uma** tentativa de teste. Erros permanentes (4xx) não contam. Enquanto aberto, as notificações do canal
ficam `PENDING` e os outros canais seguem normalmente. Métrica: `notifications_circuit_breaker_state{channel}` (0/1/2) — alerte em 2.

## Retenção

`SENT`/`DEAD`/`SUPPRESSED` com mais de 90 dias e a `inbox` de dedup com mais de 30 dias são apagadas (1x/hora).

## Novo canal (SMS, WhatsApp, push)

Implementar `ChannelProvider` (`src/channels/channel.ts`), registrar em `ChannelRegistry`, incluir o nome em
`ChannelName` e criar a regra em `routing/rules.ts`. O telefone do cliente já vem no evento.

## Limites conhecidos

- O circuit breaker é por réplica (não compartilhado): com N réplicas, cada uma descobre a falha por conta própria.
- O SSE não tem replay; a consistência vem da relistagem ao reconectar e do polling de 60 s quando o stream cai.
- Sem preferências por usuário além da lista de supressão; sem agrupamento/digest de mensagens em rajada.
- Ordem entre notificações não é garantida em retries (um e-mail antigo pode chegar depois de um novo).
- Autorização das rotas `/v1` é "equipe autenticada do tenant": não há papéis por rota; `deliveries` de qualquer ordem é visível a qualquer usuário logado.

## Desenvolvimento

```
cp .env.example .env && npm run dev -w @fixer/notifications   # porta 3005 em dev
npm test -w @fixer/notifications
```
