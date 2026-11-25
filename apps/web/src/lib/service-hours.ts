// Horas de serviço na interface: formatação e leitura da origem da estimativa.
// Espelha EstimateSource/HoursSource da API (docs/specs/service-catalog.md §5–§6).

export type EstimateSource = 'LEARNED' | 'REFERENCE' | 'MANUAL' | 'NONE';

export type ServiceEstimate =
  | { source: 'NONE' }
  | { source: 'LEARNED' | 'REFERENCE'; hours: number; p25: number; p75: number; level: string; sampleCount: number };

export type FiscalIssue = { field: string; message: string };

export type FiscalReadiness = {
  ready: boolean;
  nfe: { required: boolean; ready: boolean; items: { name: string; issues: FiscalIssue[] }[] };
  nfse: { required: boolean; ready: boolean; settingsIssues: FiscalIssue[]; items: { name: string; issues: FiscalIssue[] }[] };
};

/** 4.5 → "4 h 30 min"; 4 → "4 h"; 0.25 → "15 min". Aceita string decimal (como o Prisma serializa). */
export function formatHours(value: number | string): string {
  const total = Math.round(Number(value) * 60);
  if (!Number.isFinite(total) || total < 0) return '—';
  const h = Math.floor(total / 60);
  const m = total % 60;
  if (h === 0) return `${m} min`;
  return m === 0 ? `${h} h` : `${h} h ${m} min`;
}

/** "4,5" ou "4.5" → 4.5; vazio ou inválido → null. */
export function parseHours(text: string): number | null {
  const n = Number(text.trim().replace(',', '.'));
  return text.trim() !== '' && Number.isFinite(n) && n > 0 && n <= 100 ? n : null;
}

/** Texto curto da origem da estimativa, para o operador saber o quanto confiar. */
export function estimateNote(source: EstimateSource | null, hours?: number | string | null, sampleCount?: number): string {
  const h = hours != null ? formatHours(hours) : null;
  switch (source) {
    case 'LEARNED':
      return sampleCount ? `Sugestão: ${h} (baseada em ${sampleCount} ${sampleCount === 1 ? 'serviço' : 'serviços'})` : `Sugestão: ${h}`;
    case 'REFERENCE':
      return `Referência: ${h} em ${sampleCount ?? 1} ${sampleCount === 1 || sampleCount == null ? 'serviço semelhante' : 'serviços semelhantes'}`;
    case 'MANUAL':
      return `Estimativa informada: ${h}`;
    default:
      return 'Sem histórico: informe as horas';
  }
}
