-- CreateEnum
CREATE TYPE "FiscalEnvironment" AS ENUM ('PRODUCTION', 'HOMOLOGATION');

-- CreateEnum
CREATE TYPE "PurchaseInvoiceStatus" AS ENUM ('SUMMARY', 'MANIFESTED', 'FULL', 'CANCELED', 'IGNORED');

-- CreateEnum
CREATE TYPE "InvoiceExportStatus" AS ENUM ('NOT_READY', 'PENDING_MATCH', 'READY', 'POSTED', 'VOIDED');

-- CreateEnum
CREATE TYPE "ItemResolution" AS ENUM ('UNRESOLVED', 'AUTO_MAP', 'AUTO_EAN', 'MANUAL', 'IGNORED');

-- AlterTable
ALTER TABLE "Part" ADD COLUMN     "ean" TEXT;

-- AlterTable
ALTER TABLE "StockMovement" ADD COLUMN     "purchaseInvoiceItemId" TEXT;

-- AlterTable
ALTER TABLE "tenant_fiscal_settings" ADD COLUMN     "cnpj" TEXT,
ADD COLUMN     "legalName" TEXT,
ADD COLUMN     "ufCode" INTEGER;

-- CreateTable
CREATE TABLE "FiscalCredential" (
    "id" INTEGER NOT NULL DEFAULT 1,
    "environment" "FiscalEnvironment" NOT NULL DEFAULT 'PRODUCTION',
    "pfxCiphertext" BYTEA NOT NULL,
    "pfxPassCiphertext" BYTEA NOT NULL,
    "keyId" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "certCnpj" TEXT NOT NULL,
    "notBefore" TIMESTAMP(3) NOT NULL,
    "notAfter" TIMESTAMP(3) NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "autoManifest" BOOLEAN NOT NULL DEFAULT false,
    "autoExport" BOOLEAN NOT NULL DEFAULT false,
    "autoExportById" TEXT,
    "uploadedById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FiscalCredential_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FiscalSyncState" (
    "id" INTEGER NOT NULL DEFAULT 1,
    "lastNsu" BIGINT NOT NULL DEFAULT 0,
    "maxNsu" BIGINT NOT NULL DEFAULT 0,
    "nextPollAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "leaseUntil" TIMESTAMP(3),
    "leaseOwner" TEXT,
    "consecutiveFailures" INTEGER NOT NULL DEFAULT 0,
    "lastStatusCode" INTEGER,
    "lastError" TEXT,
    "lastRunAt" TIMESTAMP(3),
    "lastSuccessAt" TIMESTAMP(3),

    CONSTRAINT "FiscalSyncState_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FiscalAuditLog" (
    "id" TEXT NOT NULL,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "userId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "detail" JSONB,
    "ip" TEXT,

    CONSTRAINT "FiscalAuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PurchaseInvoice" (
    "id" TEXT NOT NULL,
    "accessKey" TEXT NOT NULL,
    "nsu" BIGINT,
    "series" INTEGER,
    "number" INTEGER,
    "issuedAt" TIMESTAMP(3),
    "issuerCnpj" TEXT NOT NULL,
    "issuerName" TEXT NOT NULL,
    "recipientCnpj" TEXT,
    "totalAmount" DECIMAL(65,30) NOT NULL,
    "finality" INTEGER,
    "operationType" INTEGER,
    "status" "PurchaseInvoiceStatus" NOT NULL DEFAULT 'SUMMARY',
    "manifestedAt" TIMESTAMP(3),
    "canceledAt" TIMESTAMP(3),
    "ignoredReason" TEXT,
    "xmlGz" BYTEA,
    "xmlSha256" TEXT,
    "exportStatus" "InvoiceExportStatus" NOT NULL DEFAULT 'NOT_READY',
    "needsReview" BOOLEAN NOT NULL DEFAULT false,
    "postedAt" TIMESTAMP(3),
    "postedById" TEXT,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PurchaseInvoice_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PurchaseInvoiceItem" (
    "id" TEXT NOT NULL,
    "invoiceId" TEXT NOT NULL,
    "itemNumber" INTEGER NOT NULL,
    "supplierCode" TEXT NOT NULL,
    "ean" TEXT,
    "description" TEXT NOT NULL,
    "ncm" TEXT NOT NULL,
    "cest" TEXT,
    "origin" INTEGER,
    "cfop" TEXT NOT NULL,
    "unit" TEXT NOT NULL,
    "quantity" DECIMAL(65,30) NOT NULL,
    "unitPrice" DECIMAL(65,30) NOT NULL,
    "totalPrice" DECIMAL(65,30) NOT NULL,
    "discount" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "freight" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "insurance" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "otherCosts" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "ipi" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "icmsSt" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "resolution" "ItemResolution" NOT NULL DEFAULT 'UNRESOLVED',
    "partId" TEXT,
    "unitFactor" DECIMAL(65,30) NOT NULL DEFAULT 1,

    CONSTRAINT "PurchaseInvoiceItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SupplierItemMap" (
    "id" TEXT NOT NULL,
    "supplierCnpj" TEXT NOT NULL,
    "supplierCode" TEXT NOT NULL,
    "partId" TEXT NOT NULL,
    "unitFactor" DECIMAL(65,30) NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastUsedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SupplierItemMap_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "FiscalAuditLog_at_idx" ON "FiscalAuditLog"("at");

-- CreateIndex
CREATE UNIQUE INDEX "PurchaseInvoice_accessKey_key" ON "PurchaseInvoice"("accessKey");

-- CreateIndex
CREATE INDEX "PurchaseInvoice_exportStatus_idx" ON "PurchaseInvoice"("exportStatus");

-- CreateIndex
CREATE INDEX "PurchaseInvoice_status_idx" ON "PurchaseInvoice"("status");

-- CreateIndex
CREATE INDEX "PurchaseInvoice_issuedAt_idx" ON "PurchaseInvoice"("issuedAt");

-- CreateIndex
CREATE INDEX "PurchaseInvoiceItem_supplierCode_idx" ON "PurchaseInvoiceItem"("supplierCode");

-- CreateIndex
CREATE UNIQUE INDEX "PurchaseInvoiceItem_invoiceId_itemNumber_key" ON "PurchaseInvoiceItem"("invoiceId", "itemNumber");

-- CreateIndex
CREATE UNIQUE INDEX "SupplierItemMap_supplierCnpj_supplierCode_key" ON "SupplierItemMap"("supplierCnpj", "supplierCode");

-- CreateIndex
CREATE INDEX "Part_ean_idx" ON "Part"("ean");

-- CreateIndex
CREATE UNIQUE INDEX "StockMovement_purchaseInvoiceItemId_type_key" ON "StockMovement"("purchaseInvoiceItemId", "type");

-- AddForeignKey
ALTER TABLE "StockMovement" ADD CONSTRAINT "StockMovement_purchaseInvoiceItemId_fkey" FOREIGN KEY ("purchaseInvoiceItemId") REFERENCES "PurchaseInvoiceItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FiscalCredential" ADD CONSTRAINT "FiscalCredential_autoExportById_fkey" FOREIGN KEY ("autoExportById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FiscalCredential" ADD CONSTRAINT "FiscalCredential_uploadedById_fkey" FOREIGN KEY ("uploadedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FiscalSyncState" ADD CONSTRAINT "FiscalSyncState_id_fkey" FOREIGN KEY ("id") REFERENCES "FiscalCredential"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FiscalAuditLog" ADD CONSTRAINT "FiscalAuditLog_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PurchaseInvoice" ADD CONSTRAINT "PurchaseInvoice_postedById_fkey" FOREIGN KEY ("postedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PurchaseInvoiceItem" ADD CONSTRAINT "PurchaseInvoiceItem_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "PurchaseInvoice"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PurchaseInvoiceItem" ADD CONSTRAINT "PurchaseInvoiceItem_partId_fkey" FOREIGN KEY ("partId") REFERENCES "Part"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupplierItemMap" ADD CONSTRAINT "SupplierItemMap_partId_fkey" FOREIGN KEY ("partId") REFERENCES "Part"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

