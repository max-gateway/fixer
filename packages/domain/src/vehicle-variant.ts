// Resolução do veículo para a hierarquia MAKE > MODEL > FAMILY > VERSION (spec §4.4).
// Função pura e determinística: o mesmo JSON do plate-lookup sempre gera as mesmas chaves.

export type VariantLevel = 'MAKE' | 'MODEL' | 'FAMILY' | 'VERSION';
export type VariantResolution = 'FIPE' | 'FAMILY' | 'MODEL' | 'MAKE' | 'NONE';

export interface VariantNode {
  level: VariantLevel;
  key: string;
  parentKey: string | null;
  make: string;
  model?: string;
  engine?: string;
  fuel?: string;
  fipeCode?: string;
}

export interface VariantChain {
  resolution: VariantResolution;
  chain: VariantNode[]; // do mais genérico (MAKE) ao mais específico
}

export interface ResolveOptions {
  /** Modelos de mais de uma palavra ("grand siena"), já normalizados com normalizeSlug. */
  multiWordModels?: string[];
}

// Subconjunto tolerante do payload da Puxa Placa; números podem vir como string.
interface LookupLike {
  basico?: {
    dados?: {
      marca?: string | null;
      modelo?: string | null;
      cilindradas?: number | string | null;
      combustivel?: string | null;
      anoModelo?: number | string | null;
    } | null;
  } | null;
  fipe?: { dados?: Array<{ codigo_fipe?: string | null }> | null } | null;
}

export function normalizeSlug(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9.]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function modelSlug(raw: string, multiWord: string[]): string {
  const full = normalizeSlug(raw);
  const known = multiWord
    .map((m) => normalizeSlug(m))
    .sort((a, b) => b.length - a.length)
    .find((m) => full === m || full.startsWith(`${m}-`));
  return known ?? full.split('-')[0];
}

function engineLiters(cc: unknown): string | null {
  const n = typeof cc === 'string' ? Number(cc) : cc;
  if (typeof n !== 'number' || !Number.isFinite(n) || n <= 0) return null;
  return (Math.round(n / 100) / 10).toFixed(1);
}

function fuelSlug(raw: string): string | null {
  const s = normalizeSlug(raw);
  if (!s) return null;
  const hasEthanol = /alcool|etanol/.test(s);
  if (s.includes('flex') || (hasEthanol && s.includes('gasolina'))) return 'flex';
  return s;
}

export function resolveVariantChain(lookup: LookupLike, options: ResolveOptions = {}): VariantChain {
  const dados = lookup.basico?.dados;
  const makeName = dados?.marca?.trim();
  if (!makeName) return { resolution: 'NONE', chain: [] };

  const make = normalizeSlug(makeName);
  const chain: VariantNode[] = [{ level: 'MAKE', key: make, parentKey: null, make }];
  let resolution: VariantResolution = 'MAKE';

  const modelRaw = dados?.modelo?.trim();
  if (!modelRaw) return { resolution, chain };
  const model = modelSlug(modelRaw, options.multiWordModels ?? []);
  const modelKey = `${make}/${model}`;
  chain.push({ level: 'MODEL', key: modelKey, parentKey: make, make, model });
  resolution = 'MODEL';

  const engine = engineLiters(dados?.cilindradas);
  const fuel = dados?.combustivel ? fuelSlug(dados.combustivel) : null;
  if (!engine || !fuel) return { resolution, chain };
  const familyKey = `${modelKey}/${engine}/${fuel}`;
  chain.push({ level: 'FAMILY', key: familyKey, parentKey: modelKey, make, model, engine, fuel });
  resolution = 'FAMILY';

  const fipeCode = lookup.fipe?.dados?.find((d) => d.codigo_fipe?.trim())?.codigo_fipe?.trim();
  if (!fipeCode) return { resolution, chain };
  chain.push({
    level: 'VERSION',
    key: `fipe:${fipeCode}`,
    parentKey: familyKey,
    make,
    model,
    engine,
    fuel,
    fipeCode,
  });
  return { resolution: 'FIPE', chain };
}
