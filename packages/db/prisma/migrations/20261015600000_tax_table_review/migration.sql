-- Aceite do contador por tabela de regra tributária (packages/tax-rules): a versão que ele validou; mudou a versão, o aceite cai.
CREATE TABLE "tax_table_review" (
    "orgId" UUID NOT NULL DEFAULT app_org(),
    "tableId" TEXT NOT NULL,
    "version" TEXT NOT NULL,
    "reviewedBy" TEXT NOT NULL,
    "reviewedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "tax_table_review_pkey" PRIMARY KEY ("orgId","tableId")
);

ALTER TABLE "tax_table_review" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "tax_table_review" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "tax_table_review" USING ("orgId" = app_org()) WITH CHECK ("orgId" = app_org());

-- O aceite do perfil passa a valer só para os percentuais e a RBT12; a versão das tabelas é validada tabela a tabela.
ALTER TABLE "tenant_tax_profile" DROP COLUMN "reviewedRulesVersion";
