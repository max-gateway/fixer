-- dfe-gateway: um consumidor da SEFAZ por CNPJ (docs/specs/dfe-gateway.md §5).
-- Rodado dentro do schema "dfe" (search_path definido na conexão).

CREATE TABLE tenants (
  id          TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  slug        TEXT NOT NULL UNIQUE CHECK (slug ~ '^[a-z0-9][a-z0-9-]{1,62}$'),
  kind        TEXT NOT NULL CHECK (kind IN ('FIXER', 'ROCKET', 'OTHER')),
  status      TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'SUSPENDED')),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Chave de API por tenant. Só o hash do segredo é guardado; a chave inteira aparece uma única vez, na criação.
CREATE TABLE api_keys (
  id           TEXT PRIMARY KEY,
  tenant_id    TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  secret_hash  BYTEA NOT NULL,
  label        TEXT NOT NULL DEFAULT '',
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_used_at TIMESTAMPTZ,
  revoked_at   TIMESTAMPTZ
);
CREATE INDEX api_keys_tenant ON api_keys (tenant_id);

CREATE TABLE companies (
  id          TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  cnpj        TEXT NOT NULL UNIQUE,                 -- 14 posições, global: garante um dono por CNPJ (D1)
  owner_id    TEXT NOT NULL REFERENCES tenants(id),
  legal_name  TEXT,
  uf_code     INTEGER CHECK (uf_code BETWEEN 11 AND 53),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE credentials (
  company_id          TEXT PRIMARY KEY REFERENCES companies(id) ON DELETE CASCADE,
  environment         TEXT NOT NULL CHECK (environment IN ('PRODUCTION', 'HOMOLOGATION')),
  pfx_ciphertext      BYTEA NOT NULL,
  pfx_pass_ciphertext BYTEA NOT NULL,
  key_id              TEXT NOT NULL,
  subject             TEXT NOT NULL,
  cert_cnpj           TEXT NOT NULL,
  not_before          TIMESTAMPTZ NOT NULL,
  not_after           TIMESTAMPTZ NOT NULL,
  status              TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'DISABLED', 'EXPIRED')),
  enabled             BOOLEAN NOT NULL DEFAULT false,
  auto_manifest       BOOLEAN NOT NULL DEFAULT false,
  version             INTEGER NOT NULL DEFAULT 1,
  uploaded_by         TEXT NOT NULL,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Uma linha por CNPJ. Sobrevive à troca/remoção do certificado: o NSU é da empresa, não do certificado.
CREATE TABLE sync_state (
  company_id           TEXT PRIMARY KEY REFERENCES companies(id) ON DELETE CASCADE,
  last_nsu             BIGINT NOT NULL DEFAULT 0,
  max_nsu              BIGINT NOT NULL DEFAULT 0,
  next_poll_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  lease_until          TIMESTAMPTZ,
  lease_owner          TEXT,
  last_status_code     INTEGER,
  last_error           TEXT,
  last_run_at          TIMESTAMPTZ,
  last_success_at      TIMESTAMPTZ,
  consecutive_failures INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX sync_state_due ON sync_state (next_poll_at);

-- Documento distribuído, imutável. xml_gzip = gzip, como a SEFAZ entrega.
CREATE TABLE documents (
  id          BIGSERIAL PRIMARY KEY,
  company_id  TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  nsu         BIGINT NOT NULL,
  schema      TEXT NOT NULL,
  access_key  TEXT,
  xml_gzip    BYTEA NOT NULL,
  received_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (company_id, nsu)
);
CREATE INDEX documents_key ON documents (company_id, access_key);

CREATE TABLE subscriptions (
  id                TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  company_id        TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  tenant_id         TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  transport         TEXT NOT NULL DEFAULT 'PULL' CHECK (transport IN ('PULL', 'WEBHOOK', 'RABBITMQ', 'REDIS_STREAM')),
  target            JSONB NOT NULL DEFAULT '{}',
  secret_ciphertext BYTEA,
  secret_key_id     TEXT,
  acked_nsu         BIGINT NOT NULL DEFAULT 0,
  status            TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'PAUSED', 'FAILING')),
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (company_id, tenant_id)
);

-- Outbox: no máximo UMA entrega pendente por assinatura; novos documentos ampliam to_nsu (coalescência).
CREATE TABLE deliveries (
  id              BIGSERIAL PRIMARY KEY,
  subscription_id TEXT NOT NULL REFERENCES subscriptions(id) ON DELETE CASCADE,
  from_nsu        BIGINT NOT NULL,
  to_nsu          BIGINT NOT NULL,
  attempts        INTEGER NOT NULL DEFAULT 0,
  next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  locked_until    TIMESTAMPTZ,
  state           TEXT NOT NULL DEFAULT 'PENDING' CHECK (state IN ('PENDING', 'DELIVERED', 'DEAD')),
  last_error      TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  delivered_at    TIMESTAMPTZ
);
CREATE UNIQUE INDEX deliveries_one_pending ON deliveries (subscription_id) WHERE state = 'PENDING';
CREATE INDEX deliveries_due ON deliveries (next_attempt_at) WHERE state = 'PENDING';

-- Ciência da Operação: fila por chave de acesso.
CREATE TABLE manifestations (
  id            BIGSERIAL PRIMARY KEY,
  company_id    TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  access_key    TEXT NOT NULL,
  status        TEXT NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'REGISTERED', 'IGNORED')),
  attempts      INTEGER NOT NULL DEFAULT 0,
  next_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  error         TEXT,
  registered_at TIMESTAMPTZ,
  UNIQUE (company_id, access_key)
);
CREATE INDEX manifestations_pending ON manifestations (company_id, next_at) WHERE status = 'PENDING';

-- Auditoria imutável.
CREATE TABLE audit_log (
  id         BIGSERIAL PRIMARY KEY,
  at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  actor      TEXT NOT NULL,
  action     TEXT NOT NULL,
  company_id TEXT,
  detail     JSONB NOT NULL DEFAULT '{}',
  ip         TEXT
);
CREATE FUNCTION audit_log_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'audit_log é imutável';
END
$$;
CREATE TRIGGER audit_log_no_change BEFORE UPDATE OR DELETE ON audit_log
  FOR EACH ROW EXECUTE FUNCTION audit_log_immutable();
