-- Snapshot imutável da entrada no estoque por nota e valorização dos movimentos (docs/specs/stock-entry-snapshot.md).
-- Aditiva: colunas novas são nullable; movimentos e linhas de OS anteriores ficam sem custo (não há backfill retroativo).

ALTER TABLE "StockMovement" ADD COLUMN "unitCost" DECIMAL(65,30);
ALTER TABLE "StockMovement" ADD COLUMN "avgCostBefore" DECIMAL(65,30);
ALTER TABLE "StockMovement" ADD COLUMN "avgCostAfter" DECIMAL(65,30);

ALTER TABLE "ServiceOrderPartLine" ADD COLUMN "unitCost" DECIMAL(65,30);

CREATE TABLE "StockEntrySnapshot" (
    "id" TEXT NOT NULL,
    "orgId" UUID NOT NULL DEFAULT app_org(),
    "stockMovementId" TEXT NOT NULL,
    "partId" TEXT NOT NULL,
    "purchaseInvoiceItemId" TEXT NOT NULL,
    "schemaVersion" INTEGER NOT NULL,
    "quantity" DECIMAL(65,30) NOT NULL,
    "unitCost" DECIMAL(65,30) NOT NULL,
    "totalCost" DECIMAL(65,30) NOT NULL,
    "avgCostAfter" DECIMAL(65,30) NOT NULL,
    "sellPriceAfter" DECIMAL(65,30) NOT NULL,
    "priceChanged" BOOLEAN NOT NULL,
    "taxRulesVersion" TEXT NOT NULL,
    "rulesetVersion" TEXT,
    "costProfileVersion" INTEGER,
    "context" JSONB NOT NULL,
    "contentHash" TEXT NOT NULL,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StockEntrySnapshot_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "StockEntrySnapshot_stockMovementId_key" ON "StockEntrySnapshot"("stockMovementId");
CREATE INDEX "StockEntrySnapshot_partId_createdAt_idx" ON "StockEntrySnapshot"("partId", "createdAt");
CREATE INDEX "StockEntrySnapshot_purchaseInvoiceItemId_idx" ON "StockEntrySnapshot"("purchaseInvoiceItemId");
CREATE INDEX "StockEntrySnapshot_orgId_idx" ON "StockEntrySnapshot"("orgId");
ALTER TABLE "StockEntrySnapshot" ADD CONSTRAINT "StockEntrySnapshot_stockMovementId_fkey" FOREIGN KEY ("stockMovementId") REFERENCES "StockMovement"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "StockEntrySnapshot" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "StockEntrySnapshot" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "StockEntrySnapshot" USING ("orgId" = app_org()) WITH CHECK ("orgId" = app_org());

-- Imutável: a fotografia nunca muda depois de gravada. Correção = estorno + novo lançamento, não UPDATE.
CREATE FUNCTION stock_entry_snapshot_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'StockEntrySnapshot é imutável (id %)', OLD."id" USING ERRCODE = 'restrict_violation';
END $$;
CREATE TRIGGER stock_entry_snapshot_no_update BEFORE UPDATE ON "StockEntrySnapshot"
  FOR EACH ROW EXECUTE FUNCTION stock_entry_snapshot_immutable();
