import type { FiscalProfileEntry } from '../src/types.js';

// Defaults de partida (docs/specs/service-catalog.md §4.3.1), vindos de fontes secundárias:
// verified=false até um contador confirmar. A emissão exige verified=true.
export const fiscalProfiles: FiscalProfileEntry[] = [
  {
    code: 'LC116_14_01',
    lc116Item: '14.01',
    nbs: '1.2001.31.00', // manutenção e reparação de veículos automotores rodoviários
    issWithheld: false,
    verified: false,
  },
];
