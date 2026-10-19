// Preenchimento automático da configuração fiscal (docs/specs/fiscal-autofill.md). A API faz o trabalho; aqui só tipos e textos.

export type FiscalValueSource = 'CNPJ_LOOKUP' | 'INTEGRA_PGDASD' | 'INTEGRA_PAGAMENTOS' | 'NFSE_PARAMETROS' | 'TAX_RULES_DEFAULT' | 'FIXER_ESTIMATE' | 'MANUAL';
export type FiscalValueConfidence = 'OFICIAL' | 'INFERIDO' | 'ESTIMADO' | 'INFORMADO';

export type FieldProvenance = { field: string; source: FiscalValueSource; confidence: FiscalValueConfidence; fetchedAt: string; reference: string | null };
export type AutofillProvenance = { fields: FieldProvenance[]; simplesOptant: boolean | null };

export type FieldOutcome = 'PREENCHIDO' | 'IGUAL' | 'CONFLITO' | 'LIMPO' | 'SEM_DADO';
export type AutofillReport = {
  cnpj: string;
  reset: 'NENHUM' | 'MUNICIPIO' | 'EMPRESA';
  steps: { step: 'CNPJ_LOOKUP' | 'SERVICO' | 'ICMS_VENDA'; status: 'OK' | 'SEM_DADO' | 'FALHOU' | 'PULADO'; detail?: string }[];
  fields: { field: string; outcome: FieldOutcome; value: string | null; previous?: string | null }[];
  needsRegime: boolean;
  simplesOptant: boolean | null;
};

const FIELD_LABEL: Record<string, string> = {
  municipalityIbge: 'Município (IBGE)',
  taxRegime: 'Regime tributário',
  cnae: 'CNAE principal',
  lc116Item: 'Serviço (LC 116)',
  icmsSalePct: 'ICMS da venda',
  issRate: 'Alíquota de ISS',
  municipalServiceCode: 'Código de tributação municipal',
  rbt12: 'RBT12',
  stateTaxRegular: 'Situação na SEFAZ',
};

const REGIME_LABEL: Record<string, string> = { SIMPLES: 'Simples Nacional', PRESUMIDO: 'Lucro presumido', REAL: 'Lucro real' };

const SOURCE_LABEL: Record<FiscalValueSource, string> = {
  CNPJ_LOOKUP: 'Receita Federal (consulta de CNPJ)',
  INTEGRA_PGDASD: 'Receita Federal (PGDAS-D)',
  INTEGRA_PAGAMENTOS: 'Receita Federal (pagamentos)',
  NFSE_PARAMETROS: 'Prefeitura (NFS-e Nacional)',
  TAX_RULES_DEFAULT: 'Regra do Fixer',
  FIXER_ESTIMATE: 'Estimativa do Fixer',
  MANUAL: 'Informado por você',
};

/** Etiqueta curta da origem de um valor; `estimated` pede destaque (conferir com o contador). */
export function provenanceTag(p: FieldProvenance | undefined): { text: string; estimated: boolean } | null {
  if (!p) return null;
  const base = SOURCE_LABEL[p.source];
  if (p.confidence === 'INFERIDO') return { text: `${base}, pela CNAE`, estimated: false };
  if (p.confidence === 'ESTIMADO') return { text: `${base}, estimado: confira com o contador`, estimated: true };
  return { text: base, estimated: false };
}

const show = (field: string, v: string | null | undefined) => (v == null ? 'vazio' : field === 'taxRegime' ? (REGIME_LABEL[v] ?? v) : v);

/** Avisos para a pessoa depois de uma atualização: o que a fonte trouxe de diferente do que ela digitou, e o que foi limpo. */
export function autofillNotices(r: AutofillReport): string[] {
  const out: string[] = [];
  for (const f of r.fields) {
    const label = FIELD_LABEL[f.field] ?? f.field;
    if (f.outcome === 'CONFLITO' && f.field === 'taxRegime' && f.value === null) {
      out.push(`${label}: a Receita informa que a empresa não é mais do Simples Nacional, mas o salvo é ${show(f.field, f.previous)}. Confira com o contador.`);
    } else if (f.outcome === 'CONFLITO') {
      out.push(`${label}: a consulta trouxe ${show(f.field, f.value)}, mas o salvo é ${show(f.field, f.previous)}. Mantivemos o seu valor.`);
    } else if (f.outcome === 'LIMPO') {
      out.push(`${label}: a empresa não consta mais como ${show(f.field, f.previous)} na Receita. Informe o regime atual.`);
    }
  }
  if (r.steps.some((s) => s.step === 'CNPJ_LOOKUP' && s.status === 'FALHOU')) out.push('Não foi possível consultar a Receita agora. Tente de novo em instantes.');
  return out;
}
