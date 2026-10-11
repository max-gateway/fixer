import type { VariantEntry } from '../src/types.js';

const make = (key: string): VariantEntry => ({ level: 'MAKE', key, make: key });
const model = (makeKey: string, name: string): VariantEntry => ({
  level: 'MODEL',
  key: `${makeKey}/${name}`,
  parentKey: makeKey,
  make: makeKey,
  model: name,
});

// Só MAKE e MODEL; FAMILY e VERSION nascem localmente a partir do plate-lookup (spec §14, decisão 5).
export const variants: VariantEntry[] = [
  make('fiat'),
  make('volkswagen'),
  make('chevrolet'),
  make('hyundai'),
  make('toyota'),
  model('fiat', 'palio'),
  model('fiat', 'uno'),
  model('fiat', 'strada'),
  model('volkswagen', 'gol'),
  model('chevrolet', 'onix'),
  model('hyundai', 'hb20'),
  model('toyota', 'hilux'),
];

export const multiWordModels = ['grand siena', 'santa fe', 'land cruiser'];
