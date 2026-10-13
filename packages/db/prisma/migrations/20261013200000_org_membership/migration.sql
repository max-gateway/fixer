-- Quem participa de qual organização, alimentado pelos eventos de identidade do control plane (identity.member_ready).
-- É a fonte de verdade da participação: o claim "organization" do Keycloak 26.0 é intermitente para quem está em várias
-- organizações, então ele serve de atalho, nunca de autoridade.
CREATE TABLE "OrgMembership" (
    "orgId" UUID NOT NULL DEFAULT app_org(),
    "keycloakId" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "role" TEXT NOT NULL DEFAULT 'member',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OrgMembership_pkey" PRIMARY KEY ("orgId", "keycloakId")
);
-- Descobrir as organizações de um usuário (sub do token) é a consulta quente.
CREATE INDEX "OrgMembership_keycloakId_idx" ON "OrgMembership"("keycloakId");

ALTER TABLE "OrgMembership" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "OrgMembership" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "OrgMembership" USING ("orgId" = app_org()) WITH CHECK ("orgId" = app_org());
