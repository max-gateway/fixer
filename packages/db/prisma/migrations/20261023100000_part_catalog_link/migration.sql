-- Vínculo da peça da oficina com o catálogo global da plataforma (docs/specs/parts-search-integration.md §9, fase M).
-- `catalogSku` aponta o cadastro global (parts-search); NULL = peça que o catálogo ainda não tem (rotulada na tela). Aditiva: nada é removido.
CREATE TYPE "CatalogLinkSource" AS ENUM ('EAN', 'MANUAL', 'CREATED_FROM_CATALOG');

ALTER TABLE "Part"
  ADD COLUMN "catalogSku" TEXT,
  ADD COLUMN "catalogLinkedAt" TIMESTAMP(3),
  ADD COLUMN "catalogLinkSource" "CatalogLinkSource";

-- Uma peça da oficina por peça do catálogo (vários NULL são permitidos: peças só da oficina).
CREATE UNIQUE INDEX "Part_orgId_catalogSku_key" ON "Part"("orgId", "catalogSku");

-- Os três campos do vínculo andam juntos: ou a peça está vinculada (com quando e como), ou não está.
ALTER TABLE "Part" ADD CONSTRAINT "Part_catalog_link_coherent" CHECK (
  ("catalogSku" IS NULL AND "catalogLinkedAt" IS NULL AND "catalogLinkSource" IS NULL)
  OR ("catalogSku" IS NOT NULL AND "catalogLinkedAt" IS NOT NULL AND "catalogLinkSource" IS NOT NULL)
);
