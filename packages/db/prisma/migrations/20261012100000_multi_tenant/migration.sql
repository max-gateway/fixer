-- Multi-tenant: um banco compartilhado, isolamento por organização com Row Level Security.
-- Spec: docs/specs/multi-tenancy.md
--
-- Instâncias que já existem (um banco = uma oficina) são migradas no lugar: todas as linhas recebem a organização
-- "legada". Para já usar o id da organização no control plane, rode a migração com
--   PGOPTIONS="-c fixer.legacy_org_id=<uuid>"   (ou ?options=-c%20fixer.legacy_org_id%3D<uuid> na DATABASE_URL).
-- Sem isso vale 00000000-0000-0000-0000-000000000001, e um UPDATE posterior pode trocar o id (ver o spec).
--
-- Esta migração precisa rodar com um papel que ignora RLS (dono/superusuário): ela mexe nos dados antes de ligar as políticas.

-- Organização da sessão: a API faz `SELECT set_config('app.org_id', <uuid>, true)` no início de cada transação.
-- Sem organização a função devolve NULL e as políticas não enxergam linha nenhuma (falha fechada).
CREATE FUNCTION app_org() RETURNS uuid
  LANGUAGE sql STABLE
  AS $$ SELECT nullif(current_setting('app.org_id', true), '')::uuid $$;

-- Contadores por organização (numeração sequencial das ordens de serviço sem um sequence global).
CREATE TABLE "OrgCounter" (
  "orgId" UUID NOT NULL DEFAULT app_org(),
  "name" TEXT NOT NULL,
  "value" INTEGER NOT NULL,
  CONSTRAINT "OrgCounter_pkey" PRIMARY KEY ("orgId", "name")
);

-- Próximo valor do contador da organização da sessão. A linha do contador serializa criadores concorrentes da mesma
-- organização até o fim da transação (sem buracos na numeração, ao contrário de um sequence).
CREATE FUNCTION next_org_seq(p_name text) RETURNS integer
  LANGUAGE sql
  AS $$
    INSERT INTO "OrgCounter" ("orgId", "name", "value") VALUES (app_org(), p_name, 1)
    ON CONFLICT ("orgId", "name") DO UPDATE SET "value" = "OrgCounter"."value" + 1
    RETURNING "value"
  $$;

DO $$
DECLARE
  legacy uuid := COALESCE(nullif(current_setting('fixer.legacy_org_id', true), '')::uuid, '00000000-0000-0000-0000-000000000001'::uuid);
  t text;
BEGIN
  -- 1. Tabelas de dados da oficina: coluna orgId, backfill, índice e RLS.
  FOREACH t IN ARRAY ARRAY[
    'User', 'Role', 'RolePermission', 'UserRole', 'Customer', 'Vehicle', 'VehicleOwner', 'Part', 'Service',
    'ServiceOrder', 'ServiceOrderPartLine', 'ServiceOrderServiceLine', 'ServiceOrderStatusLog', 'ServiceOrderEvent',
    'ServiceOrderChecklistItem', 'StockMovement', 'ProcessedInboundEvent', 'OutboxEvent', 'ServiceObservation',
    'ServiceEstimate', 'FiscalAuditLog', 'PurchaseInvoice', 'PurchaseInvoiceItem', 'SupplierItemMap'
  ] LOOP
    EXECUTE format('ALTER TABLE %I ADD COLUMN "orgId" UUID', t);
    EXECUTE format('UPDATE %I SET "orgId" = %L', t, legacy);
    EXECUTE format('ALTER TABLE %I ALTER COLUMN "orgId" SET NOT NULL, ALTER COLUMN "orgId" SET DEFAULT app_org()', t);
    EXECUTE format('CREATE INDEX %I ON %I ("orgId")', t || '_orgId_idx', t);
  END LOOP;

  -- 2. Singletons por oficina: a chave primária passa de id=1 para orgId.
  ALTER TABLE "FiscalSyncState" DROP CONSTRAINT "FiscalSyncState_id_fkey";
  FOREACH t IN ARRAY ARRAY['tenant_fiscal_settings', 'FiscalCredential', 'FiscalSyncState'] LOOP
    EXECUTE format('ALTER TABLE %I ADD COLUMN "orgId" UUID', t);
    EXECUTE format('UPDATE %I SET "orgId" = %L', t, legacy);
    EXECUTE format('ALTER TABLE %I DROP CONSTRAINT %I', t, t || '_pkey');
    EXECUTE format('ALTER TABLE %I DROP COLUMN "id"', t);
    EXECUTE format('ALTER TABLE %I ALTER COLUMN "orgId" SET NOT NULL, ALTER COLUMN "orgId" SET DEFAULT app_org()', t);
    EXECUTE format('ALTER TABLE %I ADD CONSTRAINT %I PRIMARY KEY ("orgId")', t, t || '_pkey');
  END LOOP;
  ALTER TABLE "FiscalSyncState"
    ADD CONSTRAINT "FiscalSyncState_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "FiscalCredential"("orgId") ON DELETE CASCADE ON UPDATE CASCADE;

  -- 3. Contador das ordens de serviço continua de onde parou em cada organização.
  INSERT INTO "OrgCounter" ("orgId", "name", "value")
    SELECT "orgId", 'service_order', max("number") FROM "ServiceOrder" GROUP BY "orgId";

  -- 4. RLS em todas as tabelas de oficina. FORCE: vale também para o dono da tabela (só BYPASSRLS/superusuário escapam).
  FOREACH t IN ARRAY ARRAY[
    'User', 'Role', 'RolePermission', 'UserRole', 'Customer', 'Vehicle', 'VehicleOwner', 'Part', 'Service',
    'ServiceOrder', 'ServiceOrderPartLine', 'ServiceOrderServiceLine', 'ServiceOrderStatusLog', 'ServiceOrderEvent',
    'ServiceOrderChecklistItem', 'StockMovement', 'ProcessedInboundEvent', 'OutboxEvent', 'ServiceObservation',
    'ServiceEstimate', 'FiscalAuditLog', 'PurchaseInvoice', 'PurchaseInvoiceItem', 'SupplierItemMap',
    'tenant_fiscal_settings', 'FiscalCredential', 'FiscalSyncState', 'OrgCounter'
  ] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY tenant_isolation ON %I USING ("orgId" = app_org()) WITH CHECK ("orgId" = app_org())', t);
  END LOOP;
END $$;

-- Numeração por organização no lugar do sequence global.
ALTER TABLE "ServiceOrder" ALTER COLUMN "number" SET DEFAULT next_org_seq('service_order');
DROP SEQUENCE "ServiceOrder_number_seq";

-- Unicidades que eram globais passam a valer dentro da organização.
DROP INDEX "Customer_document_key";
DROP INDEX "Part_sku_key";
DROP INDEX "PurchaseInvoice_accessKey_key";
DROP INDEX "Role_name_key";
DROP INDEX "Service_name_key";
DROP INDEX "ServiceEstimate_serviceDefinitionId_variantId_key";
DROP INDEX "ServiceOrder_number_key";
DROP INDEX "SupplierItemMap_supplierCnpj_supplierCode_key";
DROP INDEX "User_email_key";
DROP INDEX "User_keycloakId_key";
DROP INDEX "Vehicle_plate_key";

CREATE UNIQUE INDEX "Customer_orgId_document_key" ON "Customer"("orgId", "document");
CREATE UNIQUE INDEX "Part_orgId_sku_key" ON "Part"("orgId", "sku");
CREATE UNIQUE INDEX "PurchaseInvoice_orgId_accessKey_key" ON "PurchaseInvoice"("orgId", "accessKey");
CREATE UNIQUE INDEX "Role_orgId_name_key" ON "Role"("orgId", "name");
CREATE UNIQUE INDEX "Service_orgId_name_key" ON "Service"("orgId", "name");
CREATE UNIQUE INDEX "ServiceEstimate_orgId_serviceDefinitionId_variantId_key" ON "ServiceEstimate"("orgId", "serviceDefinitionId", "variantId");
CREATE UNIQUE INDEX "ServiceOrder_orgId_number_key" ON "ServiceOrder"("orgId", "number");
CREATE UNIQUE INDEX "SupplierItemMap_orgId_supplierCnpj_supplierCode_key" ON "SupplierItemMap"("orgId", "supplierCnpj", "supplierCode");
CREATE UNIQUE INDEX "User_orgId_email_key" ON "User"("orgId", "email");
CREATE UNIQUE INDEX "User_orgId_keycloakId_key" ON "User"("orgId", "keycloakId");
CREATE UNIQUE INDEX "Vehicle_orgId_plate_key" ON "Vehicle"("orgId", "plate");
