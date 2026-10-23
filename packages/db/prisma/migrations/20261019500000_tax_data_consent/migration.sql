-- Consentimento para o Fixer ler os dados de imposto na Receita (Integra Contador) com o certificado da oficina
-- (docs/specs/fiscal-autofill.md §7). Desligado até alguém marcar.
ALTER TABLE "FiscalCredential" ADD COLUMN "taxDataConsent" BOOLEAN NOT NULL DEFAULT false, ADD COLUMN "taxDataConsentAt" TIMESTAMP(3), ADD COLUMN "taxDataConsentById" TEXT;
