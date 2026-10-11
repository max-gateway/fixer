-- AlterTable: dados de PJ vindos da consulta de CNPJ/CCC.
ALTER TABLE "Customer"
  ADD COLUMN "tradeName" TEXT,
  ADD COLUMN "stateRegistration" TEXT,
  ADD COLUMN "stateRegistrationStatus" TEXT,
  ADD COLUMN "registryCheckedAt" TIMESTAMP(3);
