// Busca de peças no catálogo global (parts-search): tipos como a API do Fixer os devolve e a lógica pura da tela (estado na URL, cross-references, aplicações).

export type Brand = { key: string; name: string };
export type Category = { id: string; name: string };

/** Posição física na loja (`Location` do contrato da plataforma). Todos os campos são opcionais, mas pelo menos um vem preenchido. */
export type Location = { depot?: string; path?: string; floor?: string; room?: string; row?: string; shelf?: string; level?: string; box?: string };

/** Oferta DA LOJA na plataforma. O Fixer não publica ofertas: quase sempre ausente; o estoque da oficina vem de `workshop`. */
export type Offer = {
  storeId: string;
  /** Nulo = oferta sem preço (ainda não vendável). */
  priceCents: number | null;
  currency: 'BRL';
  quantityAvailable: number;
  locations: Location[];
  version: number;
};

/** A peça da oficina que representa uma peça do catálogo: saldo e preço de venda (sem custo). */
export type WorkshopStock = { catalogSku: string; partId: string; sku: string; stockQty: number; sellPrice: number };

/** Uma peça na lista de resultados. */
export type PartHit = {
  sku: string;
  slug?: string;
  name: string;
  titleText?: string;
  subtitle?: string;
  label: string;
  partNumber: string;
  brand?: Brand;
  category?: Category;
  imageUrl?: string;
  isUniversalFit: boolean;
  relevanceScore: number;
  offer?: Offer;
  /** Só no modo "Minha oficina", que já parte do estoque; na busca do catálogo vem de `useWorkshopStock`. */
  workshop?: WorkshopStock;
};

export type Facets = {
  brands: (Brand & { count: number })[];
  categories: (Category & { count: number })[];
};

export type SearchResult = {
  data: PartHit[];
  page: number;
  limit: number;
  total: number;
  totalPages: number;
  truncated: boolean;
  facets: Facets;
};

export type Suggestion = {
  sku: string;
  label: string;
  partNumber: string;
  brand?: string;
  applicationsSummary?: string[];
  compatibleWithVehicle?: boolean;
};

export type Application = {
  vehicleId: string;
  make: string;
  model: string;
  yearFrom?: number;
  yearTo?: number;
  engine?: string;
  vehicleName: string;
  position?: string;
};

/** Cadastro completo da peça (`GET /catalog/parts/:sku`). */
export type PartDetail = {
  sku: string;
  name: string;
  titleText?: string;
  subtitle?: string;
  partNumber: string;
  oemCodes: string[];
  barcodes: string[];
  titleSynonyms: string[];
  brand?: Brand;
  category?: Category & { path: Category[] };
  catalogAttributes: { name: string; value: string }[];
  isUniversalFit: boolean;
  imageUrl?: string;
  crossPairs: string[];
  applications: Application[];
  active: boolean;
};

export type VehicleFilter = { id?: string; make?: string; model?: string; label: string };

/** Estado da busca: tudo o que a URL guarda, para a busca ser compartilhável e sobreviver a recarregar. */
export type SearchState = {
  q: string;
  page: number;
  brands: string[];
  categories: string[];
  vehicle?: VehicleFilter;
  /** Peça aberta na gaveta. */
  sku?: string;
  /** "Minha oficina": só as peças do catálogo que a oficina já cadastrou. */
  mine?: boolean;
  /** Só com saldo. Vale no modo "Minha oficina". */
  inStock?: boolean;
};

export const PAGE_SIZE = 24;
/** A plataforma só ranqueia as 300 primeiras; a tela avisa quando há mais. */
export const RANK_WINDOW = 300;

export const EMPTY_STATE: SearchState = { q: '', page: 1, brands: [], categories: [] };

export type QueryKind = 'empty' | 'gtin' | 'code' | 'text';

/** O que a pessoa digitou: GTIN (8–14 dígitos), código de peça (uma palavra com número) ou texto livre. */
export function queryKind(raw: string): QueryKind {
  const q = raw.trim();
  if (!q) return 'empty';
  if (/^\d{8,14}$/.test(q)) return 'gtin';
  if (!/\s/.test(q) && /\d/.test(q) && q.length >= 3) return 'code';
  return 'text';
}

export const KIND_LABEL: Record<Exclude<QueryKind, 'empty'>, string> = { gtin: 'Código de barras', code: 'Código da peça', text: 'Texto' };

/** Há algo para buscar? Texto ou veículo (a lista por veículo não precisa de texto). */
export function isSearchable(s: Pick<SearchState, 'q' | 'vehicle' | 'mine'>): boolean {
  return Boolean(s.mine) || s.q.trim().length >= 2 || Boolean(s.vehicle);
}

export function parseState(params: URLSearchParams): SearchState {
  const page = Number(params.get('p'));
  const vm = params.get('vm') || undefined;
  const vmod = params.get('vmod') || undefined;
  const vid = params.get('vid') || undefined;
  const vl = params.get('vl') || undefined;
  const vehicle: VehicleFilter | undefined =
    vid || vm || vmod ? { ...(vid ? { id: vid } : {}), ...(vm ? { make: vm } : {}), ...(vmod ? { model: vmod } : {}), label: vl ?? [vm, vmod].filter(Boolean).join(' ') } : undefined;
  return {
    q: params.get('q') ?? '',
    page: Number.isInteger(page) && page >= 1 ? page : 1,
    brands: params.getAll('marca'),
    categories: params.getAll('cat'),
    ...(vehicle ? { vehicle } : {}),
    ...(params.get('sku') ? { sku: params.get('sku')! } : {}),
    ...(params.get('m') === '1' ? { mine: true } : {}),
    ...(params.get('m') === '1' && params.get('est') === '1' ? { inStock: true } : {}),
  };
}

/** Parâmetros da URL da página (curtos e legíveis). */
export function toPageParams(s: SearchState): URLSearchParams {
  const p = new URLSearchParams();
  if (s.q.trim()) p.set('q', s.q.trim());
  if (s.page > 1) p.set('p', String(s.page));
  s.brands.forEach((b) => p.append('marca', b));
  s.categories.forEach((c) => p.append('cat', c));
  if (s.vehicle?.id) p.set('vid', s.vehicle.id);
  if (s.vehicle?.make) p.set('vm', s.vehicle.make);
  if (s.vehicle?.model) p.set('vmod', s.vehicle.model);
  if (s.vehicle) p.set('vl', s.vehicle.label);
  if (s.sku) p.set('sku', s.sku);
  if (s.mine) p.set('m', '1');
  if (s.mine && s.inStock) p.set('est', '1');
  return p;
}

/** Rota da API do Fixer para a busca. Com veículo e sem texto vale a lista por veículo (a busca exige texto). */
export function searchUrl(s: SearchState, limit = PAGE_SIZE): string {
  const p = new URLSearchParams();
  p.set('page', String(s.page));
  p.set('limit', String(limit));
  const text = s.q.trim();
  if (s.mine) {
    if (text) p.set('q', text);
    if (s.inStock) p.set('inStock', 'true');
    return `/api/catalog/workshop/parts?${p}`;
  }
  if (!text && s.vehicle) {
    if (s.vehicle.id) p.set('vehicleId', s.vehicle.id);
    else {
      if (s.vehicle.make) p.set('make', s.vehicle.make);
      if (s.vehicle.model) p.set('model', s.vehicle.model);
    }
    return `/api/catalog/vehicle-parts?${p}`;
  }
  p.set('q', text);
  s.brands.forEach((b) => p.append('brandKey', b));
  s.categories.forEach((c) => p.append('categoryId', c));
  if (s.vehicle?.id) p.set('vehicleId', s.vehicle.id);
  return `/api/catalog/parts/search?${p}`;
}

/** A lista por veículo não devolve facetas: normaliza para o mesmo formato da busca. */
export function normalizeResult(raw: Partial<SearchResult> & { data: PartHit[] }): SearchResult {
  return {
    data: raw.data,
    page: raw.page ?? 1,
    limit: raw.limit ?? PAGE_SIZE,
    total: raw.total ?? raw.data.length,
    totalPages: raw.totalPages ?? 1,
    truncated: raw.truncated ?? false,
    facets: { brands: raw.facets?.brands ?? [], categories: raw.facets?.categories ?? [] },
  };
}

/** Filtros ativos como chips removíveis, com o nome legível (não a chave). */
export type ActiveFilter = { kind: 'brand' | 'category' | 'vehicle' | 'stock'; value: string; label: string };

export function activeFilters(s: SearchState, facets?: Facets): ActiveFilter[] {
  const brandName = (k: string) => facets?.brands.find((b) => b.key === k)?.name ?? k;
  const catName = (id: string) => facets?.categories.find((c) => c.id === id)?.name ?? id;
  return [
    ...(s.mine && s.inStock ? [{ kind: 'stock' as const, value: 'inStock', label: 'Com saldo' }] : []),
    ...(s.vehicle ? [{ kind: 'vehicle' as const, value: s.vehicle.id ?? s.vehicle.label, label: s.vehicle.label }] : []),
    ...s.brands.map((v) => ({ kind: 'brand' as const, value: v, label: brandName(v) })),
    ...s.categories.map((v) => ({ kind: 'category' as const, value: v, label: catName(v) })),
  ];
}

export function toggle<T>(list: T[], value: T): T[] {
  return list.includes(value) ? list.filter((v) => v !== value) : [...list, value];
}

// --- cross-reference -------------------------------------------------------------------------------------------------

export type CrossGroup = { brand: string; codes: string[] };

/** "MARCA:CODIGO" (o primeiro ":" separa a marca) agrupado por marca, sem repetição e sem o próprio código da peça. */
export function groupCrossPairs(pairs: string[], own?: { partNumber: string; brand?: string }): CrossGroup[] {
  const key = (s: string) => s.replace(/[\s.\-/]/g, '').toUpperCase();
  const ownKey = own ? key(own.partNumber) : '';
  const ownBrand = own?.brand?.toUpperCase();
  const map = new Map<string, Set<string>>();
  for (const pair of pairs) {
    const i = pair.indexOf(':');
    const brand = (i > 0 ? pair.slice(0, i) : '—').trim().toUpperCase();
    const code = (i > 0 ? pair.slice(i + 1) : pair).trim();
    if (!code) continue;
    if (key(code) === ownKey && (!ownBrand || brand === ownBrand || brand === '—')) continue;
    (map.get(brand) ?? map.set(brand, new Set()).get(brand)!).add(code);
  }
  return [...map.entries()]
    .map(([brand, codes]) => ({ brand, codes: [...codes].sort((a, b) => a.localeCompare(b, 'pt-BR', { numeric: true })) }))
    .sort((a, b) => b.codes.length - a.codes.length || a.brand.localeCompare(b.brand, 'pt-BR'));
}

// --- compatibilidade -------------------------------------------------------------------------------------------------

export function yearRange(from?: number, to?: number): string {
  if (from && to) return from === to ? String(from) : `${from}–${to}`;
  if (from) return `${from}→`;
  if (to) return `até ${to}`;
  return 'todos os anos';
}

export type FitModel = { model: string; items: Application[]; yearFrom?: number; yearTo?: number };
export type FitMake = { make: string; count: number; models: FitModel[] };

const norm = (s: string) => s.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase();

/** Aplicações agrupadas por montadora e modelo, já filtradas pelo texto (marca, modelo, motor, ano ou nome do veículo). */
export function groupApplications(apps: Application[], filter = ''): FitMake[] {
  const terms = norm(filter).split(/\s+/).filter(Boolean);
  const matches = (a: Application) => {
    if (terms.length === 0) return true;
    const hay = norm(`${a.vehicleName} ${a.make} ${a.model} ${a.engine ?? ''} ${a.position ?? ''} ${yearRange(a.yearFrom, a.yearTo)}`);
    const years = [a.yearFrom, a.yearTo].filter((y): y is number => typeof y === 'number');
    return terms.every((t) => hay.includes(t) || (/^\d{4}$/.test(t) && years.length > 0 && Number(t) >= (a.yearFrom ?? years[0]!) && Number(t) <= (a.yearTo ?? a.yearFrom ?? 9999)));
  };
  const makes = new Map<string, Map<string, Application[]>>();
  for (const a of apps.filter(matches)) {
    const models = makes.get(a.make) ?? makes.set(a.make, new Map()).get(a.make)!;
    (models.get(a.model) ?? models.set(a.model, []).get(a.model)!).push(a);
  }
  return [...makes.entries()]
    .map(([make, models]) => ({
      make,
      count: [...models.values()].reduce((n, l) => n + l.length, 0),
      models: [...models.entries()]
        .map(([model, items]) => {
          const from = items.map((i) => i.yearFrom).filter((y): y is number => y !== undefined);
          const to = items.map((i) => i.yearTo ?? i.yearFrom).filter((y): y is number => y !== undefined);
          return {
            model,
            items: [...items].sort((a, b) => (a.yearFrom ?? 0) - (b.yearFrom ?? 0) || a.vehicleName.localeCompare(b.vehicleName, 'pt-BR')),
            ...(from.length ? { yearFrom: Math.min(...from) } : {}),
            ...(to.length ? { yearTo: Math.max(...to) } : {}),
          };
        })
        .sort((a, b) => a.model.localeCompare(b.model, 'pt-BR')),
    }))
    .sort((a, b) => b.count - a.count || a.make.localeCompare(b.make, 'pt-BR'));
}

// --- texto -----------------------------------------------------------------------------------------------------------

export type Segment = { text: string; hit: boolean };

/** Parte o texto em trechos, marcando os que casam com algum termo da busca (sem acento e sem caixa). */
export function highlight(text: string, query: string): Segment[] {
  const terms = norm(query).split(/\s+/).filter((t) => t.length >= 2);
  if (terms.length === 0 || !text) return [{ text, hit: false }];
  // Cada caractere acentuado do português vira um só caractere base: os índices do texto normalizado servem ao original.
  const flat = [...text].map((ch) => norm(ch)[0] ?? ch.toLowerCase()).join('');
  if (flat.length !== text.length) return [{ text, hit: false }];
  const mark = new Array<boolean>(text.length).fill(false);
  for (const t of terms) {
    for (let i = flat.indexOf(t); i !== -1; i = flat.indexOf(t, i + 1)) mark.fill(true, i, i + t.length);
  }
  const out: Segment[] = [];
  for (let i = 0; i < text.length; i++) {
    const last = out[out.length - 1];
    if (last && last.hit === mark[i]) last.text += text[i];
    else out.push({ text: text[i]!, hit: mark[i]! });
  }
  return out;
}

const brl = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
export const formatCents = (cents: number) => brl.format(cents / 100);
export const formatMoney = (value: number | string) => brl.format(Number(value));

/** Primeira posição da oferta, do mais geral ao mais específico ("Depósito · Corredor · Prateleira · Nível · Caixa"); `null` sem posição. */
export function formatLocation(locations: Offer['locations'] | null | undefined): string | null {
  const loc = locations?.[0];
  if (!loc) return null;
  const parts = [loc.depot, loc.floor && `Andar ${loc.floor}`, loc.room && `Sala ${loc.room}`, loc.path && `Corredor ${loc.path}`, loc.row && `Fila ${loc.row}`, loc.shelf && `Prateleira ${loc.shelf}`, loc.level && `Nível ${loc.level}`, loc.box && `Caixa ${loc.box}`].filter(Boolean);
  const extra = locations!.length - 1;
  return parts.length ? parts.join(' · ') + (extra > 0 ? ` (+${extra})` : '') : null;
}

// --- buscas recentes -------------------------------------------------------------------------------------------------

export const RECENTS_MAX = 8;

/** Coloca a busca no topo, sem repetir (ignora acento e caixa) e respeitando o limite. */
export function pushRecent(list: string[], q: string, max = RECENTS_MAX): string[] {
  const text = q.trim();
  if (text.length < 2) return list;
  return [text, ...list.filter((r) => norm(r) !== norm(text))].slice(0, max);
}
