// Tabelas de regra tributária (docs/specs/tax-rules.md). São DADOS versionados: cada tabela cita a fonte legal, a
// data em que foi conferida e a vigência. Nada aqui é parecer tributário: `validatedBy` fica nulo até o contador
// da oficina (ou o curador da plataforma) validar a tabela.

export interface RuleSource {
  /** Ato legal de onde o dado foi transcrito. */
  law: string;
  url: string;
  /** Data (AAAA-MM-DD) em que o texto oficial foi lido. */
  retrievedAt: string;
}

export interface TableMeta {
  id: string;
  /** Muda a cada alteração do conteúdo; vai no snapshot de cada preço calculado. */
  version: string;
  /** Início da vigência, AAAA-MM-DD. */
  effectiveFrom: string;
  /** Fim da vigência (inclusive), AAAA-MM-DD; null enquanto vigente sem data de término conhecida. */
  effectiveTo: string | null;
  sources: RuleSource[];
  /** Quem validou a tabela e quando; null = ainda não validada por humano. */
  validatedBy: { name: string; at: string } | null;
  /** O que a tabela NÃO cobre e precisa de conferência. */
  caveats: string[];
}

/** A data (AAAA-MM-DD) está dentro da vigência da tabela? */
export function inForce(meta: Pick<TableMeta, 'effectiveFrom' | 'effectiveTo'>, asOf: string): boolean {
  return asOf >= meta.effectiveFrom && (meta.effectiveTo === null || asOf <= meta.effectiveTo);
}
