-- CreateEnum
CREATE TYPE "EventAuthor" AS ENUM ('CUSTOMER', 'SHOP', 'SYSTEM');

-- CreateEnum
CREATE TYPE "EventType" AS ENUM ('MESSAGE', 'PROBLEM_REPORT', 'STATUS_CHANGE', 'CHECKLIST_UPDATE', 'CUSTOMER_DATA_UPDATE');

-- CreateEnum
CREATE TYPE "ChecklistStatus" AS ENUM ('PENDING', 'OK', 'ISSUE');

-- AlterTable
ALTER TABLE "Customer" ADD COLUMN     "city" TEXT,
ADD COLUMN     "complement" TEXT,
ADD COLUMN     "district" TEXT,
ADD COLUMN     "number" TEXT,
ADD COLUMN     "state" TEXT,
ADD COLUMN     "street" TEXT,
ADD COLUMN     "zipCode" TEXT;

-- AlterTable
-- portalToken: adiciona nullable, preenche as ordens existentes e só então exige NOT NULL.
-- (gen_random_uuid() é nativo no Postgres 13+; 2 UUIDs v4 sem hífen = 64 hex chars.)
ALTER TABLE "ServiceOrder" ADD COLUMN     "portalToken" TEXT;
UPDATE "ServiceOrder"
   SET "portalToken" = replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '')
 WHERE "portalToken" IS NULL;
ALTER TABLE "ServiceOrder" ALTER COLUMN "portalToken" SET NOT NULL;

-- CreateTable
CREATE TABLE "ServiceOrderEvent" (
    "id" TEXT NOT NULL,
    "serviceOrderId" TEXT NOT NULL,
    "type" "EventType" NOT NULL,
    "author" "EventAuthor" NOT NULL,
    "authorUserId" TEXT,
    "authorName" TEXT,
    "body" TEXT,
    "data" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ServiceOrderEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ServiceOrderChecklistItem" (
    "id" TEXT NOT NULL,
    "serviceOrderId" TEXT NOT NULL,
    "section" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "status" "ChecklistStatus" NOT NULL DEFAULT 'PENDING',
    "note" TEXT,
    "answeredAt" TIMESTAMP(3),

    CONSTRAINT "ServiceOrderChecklistItem_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ServiceOrderEvent_serviceOrderId_createdAt_idx" ON "ServiceOrderEvent"("serviceOrderId", "createdAt");

-- CreateIndex
CREATE INDEX "ServiceOrderChecklistItem_serviceOrderId_position_idx" ON "ServiceOrderChecklistItem"("serviceOrderId", "position");

-- CreateIndex
CREATE UNIQUE INDEX "ServiceOrder_portalToken_key" ON "ServiceOrder"("portalToken");

-- AddForeignKey
ALTER TABLE "ServiceOrderEvent" ADD CONSTRAINT "ServiceOrderEvent_serviceOrderId_fkey" FOREIGN KEY ("serviceOrderId") REFERENCES "ServiceOrder"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ServiceOrderChecklistItem" ADD CONSTRAINT "ServiceOrderChecklistItem_serviceOrderId_fkey" FOREIGN KEY ("serviceOrderId") REFERENCES "ServiceOrder"("id") ON DELETE CASCADE ON UPDATE CASCADE;

