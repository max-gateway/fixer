// Formatação pt-BR feita no backend: a tela só exibe o que recebe.
const brl = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 });
const compact = new Intl.NumberFormat('pt-BR', { notation: 'compact', maximumFractionDigits: 1 });
const int = new Intl.NumberFormat('pt-BR');

export const money = (v: number) => brl.format(Math.round(v));
export const moneyCompact = (v: number) => (Math.abs(v) >= 10_000 ? `R$ ${compact.format(v)}` : money(v));
export const count = (v: number) => int.format(Math.round(v));
export const percent = (v: number, digits = 0) => `${v.toFixed(digits).replace('.', ',')}%`;

const DAY = new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: 'short', timeZone: 'UTC' });
const WEEKDAY = new Intl.DateTimeFormat('pt-BR', { weekday: 'short', timeZone: 'UTC' });
export const dayLabel = (d: Date) => DAY.format(d).replace(' de ', ' ').replace('.', '');
export const weekdayShort = (d: Date) => WEEKDAY.format(d).replace(' de ', ' ').replace('.', '');
export const isoDay = (d: Date) => d.toISOString().slice(0, 10);

export const WEEKDAYS_PT = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'] as const;
export const WEEKDAYS_LONG = ['domingo', 'segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado'] as const;

const axis = new Intl.NumberFormat('pt-BR', { notation: 'compact', maximumFractionDigits: 1 });
export const axisMoney = (v: number) => (v === 0 ? 'R$ 0' : `R$ ${axis.format(v)}`);
export const signed = (v: number, digits = 1) => `${v > 0 ? '+' : v < 0 ? '−' : ''}${Math.abs(v).toFixed(digits).replace('.', ',')}`;

/** "A", "A e B", "A, B e C". */
export const listJoin = (xs: readonly string[]) => (xs.length < 2 ? (xs[0] ?? '') : `${xs.slice(0, -1).join(', ')} e ${xs[xs.length - 1]}`);
