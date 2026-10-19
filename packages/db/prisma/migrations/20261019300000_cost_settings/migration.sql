-- Dados que o motor de custos precisa e o Fixer não registra sozinho (mix de pagamento, horas da oficina, meta de faturamento).
CREATE TABLE "cost_settings" (
    "orgId" UUID NOT NULL DEFAULT app_org(),
    "paymentMix" JSONB,
    "mechanics" INTEGER,
    "hoursPerMechanic" DECIMAL(65,30),
    "partsRevenueGoal" DECIMAL(65,30),
    "templateApplied" BOOLEAN NOT NULL DEFAULT false,
    "lastSyncAt" TIMESTAMP(3),
    "lastPublishedVersion" INTEGER,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "cost_settings_pkey" PRIMARY KEY ("orgId")
);

ALTER TABLE "cost_settings" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "cost_settings" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "cost_settings" USING ("orgId" = app_org()) WITH CHECK ("orgId" = app_org());
