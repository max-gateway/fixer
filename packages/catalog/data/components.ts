import type { ComponentEntry } from '../src/types.js';

export const components: ComponentEntry[] = [
  { code: 'TRANSMISSAO', name: 'Transmissão' },
  { code: 'EMBREAGEM', name: 'Embreagem', parentCode: 'TRANSMISSAO' },
  { code: 'EMBREAGEM_KIT', name: 'Kit de embreagem', parentCode: 'EMBREAGEM' },
  { code: 'EMBREAGEM_ATUADOR', name: 'Atuador de embreagem', parentCode: 'EMBREAGEM' },
  { code: 'EMBREAGEM_VOLANTE_BIMASSA', name: 'Volante bimassa', parentCode: 'EMBREAGEM' },
];
