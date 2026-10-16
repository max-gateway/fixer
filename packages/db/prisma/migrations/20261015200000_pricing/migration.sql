-- Precificação a partir da nota de compra (docs/specs/pricing.md §4). Aditiva.
CREATE TYPE "PricingMethod" AS ENUM ('MARGIN', 'MARKUP');
CREATE TYPE "PricingScope" AS ENUM ('DEFAULT', 'SUPPLIER', 'NCM', 'PART');
CREATE TYPE "RoundingMode" AS ENUM ('NONE', 'CENTS_90', 'CENTS_00', 'MULTIPLE_5', 'MULTIPLE_10');
CREATE TYPE "PricingMode" AS ENUM ('AUTO', 'MANUAL');
CREATE TYPE "IcmsStStatus" AS ENUM ('UNKNOWN', 'NOT_ST', 'ST_CHARGED', 'ST_PAID_BEFORE');
CREATE TYPE "TaxFlagsSource" AS ENUM ('XML', 'TABELA', 'MANUAL');
CREATE TYPE "PriceChangeSource" AS ENUM ('INVOICE', 'MANUAL', 'AUTO', 'REVERSAL');

ALTER TABLE "Part"
  ADD COLUMN "avgCost" DECIMAL(65,30),
  ADD COLUMN "pricingMode" "PricingMode" NOT NULL DEFAULT 'AUTO',
  ADD COLUMN "icmsStStatus" "IcmsStStatus" NOT NULL DEFAULT 'UNKNOWN',
  ADD COLUMN "pisCofinsMonofasico" BOOLEAN,
  ADD COLUMN "taxFlagsSource" "TaxFlagsSource";

ALTER TABLE "PurchaseInvoiceItem"
  ADD COLUMN "suggestedSellPrice" DECIMAL(65,30),
  ADD COLUMN "draftSellPrice" DECIMAL(65,30),
  ADD COLUMN "pricingRuleId" TEXT,
  ADD COLUMN "priceAck" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "appliedSellPrice" DECIMAL(65,30),
  ADD COLUMN "costSnapshot" JSONB,
  ADD COLUMN "saleTaxSnapshot" JSONB;

CREATE TABLE "PricingRule" (
    "id" TEXT NOT NULL,
    "orgId" UUID NOT NULL DEFAULT app_org(),
    "scope" "PricingScope" NOT NULL,
    "scopeKey" TEXT NOT NULL DEFAULT '',
    "method" "PricingMethod" NOT NULL DEFAULT 'MARGIN',
    "value" DECIMAL(65,30) NOT NULL,
    "taxPctOverride" DECIMAL(65,30),
    "overheadPct" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "rounding" "RoundingMode" NOT NULL DEFAULT 'CENTS_90',
    "minMarginPct" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "maxJumpPct" DECIMAL(65,30) NOT NULL DEFAULT 25,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PricingRule_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "PricingRule_orgId_scope_scopeKey_key" ON "PricingRule"("orgId", "scope", "scopeKey");
CREATE INDEX "PricingRule_orgId_idx" ON "PricingRule"("orgId");

CREATE TABLE "tenant_tax_profile" (
    "orgId" UUID NOT NULL DEFAULT app_org(),
    "simplesEffectiveRatePct" DECIMAL(65,30),
    "icmsSharePct" DECIMAL(65,30),
    "pisSharePct" DECIMAL(65,30),
    "cofinsSharePct" DECIMAL(65,30),
    "requireTaxConfirmation" BOOLEAN NOT NULL DEFAULT false,
    "reviewedBy" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "tenant_tax_profile_pkey" PRIMARY KEY ("orgId")
);

CREATE TABLE "PartPriceHistory" (
    "id" TEXT NOT NULL,
    "orgId" UUID NOT NULL DEFAULT app_org(),
    "partId" TEXT NOT NULL,
    "costBefore" DECIMAL(65,30),
    "costAfter" DECIMAL(65,30) NOT NULL,
    "sellBefore" DECIMAL(65,30),
    "sellAfter" DECIMAL(65,30) NOT NULL,
    "marginAfter" DECIMAL(65,30),
    "saleTaxPct" DECIMAL(65,30),
    "costBreakdown" JSONB,
    "saleTaxBreakdown" JSONB,
    "taxRulesVersion" TEXT,
    "source" "PriceChangeSource" NOT NULL,
    "purchaseInvoiceItemId" TEXT,
    "pricingRuleId" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PartPriceHistory_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "PartPriceHistory_purchaseInvoiceItemId_source_key" ON "PartPriceHistory"("purchaseInvoiceItemId", "source");
CREATE INDEX "PartPriceHistory_partId_createdAt_idx" ON "PartPriceHistory"("partId", "createdAt");
CREATE INDEX "PartPriceHistory_orgId_idx" ON "PartPriceHistory"("orgId");
ALTER TABLE "PartPriceHistory" ADD CONSTRAINT "PartPriceHistory_partId_fkey" FOREIGN KEY ("partId") REFERENCES "Part"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "PricingRule" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "PricingRule" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "PricingRule" USING ("orgId" = app_org()) WITH CHECK ("orgId" = app_org());
ALTER TABLE "tenant_tax_profile" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "tenant_tax_profile" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "tenant_tax_profile" USING ("orgId" = app_org()) WITH CHECK ("orgId" = app_org());
ALTER TABLE "PartPriceHistory" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "PartPriceHistory" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "PartPriceHistory" USING ("orgId" = app_org()) WITH CHECK ("orgId" = app_org());
