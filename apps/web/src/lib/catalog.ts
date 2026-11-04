// Catálogo global de peças (plataforma parts-search) como a API do Fixer o devolve. Só leitura, exceto o vínculo.

/** Uma peça do catálogo na busca: o que a tela mostra para a pessoa escolher. */
export type CatalogHit = {
  sku: string;
  name: string;
  partNumber: string;
  brand?: { key: string; name: string };
  category?: { id: string; name: string };
  imageUrl?: string;
};

export type CatalogSearch = { data: CatalogHit[] };

/** Sugestão para um item da nota: a peça da oficina já vinculada à peça do catálogo daquele código de barras. */
export type InvoiceSuggestion = {
  itemId: string;
  partId: string;
  partSku: string;
  partName: string;
  catalogSku: string;
};

export type LinkVerdictKind = 'LINKABLE' | 'AMBIGUOUS_CATALOG' | 'AMBIGUOUS_LOCAL' | 'CONFLICT' | 'NO_MATCH';

export type LinkReport = {
  scanned: number;
  truncated: boolean;
  summary: { linkable: number; ambiguousCatalog: number; ambiguousLocal: number; conflict: number; noMatch: number; linked: number };
};

/** "BE-123 · Fiat": número da peça e marca, o que diferencia duas peças de nome parecido. */
export function hitSubtitle(hit: CatalogHit): string {
  return [hit.partNumber, hit.brand?.name].filter(Boolean).join(' · ');
}

/** Rótulo curto da peça escolhida, para o botão do seletor. */
export function hitLabel(hit: Pick<CatalogHit, 'name' | 'partNumber'>): string {
  return `${hit.partNumber} · ${hit.name}`;
}
