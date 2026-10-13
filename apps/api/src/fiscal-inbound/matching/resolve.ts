/**
 * Regras puras do matcher (docs/specs/nfe-import.md §8.1), separadas do banco para serem testadas
 * sem ele. Em ordem, o primeiro acerto vence:
 *   1. vínculo aprendido do fornecedor (cProd)  → AUTO_MAP, herda o fator de unidade
 *   2. GTIN igual ao de UMA peça, na mesma unidade → AUTO_EAN (e aprende o vínculo)
 *   3. senão                                    → fica UNRESOLVED
 */
export interface MatchableItem {
  id: string;
  supplierCode: string;
  ean: string | null;
  /** uCom da nota; opcional (sem ele a trava de unidade não age). */
  unit?: string;
  resolution: string;
}

export interface LearnedMap {
  partId: string;
  unitFactor: string;
}

export interface ItemResolution {
  itemId: string;
  resolution: 'AUTO_MAP' | 'AUTO_EAN';
  partId: string;
  unitFactor: string;
  /** AUTO_EAN aprende o vínculo, para a próxima nota do fornecedor resolver por código. */
  learn: boolean;
}

const normUnit = (u: string) => u.trim().toUpperCase();
function sameUnit(invoiceUnit: string | undefined, partUnit: string | null | undefined): boolean {
  if (!invoiceUnit || !partUnit) return true;
  return normUnit(invoiceUnit) === normUnit(partUnit);
}

export function resolveItems(
  items: MatchableItem[],
  maps: ReadonlyMap<string, LearnedMap>,
  partsByEan: ReadonlyMap<string, string[]>,
  /** Unidade de estoque de cada peça; peça sem unidade cadastrada não bloqueia. */
  partUnits: ReadonlyMap<string, string | null> = new Map(),
): ItemResolution[] {
  const out: ItemResolution[] = [];
  for (const item of items) {
    if (item.resolution !== 'UNRESOLVED') continue; // decisão humana (ou anterior) nunca é sobrescrita
    const learned = maps.get(item.supplierCode);
    if (learned) {
      out.push({ itemId: item.id, resolution: 'AUTO_MAP', partId: learned.partId, unitFactor: learned.unitFactor, learn: false });
      continue;
    }
    const parts = item.ean ? partsByEan.get(item.ean) : undefined;
    // O GTIN pode ser o da unidade enquanto a nota vem em caixa (fator 1 entraria errado): unidade diferente fica para o usuário.
    if (parts?.length === 1 && sameUnit(item.unit, partUnits.get(parts[0]!))) {
      out.push({ itemId: item.id, resolution: 'AUTO_EAN', partId: parts[0]!, unitFactor: '1', learn: true });
    }
    // Mais de uma peça com o mesmo GTIN é ambíguo: quem decide é o usuário.
  }
  return out;
}

export type ExportStatus = 'NOT_READY' | 'PENDING_MATCH' | 'READY' | 'POSTED' | 'VOIDED';

/**
 * Próximo `exportStatus` de uma nota completa, ou null se não cabe mexer. Só alterna entre PENDING_MATCH e
 * READY: nota lançada, anulada ou sem XML completo nunca é tocada por conciliação.
 */
export function nextExportStatus(
  invoice: { status: string; exportStatus: ExportStatus; needsReview: boolean },
  resolutions: string[],
): 'PENDING_MATCH' | 'READY' | null {
  if (invoice.status !== 'FULL') return null;
  if (invoice.exportStatus !== 'PENDING_MATCH' && invoice.exportStatus !== 'READY') return null;
  const done = resolutions.length > 0 && resolutions.every((r) => r !== 'UNRESOLVED');
  return done && !invoice.needsReview ? 'READY' : 'PENDING_MATCH';
}
