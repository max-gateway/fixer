/**
 * Regra pura do vínculo em lote pelo GTIN (docs/specs/parts-search-integration.md §9), separada do banco e da rede para ser testada sem eles.
 * Cada peça da oficina (ainda sem vínculo, com GTIN) recebe exatamente UM veredito. Só `LINKABLE` pode ser gravado sozinho; o resto é decisão da pessoa.
 */
export interface LocalPart {
  id: string;
  ean: string;
}

export interface BarcodeMatch {
  barcode: string;
  skus: string[];
}

export type LinkVerdict =
  /** O GTIN casa com exatamente uma peça do catálogo, livre: pode vincular. */
  | { kind: 'LINKABLE'; partId: string; catalogSku: string }
  /** O GTIN está em mais de uma peça do catálogo (duplicidade no cadastro dele): a pessoa escolhe. */
  | { kind: 'AMBIGUOUS_CATALOG'; partId: string; catalogSkus: string[] }
  /** Mais de uma peça da oficina tem o mesmo GTIN: nenhuma é vinculada sozinha. */
  | { kind: 'AMBIGUOUS_LOCAL'; partId: string; ean: string; partIds: string[] }
  /** A peça do catálogo já é de outra peça da oficina (ou duas peças disputam a mesma): o vínculo é único por oficina. */
  | { kind: 'CONFLICT'; partId: string; catalogSku: string; takenBy?: string }
  /** O catálogo não tem peça com esse GTIN. */
  | { kind: 'NO_MATCH'; partId: string };

/**
 * @param linked peça do catálogo → peça da oficina que JÁ a usa (para detectar conflito); vínculo da própria peça não é conflito.
 */
export function classifyBarcodeLinks(parts: LocalPart[], matches: BarcodeMatch[], linked: ReadonlyMap<string, string>): LinkVerdict[] {
  const skusByBarcode = new Map(matches.map((m) => [m.barcode, m.skus]));
  const partsByEan = new Map<string, string[]>();
  for (const p of parts) partsByEan.set(p.ean, [...(partsByEan.get(p.ean) ?? []), p.id]);

  const verdicts: LinkVerdict[] = parts.map((p): LinkVerdict => {
    const sameEan = partsByEan.get(p.ean)!;
    if (sameEan.length > 1) return { kind: 'AMBIGUOUS_LOCAL', partId: p.id, ean: p.ean, partIds: sameEan };
    const skus = skusByBarcode.get(p.ean) ?? [];
    if (skus.length === 0) return { kind: 'NO_MATCH', partId: p.id };
    if (skus.length > 1) return { kind: 'AMBIGUOUS_CATALOG', partId: p.id, catalogSkus: skus };
    const catalogSku = skus[0]!;
    const takenBy = linked.get(catalogSku);
    if (takenBy !== undefined && takenBy !== p.id) return { kind: 'CONFLICT', partId: p.id, catalogSku, takenBy };
    return { kind: 'LINKABLE', partId: p.id, catalogSku };
  });

  // Duas peças da oficina (com GTIN diferentes) que apontam para a MESMA peça do catálogo: o vínculo é único, então nenhuma ganha sozinha.
  const claimants = new Map<string, string[]>();
  for (const v of verdicts) if (v.kind === 'LINKABLE') claimants.set(v.catalogSku, [...(claimants.get(v.catalogSku) ?? []), v.partId]);
  return verdicts.map((v): LinkVerdict => {
    if (v.kind !== 'LINKABLE') return v;
    const others = claimants.get(v.catalogSku)!.filter((id) => id !== v.partId);
    return others.length > 0 ? { kind: 'CONFLICT', partId: v.partId, catalogSku: v.catalogSku, takenBy: others[0]! } : v;
  });
}
