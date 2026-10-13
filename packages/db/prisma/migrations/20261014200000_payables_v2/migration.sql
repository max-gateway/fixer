-- Contas a pagar v2: categoria, linha digitável, juros/desconto do pagamento e trilha de auditoria.
ALTER TABLE "Payable" ADD COLUMN "category" TEXT, ADD COLUMN "barcode" TEXT, ADD COLUMN "interest" DECIMAL(14,2), ADD COLUMN "discount" DECIMAL(14,2);
CREATE INDEX "Payable_category_idx" ON "Payable"("category");

CREATE TABLE "PayableEvent" (
    "id" TEXT NOT NULL,
    "orgId" UUID NOT NULL DEFAULT app_org(),
    "payableId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "actorId" TEXT,
    "actorName" TEXT,
    "data" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PayableEvent_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "PayableEvent_orgId_idx" ON "PayableEvent"("orgId");
CREATE INDEX "PayableEvent_payableId_createdAt_idx" ON "PayableEvent"("payableId", "createdAt");
ALTER TABLE "PayableEvent" ADD CONSTRAINT "PayableEvent_payableId_fkey" FOREIGN KEY ("payableId") REFERENCES "Payable"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "PayableEvent" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "PayableEvent" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "PayableEvent" USING ("orgId" = app_org()) WITH CHECK ("orgId" = app_org());
