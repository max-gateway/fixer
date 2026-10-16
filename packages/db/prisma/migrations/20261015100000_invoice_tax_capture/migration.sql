-- Captura tributária do XML da NF-e de compra (docs/specs/pricing.md §4.0). Aditiva: tudo nullable.
ALTER TABLE "PurchaseInvoice"
  ADD COLUMN "issuerCrt" INTEGER,
  ADD COLUMN "issuerUf" TEXT,
  ADD COLUMN "recipientUf" TEXT,
  ADD COLUMN "destIndicator" INTEGER,
  ADD COLUMN "freightMode" INTEGER,
  ADD COLUMN "totals" JSONB,
  ADD COLUMN "extraFreight" DECIMAL(65,30);

CREATE TABLE "PurchaseInvoiceItemTax" (
    "id" TEXT NOT NULL,
    "orgId" UUID NOT NULL DEFAULT app_org(),
    "itemId" TEXT NOT NULL,
    "indTot" INTEGER,
    "icmsKind" TEXT,
    "icmsCode" TEXT,
    "icmsBase" DECIMAL(65,30),
    "icmsRate" DECIMAL(65,30),
    "icms" DECIMAL(65,30),
    "stBase" DECIMAL(65,30),
    "stRate" DECIMAL(65,30),
    "icmsSt" DECIMAL(65,30),
    "fcpSt" DECIMAL(65,30),
    "stRet" DECIMAL(65,30),
    "fcpStRet" DECIMAL(65,30),
    "deson" DECIMAL(65,30),
    "creditSnRate" DECIMAL(65,30),
    "creditSn" DECIMAL(65,30),
    "ipiCst" TEXT,
    "pisCst" TEXT,
    "pis" DECIMAL(65,30),
    "cofinsCst" TEXT,
    "cofins" DECIMAL(65,30),
    "ibsCbs" JSONB,

    CONSTRAINT "PurchaseInvoiceItemTax_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "PurchaseInvoiceItemTax_itemId_key" ON "PurchaseInvoiceItemTax"("itemId");
CREATE INDEX "PurchaseInvoiceItemTax_orgId_idx" ON "PurchaseInvoiceItemTax"("orgId");

ALTER TABLE "PurchaseInvoiceItemTax" ADD CONSTRAINT "PurchaseInvoiceItemTax_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "PurchaseInvoiceItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "PurchaseInvoiceItemTax" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "PurchaseInvoiceItemTax" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "PurchaseInvoiceItemTax" USING ("orgId" = app_org()) WITH CHECK ("orgId" = app_org());
