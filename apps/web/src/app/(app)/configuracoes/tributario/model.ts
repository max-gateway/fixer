// Tipos e textos da tela Tributário. O cálculo é da API (GET /pricing/tax-overview, que chama packages/tax-rules); aqui só se traduz para a pessoa.

export type TaxOverview = {
  asOf: string;
  regime: 'SIMPLES' | 'PRESUMIDO' | 'REAL' | null;
  simples: {
    rbt12: string;
    bracket: number;
    nominalPct: string;
    effectivePct: string;
    dasPct: string;
    components: { key: string; pct: string }[];
    ceilingUsedPct: number;
    sublimitUsedPct: number;
    stateTaxesOutsideDas: boolean;
    outsideSimples: boolean;
    nextBracketAtCents: string | null;
  } | null;
  presumido: { irpjPct: string; csllPct: string; pisPct: string; cofinsPct: string; totalPct: string; pisCofinsExtinct: boolean } | null;
  iss: { saved: string | null; item: string | null; engine: { status: string; ratePct: string | null; effectivePct: string | null; remainingPct: string | null } | null; check: string | null };
  services: {
    simples: { annex: 'III'; bracket: number; nominalPct: string; effectivePct: string; dasPct: string; components: { key: string; pct: string }[]; issCapApplied: boolean; stateTaxesOutsideDas: boolean } | null;
    presumido: { irpjPct: string; csllPct: string; pisPct: string; cofinsPct: string; totalPct: string; pisCofinsExtinct: boolean } | null;
  };
  transition: { from: string; to: string; pisCofinsInForce: boolean; icmsRemainingPct: string; issRemainingPct: string; simplesOptantesCharged: boolean } | null;
  conferencia: { status: 'CONFERE' | 'DIVERGE' | 'SEM_COMPARAVEL'; periodoDeclaracao: string | null; rbt12Base: string | null; itens: { anexo: string; receita: string; declaradaPct: string; tabelaPct: string; confere: boolean }[] } | null;
};

/** Nome de balcão de cada tributo: o que é e quem recebe. */
export const TAX_LABEL: Record<string, { name: string; who: string }> = {
  icms: { name: 'ICMS', who: 'Estado' },
  iss: { name: 'ISS', who: 'Prefeitura' },
  pis: { name: 'PIS', who: 'União' },
  cofins: { name: 'COFINS', who: 'União' },
  cbs: { name: 'CBS', who: 'União (reforma)' },
  ibs: { name: 'IBS', who: 'Estados e municípios (reforma)' },
  ipi: { name: 'IPI', who: 'União' },
  irpj: { name: 'Imposto de Renda', who: 'União' },
  csll: { name: 'CSLL', who: 'União' },
  cpp: { name: 'Previdência (CPP)', who: 'União' },
};

export const pct = (v: string | number, digits = 2) => `${Number(v).toLocaleString('pt-BR', { minimumFractionDigits: digits === 0 ? 0 : 2, maximumFractionDigits: digits })}%`;
export const brDate = (iso: string) => new Date(iso.length === 10 ? `${iso}T00:00:00` : iso).toLocaleDateString('pt-BR');
/** AAAAMM -> MM/AAAA. */
export const period = (p: string) => `${p.slice(4)}/${p.slice(0, 4)}`;
