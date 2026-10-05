-- Schema próprio do serviço: nada aqui é compartilhado com as tabelas da API.
CREATE TABLE IF NOT EXISTS inbox (
  event_id     UUID PRIMARY KEY,
  event_type   TEXT        NOT NULL,
  received_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS notifications (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  dedup_key           TEXT        NOT NULL UNIQUE,
  event_id            UUID        NOT NULL,
  event_type          TEXT        NOT NULL,
  tenant              TEXT        NOT NULL,
  order_id            TEXT        NOT NULL,
  channel             TEXT        NOT NULL,
  recipient_kind      TEXT        NOT NULL,
  recipient           TEXT        NOT NULL,
  template            TEXT        NOT NULL,
  message             JSONB       NOT NULL,
  status              TEXT        NOT NULL DEFAULT 'PENDING'
                      CHECK (status IN ('PENDING','SENDING','SENT','DEAD','SUPPRESSED')),
  attempts            INT         NOT NULL DEFAULT 0,
  max_attempts        INT         NOT NULL,
  next_attempt_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  locked_until        TIMESTAMPTZ,
  last_error          TEXT,
  provider_message_id TEXT,
  sent_at             TIMESTAMPTZ,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Fila de entrega: só as linhas ainda acionáveis.
CREATE INDEX IF NOT EXISTS notifications_due_idx
  ON notifications (next_attempt_at) WHERE status IN ('PENDING','SENDING');
CREATE INDEX IF NOT EXISTS notifications_order_idx ON notifications (order_id, created_at);

-- Opt-out por canal/destinatário (descadastro, bounce permanente).
CREATE TABLE IF NOT EXISTS suppressions (
  channel    TEXT        NOT NULL,
  recipient  TEXT        NOT NULL,
  reason     TEXT        NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (channel, recipient)
);
