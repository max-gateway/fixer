-- Controle de acesso: último acesso do usuário (convidado que nunca entrou = NULL) e trilha de auditoria por organização.
ALTER TABLE "User" ADD COLUMN "lastSeenAt" TIMESTAMP(3);
-- Quem já existe entrou ao menos uma vez (o usuário só nascia no login).
UPDATE "User" SET "lastSeenAt" = "updatedAt";

CREATE TABLE "AccessAuditLog" (
    "id" TEXT NOT NULL,
    "orgId" UUID NOT NULL DEFAULT app_org(),
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actorId" TEXT,
    "actorName" TEXT,
    "action" TEXT NOT NULL,
    "targetType" TEXT NOT NULL,
    "targetId" TEXT NOT NULL,
    "targetLabel" TEXT,
    "detail" JSONB,

    CONSTRAINT "AccessAuditLog_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "AccessAuditLog_orgId_at_idx" ON "AccessAuditLog"("orgId", "at");

ALTER TABLE "AccessAuditLog" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "AccessAuditLog" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "AccessAuditLog" USING ("orgId" = app_org()) WITH CHECK ("orgId" = app_org());
