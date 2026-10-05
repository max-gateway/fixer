-- CreateTable
CREATE TABLE "PlateLookup" (
    "id" TEXT NOT NULL,
    "plate" TEXT NOT NULL,
    "rawResponse" JSONB NOT NULL,
    "brand" TEXT,
    "model" TEXT,
    "year" INTEGER,
    "queriedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PlateLookup_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PlateLookup_plate_key" ON "PlateLookup"("plate");
