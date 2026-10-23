import { sourceCheck, TABLES } from '@fixer/tax-rules';
import type { Regime } from './sale-tax.js';

// Quem garante o imposto: o contador ou a fonte oficial (docs/specs/tax-rules.md §6). Antes, só o aceite do contador levava
// o imposto de "estimado" a "confirmado". Agora vale também a fonte: tabela conferida com o texto da lei na versão em uso
// (`verify:sources`), e perfil cujos valores vieram todos de registro do governo (PGDAS-D, prefeitura). O que foi digitado
// ou estimado continua pedindo o contador.

/** CONTADOR = aceite de alguém com `fiscal.verify`; FONTE_OFICIAL = conferido com o registro oficial, sem aceite humano. */
export type TrustBasis = 'CONTADOR' | 'FONTE_OFICIAL';

export interface TableTrust {
  basis: TrustBasis | null;
  /** O contador validou uma versão anterior (o aceite caiu quando a tabela mudou). */
  staleReview: boolean;
  /** Data da conferência com a fonte, quando é ela que garante. */
  checkedAt: string | null;
}

export interface TableReviewRow {
  tableId: string;
  version: string;
}

/** Confiança de cada tabela do pacote para esta organização. O aceite do contador na versão em uso vem antes da fonte. */
export function tableTrust(reviews: readonly TableReviewRow[]): Map<string, TableTrust> {
  const out = new Map<string, TableTrust>();
  for (const t of TABLES) {
    const r = reviews.find((x) => x.tableId === t.id);
    const stamp = sourceCheck(t);
    if (r?.version === t.version) out.set(t.id, { basis: 'CONTADOR', staleReview: false, checkedAt: stamp?.checkedAt ?? null });
    else out.set(t.id, { basis: stamp ? 'FONTE_OFICIAL' : null, staleReview: r !== undefined, checkedAt: stamp?.checkedAt ?? null });
  }
  return out;
}

export const trustedTables = (trust: ReadonlyMap<string, TableTrust>) => new Set([...trust].filter(([, t]) => t.basis !== null).map(([id]) => id));

type Num = { toString(): string } | number | string | null | undefined;
export interface TrustProfile {
  rbt12: Num;
  simplesEffectiveRatePct: Num;
  icmsSalePct: Num;
  icmsSharePct: Num;
  pisSharePct: Num;
  cofinsSharePct: Num;
  reviewedAt: Date | null;
}
export interface TrustProvenance {
  source: string;
  confidence: string;
}

/** Campos do perfil que pedem o contador (digitados ou estimados), com o nome que a tela mostra. */
export type PendingField = 'rbt12' | 'simplesEffectiveRatePct' | 'icmsSalePct' | 'shares';

export interface ProfileTrust {
  basis: TrustBasis | null;
  /** Por que a fonte não basta: os valores em uso que não vieram de registro oficial. Vazio quando basis != null. */
  pending: PendingField[];
}

const has = (v: Num) => v !== null && v !== undefined;

/**
 * Perfil garantido? Pelo contador (aceite em vigor) ou pela fonte: todo valor que entra no cálculo deste regime veio de
 * registro oficial (confiança OFICIAL) e não há percentual digitado por cima da tabela (alíquota efetiva ou repartição).
 */
export function profileTrust(regime: Regime | null, profile: TrustProfile | null, provenance: ReadonlyMap<string, TrustProvenance>): ProfileTrust {
  if (!profile) return { basis: null, pending: [] };
  if (profile.reviewedAt) return { basis: 'CONTADOR', pending: [] };
  const official = (field: string) => provenance.get(field)?.confidence === 'OFICIAL';
  const pending: PendingField[] = [];
  const r = regime ?? 'SIMPLES';
  if (r === 'REAL') return { basis: null, pending };
  if (has(profile.icmsSharePct) || has(profile.pisSharePct) || has(profile.cofinsSharePct)) pending.push('shares');
  if (r === 'SIMPLES') {
    if (has(profile.simplesEffectiveRatePct)) pending.push('simplesEffectiveRatePct');
    else if (!has(profile.rbt12)) return { basis: null, pending };
    else if (!official('rbt12')) pending.push('rbt12');
  } else {
    if (!has(profile.icmsSalePct)) return { basis: null, pending };
    if (!official('icmsSalePct')) pending.push('icmsSalePct');
  }
  return pending.length ? { basis: null, pending } : { basis: 'FONTE_OFICIAL', pending };
}

/** O valor principal do perfil neste regime: RBT12 no Simples, ICMS da venda no Presumido. */
export const mainProfileField = (regime: Regime | null) => ((regime ?? 'SIMPLES') === 'PRESUMIDO' ? 'icmsSalePct' : 'rbt12');

interface TrustDb {
  taxTableReview: { findMany(args?: object): Promise<TableReviewRow[]> };
  fiscalFieldProvenance: { findMany(args?: object): Promise<{ field: string; source: string; confidence: string; reference: string | null }[]> };
}

/** Confiança das tabelas e do perfil, lida do banco no contexto do tenant (mesma regra no preview, no lançamento e na tela). */
export async function loadTaxTrust(db: TrustDb, regime: Regime | null, profile: TrustProfile | null) {
  const [reviews, provs] = await Promise.all([db.taxTableReview.findMany(), db.fiscalFieldProvenance.findMany()]);
  const provenance = new Map(provs.map((p) => [p.field, p]));
  const main = provenance.get(mainProfileField(regime));
  return {
    tables: tableTrust(reviews),
    profile: profileTrust(regime, profile, provenance),
    origin: main ? { source: main.source, confidence: main.confidence, reference: main.reference } : null,
  };
}
