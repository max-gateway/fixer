-- Preenchimento automático da configuração fiscal (docs/specs/fiscal-autofill.md): CNAE e serviço padrão da oficina, e a
-- origem de cada valor preenchido (valor MANUAL nunca é sobrescrito sozinho).
ALTER TABLE "tenant_fiscal_settings" ADD COLUMN "cnae" TEXT, ADD COLUMN "lc116Item" TEXT;

CREATE TYPE "FiscalValueSource" AS ENUM ('CNPJ_LOOKUP', 'INTEGRA_PGDASD', 'INTEGRA_PAGAMENTOS', 'NFSE_PARAMETROS', 'TAX_RULES_DEFAULT', 'FIXER_ESTIMATE', 'MANUAL');
CREATE TYPE "FiscalValueConfidence" AS ENUM ('OFICIAL', 'INFERIDO', 'ESTIMADO', 'INFORMADO');

CREATE TABLE "fiscal_field_provenance" (
    "orgId" UUID NOT NULL DEFAULT app_org(),
    "field" TEXT NOT NULL,
    "source" "FiscalValueSource" NOT NULL,
    "confidence" "FiscalValueConfidence" NOT NULL,
    "fetchedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reference" TEXT,
    "evidence" JSONB,
    "updatedBy" TEXT,

    CONSTRAINT "fiscal_field_provenance_pkey" PRIMARY KEY ("orgId","field")
);

ALTER TABLE "fiscal_field_provenance" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "fiscal_field_provenance" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "fiscal_field_provenance" USING ("orgId" = app_org()) WITH CHECK ("orgId" = app_org());
