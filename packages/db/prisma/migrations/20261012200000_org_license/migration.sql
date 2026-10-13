-- Provisionamento e licença por organização, alimentados pelos eventos do control plane da Max Gateway.
-- Spec: docs/specs/multi-tenancy.md §6.

-- Dados da organização que o control plane enviou ao criá-la (o dono vira Admin no primeiro login).
CREATE TABLE "OrgProfile" (
    "orgId" UUID NOT NULL DEFAULT app_org(),
    "slug" TEXT,
    "ownerEmail" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OrgProfile_pkey" PRIMARY KEY ("orgId")
);

-- Último estado de licença conhecido (snapshot assinado do control plane). Sem linha = sem restrição (instalação legada).
CREATE TABLE "OrgLicense" (
    "orgId" UUID NOT NULL DEFAULT app_org(),
    "status" TEXT NOT NULL,
    "mode" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "trialEndsAt" TIMESTAMP(3),
    "readonlyUntil" TIMESTAMP(3),
    "entitlements" JSONB NOT NULL DEFAULT '{}',
    "refreshedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OrgLicense_pkey" PRIMARY KEY ("orgId"),
    CONSTRAINT "OrgLicense_mode_check" CHECK ("mode" IN ('full', 'readonly', 'none'))
);

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['OrgProfile', 'OrgLicense'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY tenant_isolation ON %I USING ("orgId" = app_org()) WITH CHECK ("orgId" = app_org())', t);
  END LOOP;
END $$;
