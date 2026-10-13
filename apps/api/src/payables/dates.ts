/** Datas civis (AAAA-MM-DD) no fuso da oficina. O servidor roda em UTC, mas "hoje" e "vencida" são conceitos de Brasília. */
export const TIMEZONE = 'America/Sao_Paulo';

export const isoDay = (d: Date): string => d.toISOString().slice(0, 10);

/** Hoje em Brasília como AAAA-MM-DD. */
export function todayIso(now: Date = new Date()): string {
  return now.toLocaleDateString('sv-SE', { timeZone: TIMEZONE });
}

/** Meia-noite UTC da data civil: é como a coluna DATE chega e sai do Prisma. */
export const civil = (iso: string): Date => new Date(`${iso}T00:00:00.000Z`);

export function addDaysIso(iso: string, n: number): string {
  return isoDay(new Date(civil(iso).getTime() + n * 86_400_000));
}

/** Soma `n` meses mantendo o dia, limitado ao último dia do mês de destino (31/01 + 1 mês = 28/02). */
export function addMonths(iso: string, n: number): Date {
  const [y, m, d] = iso.split('-').map(Number) as [number, number, number];
  const target = new Date(Date.UTC(y, m - 1 + n, 1));
  const last = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  return new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth(), Math.min(d, last)));
}

/** Primeiro dia do mês da data civil. */
export const monthStartIso = (iso: string): string => `${iso.slice(0, 7)}-01`;
