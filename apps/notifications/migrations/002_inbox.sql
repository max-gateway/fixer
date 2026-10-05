-- Caixa de entrada in-app da equipe: linhas channel='inapp' (nascem SENT, não passam pelo Dispatcher).
ALTER TABLE notifications ADD COLUMN IF NOT EXISTS read_at TIMESTAMPTZ;

-- Listagem paginada por (created_at, id) e contagem de não lidas.
CREATE INDEX IF NOT EXISTS notifications_inbox_idx
  ON notifications (recipient, created_at DESC, id DESC) WHERE channel = 'inapp';
CREATE INDEX IF NOT EXISTS notifications_inbox_unread_idx
  ON notifications (recipient) WHERE channel = 'inapp' AND read_at IS NULL;

-- Retenção: limpeza por data de criação.
CREATE INDEX IF NOT EXISTS notifications_created_idx ON notifications (created_at);
