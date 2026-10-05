# PlateEventsModule

Consome os eventos de leitura de placa publicados pelo microservice
`apps/plate-reader` (Python) no Redis Stream `plate-reader:events`.

## Por que consumer group (em vez de `XREAD` simples)

- **Múltiplas réplicas**: várias instâncias do `@fixer/api` processam em
  paralelo, cada mensagem é entregue a apenas um consumer do grupo.
- **Retomada após restart**: o offset processado fica salvo no Redis,
  associado ao grupo — reiniciar o processo não reprocessa nem perde eventos
  já ACKed.
- **Recuperação de falhas**: se uma réplica morre no meio do processamento
  (antes do ACK), `XAUTOCLAIM` permite que outra réplica (ou a mesma, ao
  voltar) reivindique a mensagem após `claimIdleMs`.

## Onde a lógica de negócio entra

`PlateEventsHandler.handle()` (`plate-events.handler.ts`) — hoje só loga a
leitura. É onde entra registrar a leitura, liberar acesso, notificar morador,
etc., quando essas áreas de domínio existirem.

## Variáveis de ambiente

| Variável | Padrão | Descrição |
|---|---|---|
| `PLATE_READER_REDIS_URL` | `redis://localhost:6379/0` | Mesmo Redis usado pelo `apps/plate-reader` |
| `PLATE_READER_STREAM` | `plate-reader:events` | Nome do stream (deve bater com `PLATE_READER_REDIS_STREAM_NAME` do serviço) |
| `PLATE_READER_CONSUMER_GROUP` | `fixer-core` | Nome do consumer group |
| `PLATE_READER_CONSUMER_NAME` | `fixer-core-<pid>` | Identifica esta réplica dentro do grupo — use um valor estável por réplica (ex.: hostname do pod) em produção |

## Idempotência

Cada evento carrega `request_id`. Como o modelo de entrega do Redis Streams
com consumer groups é **at-least-once** (uma mensagem pode ser reentregue
após um crash antes do ACK), `PlateEventsHandler.handle()` deve ser
idempotente — por exemplo, usando `request_id` como chave de deduplicação em
uma tabela/índice único antes de aplicar efeitos colaterais (liberar acesso,
notificar, etc.).

## Mensagens malformadas

Se um payload não bater com o schema Zod esperado (`schema.ts`), a mensagem é
logada e recebe ACK sem reprocessamento (não fica presa em loop). Em
produção, considere mover essas mensagens para um stream de dead-letter
dedicado em vez de só descartar.

## Poison messages

Mensagens reivindicadas via `XAUTOCLAIM` que já passaram de
`maxDeliveryAttempts` tentativas são logadas como suspeitas e recebem ACK sem
processar, para não travar o consumo do restante do stream. Ajuste esse
limite e a política de dead-letter em `plate-events.config.ts` conforme a
criticidade do dado no Fixer.

## Ciclo de vida

O loop de consumo inicia em `PlateEventsConsumerService.onModuleInit` e para
de forma limpa em `onApplicationShutdown` — por isso `main.ts` chama
`app.enableShutdownHooks()`. Sem isso, o processo não teria a chance de
finalizar o loop e fechar a conexão Redis em um SIGTERM (ex.: rolling deploy).

## Repasse ao frontend (OCR por foto)

`PlateEventsHandler` grava todo resultado em `PlateReadingsStore` (Redis,
`plate-reading:<request_id>`, TTL 10 min). `PlateReadingsModule`
(`src/plate-readings/`) expõe `POST /plate-readings` (imagem → plate-reader) e
`GET /plate-readings/:requestId` (polling). Env: `PLATE_READER_URL`
(padrão `http://localhost:8080`) e `PLATE_READER_LOCATION_ID` (padrão `balcao`).
