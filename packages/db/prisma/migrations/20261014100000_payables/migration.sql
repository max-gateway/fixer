-- Contas a pagar. As parcelas nascem das duplicatas (cobr/dup) do XML da NF-e ou são lançadas à mão.
CREATE TYPE "PayableStatus" AS ENUM ('OPEN', 'PAID', 'CANCELED');
CREATE TYPE "PayableSource" AS ENUM ('XML_INSTALLMENT', 'XML_TOTAL', 'MANUAL');

CREATE TABLE "Payable" (
    "id" TEXT NOT NULL,
    "orgId" UUID NOT NULL DEFAULT app_org(),
    "invoiceId" TEXT,
    "source" "PayableSource" NOT NULL,
    "supplierCnpj" TEXT,
    "supplierName" TEXT NOT NULL,
    "description" TEXT,
    "documentNumber" TEXT,
    "installment" INTEGER NOT NULL DEFAULT 1,
    "installmentCount" INTEGER NOT NULL DEFAULT 1,
    "dueDate" DATE NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "status" "PayableStatus" NOT NULL DEFAULT 'OPEN',
    "paidAt" TIMESTAMP(3),
    "paidAmount" DECIMAL(14,2),
    "paymentMethod" TEXT,
    "paidById" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Payable_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "Payable_orgId_idx" ON "Payable"("orgId");
CREATE INDEX "Payable_status_dueDate_idx" ON "Payable"("status", "dueDate");
CREATE INDEX "Payable_supplierCnpj_idx" ON "Payable"("supplierCnpj");
-- Idempotência do ingest: reprocessar a mesma nota não duplica parcelas.
CREATE UNIQUE INDEX "Payable_orgId_invoiceId_installment_key" ON "Payable"("orgId", "invoiceId", "installment");

ALTER TABLE "Payable" ADD CONSTRAINT "Payable_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "PurchaseInvoice"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Payable" ADD CONSTRAINT "Payable_paidById_fkey" FOREIGN KEY ("paidById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "Payable" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Payable" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "Payable" USING ("orgId" = app_org()) WITH CHECK ("orgId" = app_org());
