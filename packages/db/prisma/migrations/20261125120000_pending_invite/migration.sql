-- Convite da tela de acessos que aguarda a identidade da pessoa no control plane (a criação da conta é assíncrona). Guarda só a intenção do Fixer: os papéis
-- da oficina que a pessoa terá quando `identity.member_ready` chegar. Aditiva.
CREATE TABLE "PendingInvite" (
    "id" TEXT NOT NULL,
    "orgId" UUID NOT NULL DEFAULT app_org(),
    "email" TEXT NOT NULL,
    "name" TEXT,
    "roleIds" TEXT[],
    "invitedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PendingInvite_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "PendingInvite_orgId_email_key" ON "PendingInvite"("orgId", "email");
CREATE INDEX "PendingInvite_orgId_idx" ON "PendingInvite"("orgId");

ALTER TABLE "PendingInvite" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "PendingInvite" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "PendingInvite" USING ("orgId" = app_org()) WITH CHECK ("orgId" = app_org());
