-- Schema próprio do serviço: nada aqui é compartilhado com a API nem com o serviço de notificações.

-- Quem pode (ou não) receber mensagens e quando foi a última resposta dele (janela de 24h da Meta).
CREATE TABLE IF NOT EXISTS contacts (
  phone           TEXT PRIMARY KEY,               -- E.164 sem "+", ex.: 5511987654321
  opt_status      TEXT        NOT NULL DEFAULT 'UNKNOWN'
                  CHECK (opt_status IN ('UNKNOWN','OPTED_IN','OPTED_OUT')),
  opt_reason      TEXT,
  last_inbound_at TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Fila de saída + histórico de status. A API só grava aqui; o Dispatcher é quem fala com a Meta.
CREATE TABLE IF NOT EXISTS messages (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  idempotency_key TEXT        NOT NULL UNIQUE,
  request_hash    TEXT        NOT NULL,           -- mesma chave + payload diferente = erro do chamador
  to_phone        TEXT        NOT NULL,
  kind            TEXT        NOT NULL CHECK (kind IN ('TEMPLATE','TEXT')),
  template        TEXT,
  language        TEXT,
  variables       JSONB       NOT NULL DEFAULT '[]',
  body            TEXT,
  reference       JSONB       NOT NULL DEFAULT '{}', -- correlação do chamador (ex.: {"orderId": "..."})
  status          TEXT        NOT NULL DEFAULT 'QUEUED'
                  CHECK (status IN ('QUEUED','SENDING','SENT','DELIVERED','READ','FAILED','DEAD','SUPPRESSED')),
  attempts        INT         NOT NULL DEFAULT 0,
  max_attempts    INT         NOT NULL,
  next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  locked_until    TIMESTAMPTZ,
  last_error      TEXT,
  last_error_code TEXT,
  wamid           TEXT UNIQUE,                    -- id da mensagem na Meta; liga os webhooks de status
  sent_at         TIMESTAMPTZ,
  delivered_at    TIMESTAMPTZ,
  read_at         TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS messages_due_idx ON messages (next_attempt_at) WHERE status IN ('QUEUED','SENDING');
CREATE INDEX IF NOT EXISTS messages_phone_idx ON messages (to_phone, created_at DESC);
CREATE INDEX IF NOT EXISTS messages_reference_idx ON messages USING gin (reference jsonb_path_ops);

-- Dedup de webhooks: a Meta reentrega o mesmo evento se não receber 200 a tempo.
CREATE TABLE IF NOT EXISTS webhook_events (
  id          TEXT PRIMARY KEY,                   -- "<wamid>:<status>" ou wamid de entrada
  received_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS inbound_messages (
  wamid       TEXT PRIMARY KEY,
  from_phone  TEXT        NOT NULL,
  type        TEXT        NOT NULL,
  body        TEXT,
  sent_at     TIMESTAMPTZ NOT NULL,
  received_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS inbound_phone_idx ON inbound_messages (from_phone, sent_at DESC);
