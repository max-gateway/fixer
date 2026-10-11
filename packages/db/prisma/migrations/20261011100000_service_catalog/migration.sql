-- CreateEnum
CREATE TYPE "ServicePricingMode" AS ENUM ('FIXED', 'HOURLY');

-- CreateEnum
CREATE TYPE "CatalogOrigin" AS ENUM ('GLOBAL', 'LOCAL');

-- CreateEnum
CREATE TYPE "ServiceAction" AS ENUM ('SUBSTITUIR', 'REVISAR', 'REGULAR', 'DIAGNOSTICAR', 'LIMPAR', 'REPARAR', 'INSTALAR', 'REMOVER');

-- CreateEnum
CREATE TYPE "VariantLevel" AS ENUM ('MAKE', 'MODEL', 'FAMILY', 'VERSION');

-- CreateEnum
CREATE TYPE "VariantResolution" AS ENUM ('FIPE', 'FAMILY', 'MODEL', 'MAKE', 'NONE');

-- CreateEnum
CREATE TYPE "EstimateSource" AS ENUM ('LEARNED', 'REFERENCE', 'MANUAL', 'NONE');

-- CreateEnum
CREATE TYPE "HoursSource" AS ENUM ('MEASURED', 'EDITED', 'ACCEPTED_DEFAULT');

-- CreateEnum
CREATE TYPE "TaxRegime" AS ENUM ('SIMPLES', 'PRESUMIDO', 'REAL');

-- AlterTable
ALTER TABLE "Vehicle" ADD COLUMN     "variantId" TEXT,
ADD COLUMN     "variantResolution" "VariantResolution";

-- AlterTable
ALTER TABLE "Part" ADD COLUMN     "cest" TEXT,
ADD COLUMN     "csosn" TEXT,
ADD COLUMN     "cst" TEXT,
ADD COLUMN     "defaultCfop" TEXT,
ADD COLUMN     "fiscalVerified" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "ncm" TEXT,
ADD COLUMN     "originCode" INTEGER,
ADD COLUMN     "unit" TEXT;

-- AlterTable
ALTER TABLE "Service" ADD COLUMN     "definitionId" TEXT,
ADD COLUMN     "fiscalProfileId" TEXT,
ADD COLUMN     "isSubcontracted" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "pricingMode" "ServicePricingMode" NOT NULL DEFAULT 'FIXED';

-- AlterTable
ALTER TABLE "ServiceOrderServiceLine" ADD COLUMN     "description" TEXT,
ADD COLUMN     "hoursActual" DECIMAL(65,30),
ADD COLUMN     "hoursActualSource" "HoursSource",
ADD COLUMN     "hoursEstimateSource" "EstimateSource",
ADD COLUMN     "hoursEstimated" DECIMAL(65,30),
ADD COLUMN     "variantId" TEXT,
ADD COLUMN     "variantResolution" "VariantResolution";

-- CreateTable
CREATE TABLE "VehicleComponent" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "parentId" TEXT,

    CONSTRAINT "VehicleComponent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ServiceFiscalProfile" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "lc116Item" TEXT NOT NULL,
    "nbs" TEXT,
    "cnae" TEXT,
    "issWithheld" BOOLEAN NOT NULL DEFAULT false,
    "verified" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "ServiceFiscalProfile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ServiceDefinition" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "action" "ServiceAction" NOT NULL,
    "componentId" TEXT NOT NULL,
    "nfseTextTemplate" TEXT,
    "fiscalProfileId" TEXT,
    "origin" "CatalogOrigin" NOT NULL DEFAULT 'GLOBAL',
    "catalogVersion" TEXT,
    "deprecatedAt" TIMESTAMP(3),

    CONSTRAINT "ServiceDefinition_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VehicleVariant" (
    "id" TEXT NOT NULL,
    "level" "VariantLevel" NOT NULL,
    "key" TEXT NOT NULL,
    "parentId" TEXT,
    "make" TEXT NOT NULL,
    "model" TEXT,
    "engine" TEXT,
    "fuel" TEXT,
    "fipeCode" TEXT,
    "origin" "CatalogOrigin" NOT NULL DEFAULT 'GLOBAL',

    CONSTRAINT "VehicleVariant_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ServiceObservation" (
    "id" TEXT NOT NULL,
    "serviceLineId" TEXT NOT NULL,
    "serviceDefinitionId" TEXT NOT NULL,
    "variantId" TEXT NOT NULL,
    "hoursActual" DECIMAL(65,30) NOT NULL,
    "weight" DECIMAL(65,30) NOT NULL DEFAULT 1,
    "observedAt" TIMESTAMP(3) NOT NULL,
    "excluded" BOOLEAN NOT NULL DEFAULT false,
    "excludedReason" TEXT,

    CONSTRAINT "ServiceObservation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ServiceEstimate" (
    "id" TEXT NOT NULL,
    "serviceDefinitionId" TEXT NOT NULL,
    "variantId" TEXT NOT NULL,
    "hoursMedian" DECIMAL(65,30) NOT NULL,
    "hoursP25" DECIMAL(65,30) NOT NULL,
    "hoursP75" DECIMAL(65,30) NOT NULL,
    "sampleCount" INTEGER NOT NULL,
    "computedAt" TIMESTAMP(3) NOT NULL,
    "inputsDigest" TEXT NOT NULL,

    CONSTRAINT "ServiceEstimate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ServiceSuggestedPart" (
    "id" TEXT NOT NULL,
    "serviceDefinitionId" TEXT NOT NULL,
    "variantKey" TEXT,
    "partCategory" TEXT NOT NULL,
    "quantity" DECIMAL(65,30) NOT NULL DEFAULT 1,
    "optional" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "ServiceSuggestedPart_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tenant_fiscal_settings" (
    "id" INTEGER NOT NULL DEFAULT 1,
    "municipalityIbge" TEXT,
    "taxRegime" "TaxRegime",
    "issRate" DECIMAL(65,30),
    "municipalServiceCode" TEXT,
    "hourlyRate" DECIMAL(65,30),

    CONSTRAINT "tenant_fiscal_settings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "catalog_state" (
    "id" INTEGER NOT NULL DEFAULT 1,
    "version" TEXT NOT NULL,
    "appliedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "catalog_state_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "VehicleComponent_code_key" ON "VehicleComponent"("code");

-- CreateIndex
CREATE UNIQUE INDEX "ServiceFiscalProfile_code_key" ON "ServiceFiscalProfile"("code");

-- CreateIndex
CREATE UNIQUE INDEX "ServiceDefinition_code_key" ON "ServiceDefinition"("code");

-- CreateIndex
CREATE UNIQUE INDEX "ServiceDefinition_action_componentId_key" ON "ServiceDefinition"("action", "componentId");

-- CreateIndex
CREATE UNIQUE INDEX "VehicleVariant_key_key" ON "VehicleVariant"("key");

-- CreateIndex
CREATE INDEX "VehicleVariant_parentId_idx" ON "VehicleVariant"("parentId");

-- CreateIndex
CREATE UNIQUE INDEX "ServiceObservation_serviceLineId_key" ON "ServiceObservation"("serviceLineId");

-- CreateIndex
CREATE INDEX "ServiceObservation_serviceDefinitionId_variantId_idx" ON "ServiceObservation"("serviceDefinitionId", "variantId");

-- CreateIndex
CREATE UNIQUE INDEX "ServiceEstimate_serviceDefinitionId_variantId_key" ON "ServiceEstimate"("serviceDefinitionId", "variantId");

-- CreateIndex
CREATE UNIQUE INDEX "ServiceSuggestedPart_serviceDefinitionId_variantKey_partCat_key" ON "ServiceSuggestedPart"("serviceDefinitionId", "variantKey", "partCategory");

-- AddForeignKey
ALTER TABLE "Vehicle" ADD CONSTRAINT "Vehicle_variantId_fkey" FOREIGN KEY ("variantId") REFERENCES "VehicleVariant"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Service" ADD CONSTRAINT "Service_definitionId_fkey" FOREIGN KEY ("definitionId") REFERENCES "ServiceDefinition"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Service" ADD CONSTRAINT "Service_fiscalProfileId_fkey" FOREIGN KEY ("fiscalProfileId") REFERENCES "ServiceFiscalProfile"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VehicleComponent" ADD CONSTRAINT "VehicleComponent_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "VehicleComponent"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ServiceDefinition" ADD CONSTRAINT "ServiceDefinition_componentId_fkey" FOREIGN KEY ("componentId") REFERENCES "VehicleComponent"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ServiceDefinition" ADD CONSTRAINT "ServiceDefinition_fiscalProfileId_fkey" FOREIGN KEY ("fiscalProfileId") REFERENCES "ServiceFiscalProfile"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VehicleVariant" ADD CONSTRAINT "VehicleVariant_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "VehicleVariant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ServiceObservation" ADD CONSTRAINT "ServiceObservation_serviceLineId_fkey" FOREIGN KEY ("serviceLineId") REFERENCES "ServiceOrderServiceLine"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ServiceObservation" ADD CONSTRAINT "ServiceObservation_serviceDefinitionId_fkey" FOREIGN KEY ("serviceDefinitionId") REFERENCES "ServiceDefinition"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ServiceObservation" ADD CONSTRAINT "ServiceObservation_variantId_fkey" FOREIGN KEY ("variantId") REFERENCES "VehicleVariant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ServiceEstimate" ADD CONSTRAINT "ServiceEstimate_serviceDefinitionId_fkey" FOREIGN KEY ("serviceDefinitionId") REFERENCES "ServiceDefinition"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ServiceEstimate" ADD CONSTRAINT "ServiceEstimate_variantId_fkey" FOREIGN KEY ("variantId") REFERENCES "VehicleVariant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ServiceSuggestedPart" ADD CONSTRAINT "ServiceSuggestedPart_serviceDefinitionId_fkey" FOREIGN KEY ("serviceDefinitionId") REFERENCES "ServiceDefinition"("id") ON DELETE CASCADE ON UPDATE CASCADE;

