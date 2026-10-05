-- Outbox transacional de eventos DESTE serviço para o resto do sistema (hoje: código de OS recebido).
-- O evento nasce na MESMA transação que grava a mensagem recebida: ou os dois existem, ou nenhum.
-- A publicação no Redis Stream é feita depois, por um relay (at-least-once; quem consome deduplica por id).
CREATE TABLE IF NOT EXISTS event_outbox (
  seq          BIGSERIAL PRIMARY KEY,             -- ordem global de emissão
  id           UUID        NOT NULL UNIQUE,       -- id do evento (o consumidor deduplica por ele)
  type         TEXT        NOT NULL,
  subject      TEXT        NOT NULL,              -- telefone de origem: base do rate limit por remetente
  payload      JSONB       NOT NULL,              -- envelope completo, exatamente o que vai para o stream
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  published_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS event_outbox_pending_idx ON event_outbox (seq) WHERE published_at IS NULL;
CREATE INDEX IF NOT EXISTS event_outbox_subject_idx ON event_outbox (subject, created_at DESC);
