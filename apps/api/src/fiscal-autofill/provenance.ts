import type { FiscalValueConfidence, FiscalValueSource, Prisma } from '@fixer/db';

/** Campos da configuração fiscal com origem registrada (docs/specs/fiscal-autofill.md §4). */
export type AutofillField = 'municipalityIbge' | 'taxRegime' | 'cnae' | 'lc116Item' | 'icmsSalePct' | 'issRate' | 'municipalServiceCode' | 'rbt12' | 'stateTaxRegular';
/** Fatos sem coluna própria, guardados só na proveniência. */
export type AutofillFact = 'simplesOptant';

export interface ProvenanceWrite {
  field: AutofillField | AutofillFact;
  source: FiscalValueSource;
  confidence: FiscalValueConfidence;
  reference?: string | null;
  evidence?: Prisma.InputJsonValue | null;
  updatedBy?: string | null;
}

type Db = Pick<Prisma.TransactionClient, 'fiscalFieldProvenance'>;

export function upsertProvenance(db: Db, orgId: string, w: ProvenanceWrite) {
  const data = {
    source: w.source,
    confidence: w.confidence,
    fetchedAt: new Date(),
    reference: w.reference ?? null,
    evidence: w.evidence ?? undefined,
    updatedBy: w.updatedBy ?? null,
  };
  return db.fiscalFieldProvenance.upsert({ where: { orgId_field: { orgId, field: w.field } }, create: { orgId, field: w.field, ...data }, update: data });
}

/** Valor digitado por alguém: daqui em diante o preenchimento automático só avisa quando a fonte discorda (R1). */
export async function markManual(db: Db, orgId: string, fields: AutofillField[], userId: string | null) {
  for (const field of fields) await upsertProvenance(db, orgId, { field, source: 'MANUAL', confidence: 'INFORMADO', updatedBy: userId });
}

/** Mesmo valor? Decimal, número e string comparados pelo número quando os dois forem numéricos. */
export function sameValue(a: unknown, b: unknown): boolean {
  if (a == null || b == null) return a == null && b == null;
  const na = Number(String(a));
  const nb = Number(String(b));
  if (String(a).trim() !== '' && String(b).trim() !== '' && Number.isFinite(na) && Number.isFinite(nb)) return na === nb;
  return String(a) === String(b);
}
