-- AlterEnum
ALTER TYPE "EventType" ADD VALUE 'WHATSAPP_LINK';

-- AlterTable
-- linkCode: adiciona nullable, preenche as ordens existentes (um código por linha) e só então exige NOT NULL.
ALTER TABLE "ServiceOrder" ADD COLUMN     "linkCode" TEXT,
ADD COLUMN     "whatsappLinkedAt" TIMESTAMP(3),
ADD COLUMN     "whatsappLinkedPhone" TEXT;

-- Formato OS-XXXX-XXXX, alfabeto Crockford base32 (sem I, L, O, U). Contrato com apps/api e apps/whatsapp.
DO $$
DECLARE
  alphabet CONSTANT TEXT := '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
  r RECORD;
  code TEXT;
BEGIN
  FOR r IN SELECT "id" FROM "ServiceOrder" WHERE "linkCode" IS NULL LOOP
    LOOP
      code := 'OS-';
      FOR i IN 1..8 LOOP
        code := code || substr(alphabet, 1 + floor(random() * 32)::int, 1);
        IF i = 4 THEN code := code || '-'; END IF;
      END LOOP;
      EXIT WHEN NOT EXISTS (SELECT 1 FROM "ServiceOrder" WHERE "linkCode" = code);
    END LOOP;
    UPDATE "ServiceOrder" SET "linkCode" = code WHERE "id" = r."id";
  END LOOP;
END $$;

ALTER TABLE "ServiceOrder" ALTER COLUMN "linkCode" SET NOT NULL;

-- CreateIndex
CREATE UNIQUE INDEX "ServiceOrder_linkCode_key" ON "ServiceOrder"("linkCode");

-- CreateTable
CREATE TABLE "ProcessedInboundEvent" (
    "id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "processedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProcessedInboundEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ProcessedInboundEvent_processedAt_idx" ON "ProcessedInboundEvent"("processedAt");
