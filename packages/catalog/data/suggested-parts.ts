import type { SuggestedPartEntry } from '../src/types.js';

const D = 'SUBSTITUIR:EMBREAGEM_KIT';

export const suggestedParts: SuggestedPartEntry[] = [
  { definitionCode: D, partCategory: 'DISCO_EMBREAGEM', quantity: 1, optional: false },
  { definitionCode: D, partCategory: 'PLATO_EMBREAGEM', quantity: 1, optional: false },
  { definitionCode: D, partCategory: 'ROLAMENTO_EMBREAGEM', quantity: 1, optional: false },
  { definitionCode: D, partCategory: 'ATUADOR_EMBREAGEM', quantity: 1, optional: true },
  { definitionCode: D, partCategory: 'FLUIDO_FREIO_DOT4', quantity: 1, optional: true },
];
