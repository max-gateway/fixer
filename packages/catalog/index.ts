import { components } from './data/components.js';
import { fiscalProfiles } from './data/fiscal-profiles.js';
import { definitions } from './data/service-definitions.js';
import { suggestedParts } from './data/suggested-parts.js';
import { multiWordModels, variants } from './data/variants.js';
import type { Catalog } from './src/types.js';

/** Versão do conteúdo do catálogo; incremente a cada mudança nos arquivos de data/. */
export const CATALOG_VERSION = '0.1.0';

export const catalog: Catalog = {
  version: CATALOG_VERSION,
  components,
  fiscalProfiles,
  definitions,
  variants,
  suggestedParts,
  multiWordModels,
};

export { applyCatalog, type CatalogDb } from './src/apply.js';
export { validateCatalog } from './src/validate.js';
export type * from './src/types.js';
