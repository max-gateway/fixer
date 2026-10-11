-- DropIndex
DROP INDEX "PurchaseInvoice_status_idx";

-- AlterTable
ALTER TABLE "PurchaseInvoice" ADD COLUMN     "manifestAttempts" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "manifestError" TEXT,
ADD COLUMN     "manifestNextAt" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "PurchaseInvoice_status_manifestNextAt_idx" ON "PurchaseInvoice"("status", "manifestNextAt");

