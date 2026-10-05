# @fixer/whatsapp

Serviço de WhatsApp do Fixer, sobre a **WhatsApp Cloud API (Meta)**. Recebe pedidos de envio de outros
serviços (`apps/api`, `apps/notifications`), enfileira de forma durável e entrega com retry, e processa os
webhooks da Meta (status de entrega/leitura, respostas do cliente, descadastro). Desacoplado: não importa
`@fixer/db`, tem schema Postgres próprio (`whatsapp`) e nenhuma outra parte do sistema lê as tabelas dele.

```
 chamador (api / notifications)                          apps/whatsapp
 ┌──────────────────────┐  POST /v1/messages  ┌───────────────────────────────────────────┐
 │ Bearer <API key>     │  Idempotency-Key    │ MessagesService ─► messages (QUEUED)      │
 └──────────────────────┘ ──────────────────► │   valida template/telefone, opt-out, 24h  │
                                              │                      │                    │
 Meta ◄─────────────────────────────────────  │ Dispatcher ◄─────────┘ SKIP LOCKED+lease  │
   Graph API  (template/text)                 │   token bucket · circuit breaker · backoff│
                                              │                                           │
 Meta ──► POST /webhooks/meta (HMAC-SHA256) ─►│ WebhooksService: sent/delivered/read/     │
                                              │   failed, mensagens recebidas, PARAR/VOLTAR│
                                              └───────────────────────────────────────────┘
```

## API (interna, `Authorization: Bearer <chave>`)

| Rota | Descrição |
|---|---|
| `POST /v1/messages` | Enfileira. **`Idempotency-Key` obrigatória.** `202` + `{id, status, duplicate}`. |
| `GET /v1/messages/:id` | Status (`QUEUED→SENT→DELIVERED→READ`, ou `FAILED/DEAD/SUPPRESSED`). |
| `GET /v1/messages?orderId=` | Mensagens de uma ordem (`reference.orderId`). |
| `POST /v1/contacts/:phone/opt-out` · `opt-in` | Preferência do contato. |
| `GET/POST /webhooks/meta` | Único endpoint público (a Meta chama). Autenticado pela assinatura. |
| `GET /health/live` · `/health/ready` · `/metrics` | Probes e Prometheus. |

```jsonc
// Template (mensagem iniciada pela empresa)
{ "type": "template", "to": "(11) 98765-4321", "template": "os_portal_link",
  "variables": ["12", "Oficina do Zé", "https://…/o/<token>"], "reference": { "orderId": "…" } }
// Texto livre: só até 24h depois da última mensagem do cliente
{ "type": "text", "to": "11987654321", "text": "Seu carro está pronto!" }
```

Telefones são normalizados para E.164 (`5511987654321`) e **nunca voltam inteiros** pela API (`***4321`).

## Garantias

| Garantia | Como |
|---|---|
| Pedido repetido não envia duas vezes | `Idempotency-Key` única + hash do conteúdo: mesma chave/mesmo conteúdo devolve a mensagem existente; conteúdo diferente = `409`. |
| Provedor fora do ar não perde mensagem | Enfileira (`QUEUED`) e entrega depois; backoff exponencial com jitter, `Retry-After` respeitado, até 8 tentativas, depois `DEAD`. |
| Crash no meio do envio | Lease em `locked_until`; outra réplica reivindica (at-least-once). |
| Erro permanente não gasta tentativas | Códigos da Meta classificados (`provider/errors.ts`): número sem WhatsApp, template inválido, fora da janela → `DEAD` direto. Limites de taxa (131056, 130429…) e 5xx são repetidos. |
| Provedor instável não é martelado | Circuit breaker (abre após 5 falhas, meio-aberto com 1 sonda, cooldown dobra até 5 min). |
| Respeita o limite da Meta | Token bucket por réplica (`META_MAX_MPS`, padrão 20/s; limite do número é 80/s). |
| Conformidade | Opt-out (`PARAR`, `SAIR`, `STOP`… só mensagem inteira) é checado no enfileiramento **e** no envio → `SUPPRESSED`. Texto livre só na janela de 24h; fora dela, só template aprovado. |
| Webhook autêntico | `X-Hub-Signature-256` (HMAC-SHA256 do corpo bruto, tempo constante); sem secret configurado nada passa. |
| Webhook repetido/fora de ordem | Dedup em `webhook_events` na mesma transação do efeito; status só avança (`READ` nunca volta para `DELIVERED`). |
| Segredos | Token da Meta só em env/Secret, nunca em log nem em erro. Chaves da API aceitam rotação (várias ao mesmo tempo), comparadas por hash em tempo constante. |

## Templates

Registrados em `src/templates/templates.ts` e **precisam existir aprovados no WhatsApp Manager** com o mesmo
nome, idioma (`pt_BR`) e quantidade de variáveis (categoria *Utility*):

- `os_portal_link` — `Olá! Abrimos a ordem de serviço #{{1}} na {{2}}. Acesse para completar seus dados e contar o que está acontecendo com o veículo: {{3}}`
- `os_status_update` — `Sua ordem de serviço #{{1}} mudou para: {{2}}. Acompanhe e converse com a oficina: {{3}}`

## Rodando

```bash
cp .env.example .env     # WHATSAPP_PROVIDER=log não fala com a Meta: só registra no log
npm run dev --workspace=@fixer/whatsapp
npm test --workspace=@fixer/whatsapp
```

Para produção: `WHATSAPP_PROVIDER=cloud` + `META_ACCESS_TOKEN` (token permanente de System User),
`META_PHONE_NUMBER_ID`, `META_APP_SECRET`, `META_WEBHOOK_VERIFY_TOKEN`; cadastre
`https://<host>/webhooks/meta` no painel da Meta e assine o campo `messages`.

## Vínculo OS ↔ WhatsApp (captura automática do número)

O portal da OS (`/o/<token>`) tem o botão **Falar com a oficina**, um `wa.me` com a mensagem pronta
(`… Código: OS-K7Q2-X9MA`). Quando o cliente envia, a Meta entrega o número dele (já verificado) neste
webhook e o serviço **publica um evento**. Quem vincula é a API, dona da ordem; este serviço não lê nem
escreve nada dela.

```
 cliente ─► WhatsApp ─► POST /webhooks/meta ─► inbound_messages + event_outbox   (UMA transação)
                                                       │ EventRelay (advisory lock, at-least-once)
                                                       ▼
                                         Redis Stream  fixer:whatsapp-inbound
                                                       │ consumer group "fixer-api" (DLQ, XAUTOCLAIM)
                                                       ▼
                                  apps/api: WhatsappLinkService (inbox idempotente, FOR UPDATE)
                                                       │ order.whatsapp_linked (outbox da API)
                                                       ▼
                         apps/notifications ─► POST /v1/messages (texto livre: janela de 24h recém-aberta)
```

Evento `whatsapp.order_code_received` v1 (contrato duplicado nos dois lados de propósito; mudança
incompatível = `version` nova): `{ id, type, version, occurredAt, tenant, source, data: { wamid, from, code, sentAt } }`.

| Garantia | Como |
|---|---|
| Mensagem e evento nunca divergem | O evento nasce na mesma transação que grava a mensagem recebida (outbox). |
| Webhook reentregue não duplica | Dedup por `wamid` em `webhook_events`, na mesma transação. |
| Redis fora do ar não perde nada | O relay publica quando voltar; o evento espera em `event_outbox` (`whatsapp_event_outbox_pending` alerta o atraso). |
| Entrega duplicada no stream é inofensiva | A API deduplica pelo `id` do evento (`ProcessedInboundEvent`) na transação do efeito. |
| Adivinhar códigos em massa | Rate limit por remetente (`ORDER_CODE_MAX_PER_WINDOW` por `ORDER_CODE_WINDOW_MS`); códigos têm 40 bits. |
| Número errado nunca assume a ordem | A API não sobrescreve um telefone diferente: registra o conflito na linha do tempo da oficina. |

Sem `REDIS_URL` o relay fica desligado (a mensagem é processada normalmente, o evento só espera).

Testar localmente sem WhatsApp (webhook assinado com o `META_APP_SECRET` do `.env`):
`npm run simulate:inbound --workspace=@fixer/whatsapp -- --code OS-XXXX-XXXX --from 11987654321`.

Testes de integração (Postgres e Redis reais, pulados por padrão):
`WHATSAPP_TEST_DATABASE_URL=… WHATSAPP_TEST_REDIS_URL=… npm test --workspace=@fixer/whatsapp`.
Use um banco descartável.

## Ainda não faz (próximos passos)

- Subir o serviço no chart Helm (`fixer-tenant`): hoje só roda local; ao subir, expor `REDIS_URL` e `TENANT_SLUG` aqui e
  `WHATSAPP_BUSINESS_PHONE` na API.
- Responder ao cliente que escreve algo que não é código (ex.: "qual o status?"); hoje só o vínculo é tratado.
- Mensagens de mídia (imagem/PDF) e botões de resposta rápida.
- Limite de taxa por destinatário e fila de prioridade.
- Helm/Terraform do serviço e Secret das credenciais da Meta.
