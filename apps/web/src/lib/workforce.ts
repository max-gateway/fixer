// Equipe: tipos do contrato do workforce (via /workforce da API) e regras puras da tela. Sem React, sem rede.

export type PersonStatus = 'active' | 'inactive';
export type EngagementKind = 'clt' | 'pj' | 'autonomo' | 'socio' | 'estagio' | 'temporario';

export type Person = {
  id: string;
  /** Mascarado pelo workforce para quem não tem `people:write`; anonimizada = `***.***.***-**`. */
  cpf: string;
  name: string;
  socialName: string | null;
  birthDate: string | null;
  email: string | null;
  phone: string | null;
  hasLogin: boolean;
  status: PersonStatus;
  version: number;
  createdAt: string;
  anonymized: boolean;
};

export type PositionAssignment = { positionKey: string; positionName: string; validFrom: string; validTo: string | null };

export type Engagement = {
  id: string;
  kind: EngagementKind;
  status: 'active' | 'terminated';
  unitId: string | null;
  unitName: string | null;
  admittedOn: string;
  terminatedOn: string | null;
  positions: PositionAssignment[];
};

export type PersonDetail = Person & { engagements: Engagement[] };
export type PersonPage = { items: Person[]; nextCursor: string | null };
export type Unit = { id: string; name: string; status: string };
export type Position = { id: string; key: string; name: string; status: string };
export type Access = { manage: boolean };

export type Filters = { q: string; status: '' | PersonStatus };
export const DEFAULT_FILTERS: Filters = { q: '', status: 'active' };
export const PAGE_SIZE = 50;

export const KIND_LABEL: Record<EngagementKind, string> = {
  clt: 'CLT',
  pj: 'PJ',
  autonomo: 'Autônomo',
  socio: 'Sócio',
  estagio: 'Estágio',
  temporario: 'Temporário',
};
export const KINDS = Object.keys(KIND_LABEL) as EngagementKind[];

export const STATUS_TABS: { value: Filters['status']; label: string }[] = [
  { value: 'active', label: 'Ativos' },
  { value: 'inactive', label: 'Inativos' },
  { value: '', label: 'Todos' },
];

export function filtersToParams(f: Filters, limit = PAGE_SIZE): URLSearchParams {
  const p = new URLSearchParams();
  if (f.q.trim()) p.set('search', f.q.trim());
  if (f.status) p.set('status', f.status);
  p.set('limit', String(limit));
  return p;
}

/** O nome que a oficina usa no dia a dia: o social, quando existe. */
export const displayName = (p: Pick<Person, 'name' | 'socialName'>): string => p.socialName?.trim() || p.name;

// ---------- CPF ----------

export const digits = (s: string): string => s.replace(/\D/g, '');

export function maskCpf(value: string): string {
  const d = digits(value).slice(0, 11);
  return d
    .replace(/^(\d{3})(\d)/, '$1.$2')
    .replace(/^(\d{3})\.(\d{3})(\d)/, '$1.$2.$3')
    .replace(/\.(\d{3})(\d)/, '.$1-$2');
}

/** Dígitos verificadores do CPF (rejeita sequências iguais). O workforce valida de novo; aqui é só para avisar antes de enviar. */
export function isValidCpf(value: string): boolean {
  const d = digits(value);
  if (d.length !== 11 || /^(\d)\1{10}$/.test(d)) return false;
  const check = (len: number) => {
    let sum = 0;
    for (let i = 0; i < len; i++) sum += Number(d[i]) * (len + 1 - i);
    const r = (sum * 10) % 11;
    return r === 10 ? 0 : r;
  };
  return check(9) === Number(d[9]) && check(10) === Number(d[10]);
}

// ---------- datas civis (AAAA-MM-DD, sem fuso) ----------

export const todayIso = (now: Date = new Date()): string => now.toLocaleDateString('sv-SE', { timeZone: 'America/Sao_Paulo' });

export function formatDate(iso: string | null | undefined): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso ?? '');
  return m ? `${m[3]}/${m[2]}/${m[1]}` : '—';
}

const MONTHS = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];
export function formatMonthYear(iso: string): string {
  const m = /^(\d{4})-(\d{2})/.exec(iso);
  return m ? `${MONTHS[Number(m[2]) - 1]}/${m[1]}` : '—';
}

/** "2 anos e 3 meses", "5 meses", "menos de 1 mês": tempo de casa entre duas datas civis. */
export function tenure(from: string, to: string): string {
  const a = /^(\d{4})-(\d{2})-(\d{2})/.exec(from);
  const b = /^(\d{4})-(\d{2})-(\d{2})/.exec(to);
  if (!a || !b) return '—';
  let months = (Number(b[1]) - Number(a[1])) * 12 + (Number(b[2]) - Number(a[2]));
  if (Number(b[3]) < Number(a[3])) months -= 1;
  if (months < 1) return 'menos de 1 mês';
  const y = Math.floor(months / 12);
  const m = months % 12;
  const years = y ? `${y} ${y === 1 ? 'ano' : 'anos'}` : '';
  const rest = m ? `${m} ${m === 1 ? 'mês' : 'meses'}` : '';
  return [years, rest].filter(Boolean).join(' e ');
}

// ---------- vínculos ----------

/** Função em vigor hoje (a mais recente sem fim, ou que ainda não acabou). */
export function currentPositions(e: Engagement, today: string): PositionAssignment[] {
  return e.positions.filter((p) => p.validFrom <= today && (p.validTo === null || p.validTo >= today));
}

export const activeEngagements = (p: PersonDetail): Engagement[] => p.engagements.filter((e) => e.status === 'active');

/** Vínculo e função principal para o cabeçalho: o vínculo ativo mais antigo, com a função em vigor. */
export function headline(p: PersonDetail, today: string): { engagement: Engagement; position: string | null } | null {
  const e = activeEngagements(p)[0];
  if (!e) return null;
  return { engagement: e, position: currentPositions(e, today)[0]?.positionName ?? null };
}
