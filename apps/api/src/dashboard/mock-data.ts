import { seeded } from './analytics.js';

// Dados fictícios de uma oficina de ~10 OS/dia útil. Determinísticos: o mesmo dia sempre gera os mesmos números.
// Quando houver dados reais, só este arquivo é substituído por consultas ao Prisma; o service não muda.

export const DAY_MS = 86_400_000;
export const HISTORY_DAYS = 180; // 90d atuais + 90d do período anterior de comparação

export type DayMetric = {
  date: Date;
  weekday: number;
  orders: number;
  revenue: number;
  quotes: number;
  approved: number;
  completed: number;
  delivered: number;
};

const WEEKDAY_FACTOR = [0.05, 1.05, 1.1, 1.05, 1.0, 1.15, 0.45]; // dom..sáb

export const startOfUtcDay = (d: Date) => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));

/** Série diária terminando em `today` (inclusive), do mais antigo ao mais novo. */
export function dailyHistory(today: Date): DayMetric[] {
  const end = startOfUtcDay(today).getTime();
  const days: DayMetric[] = [];
  for (let i = HISTORY_DAYS - 1; i >= 0; i--) {
    const date = new Date(end - i * DAY_MS);
    const rand = seeded(Math.floor(date.getTime() / DAY_MS));
    const weekday = date.getUTCDay();
    const growth = 1 + ((HISTORY_DAYS - 1 - i) / HISTORY_DAYS) * 0.22; // ~22% de crescimento no semestre
    const orders = Math.max(0, Math.round(8.5 * WEEKDAY_FACTOR[weekday]! * growth * (0.8 + rand() * 0.4)));
    // Picos raros (frota/seguradora) criam dias atípicos para o detector de outliers.
    const bigJob = orders > 0 && rand() > 0.96 ? 2800 + rand() * 2200 : 0;
    const ticket = 620 + rand() * 340;
    days.push({
      date,
      weekday,
      orders,
      revenue: Math.round(orders * ticket + bigJob),
      quotes: Math.round(orders * (1.35 + rand() * 0.2)),
      approved: orders,
      completed: Math.round(orders * (0.88 + rand() * 0.08)),
      delivered: Math.round(orders * (0.8 + rand() * 0.08)),
    });
  }
  return days;
}

export const STATUS_WEIGHTS = [
  { status: 'QUOTE', label: 'Orçamento', weight: 0.14 },
  { status: 'APPROVED', label: 'Aprovada', weight: 0.1 },
  { status: 'IN_PROGRESS', label: 'Em andamento', weight: 0.27 },
  { status: 'AWAITING_PART', label: 'Aguardando peça', weight: 0.08 },
  { status: 'COMPLETED', label: 'Concluída', weight: 0.13 },
  { status: 'DELIVERED', label: 'Entregue', weight: 0.25 },
  { status: 'CANCELLED', label: 'Cancelada', weight: 0.03 },
] as const;

export const SERVICES = [
  { name: 'Revisão completa', avg: 890, weight: 0.22 },
  { name: 'Freios (pastilhas e discos)', avg: 760, weight: 0.17 },
  { name: 'Suspensão', avg: 1240, weight: 0.13 },
  { name: 'Troca de óleo e filtros', avg: 310, weight: 0.24 },
  { name: 'Alinhamento e balanceamento', avg: 180, weight: 0.14 },
  { name: 'Ar-condicionado', avg: 540, weight: 0.1 },
] as const;

export const MECHANICS = [
  { name: 'Rafael Moura', capacity: 5 },
  { name: 'Camila Duarte', capacity: 4 },
  { name: 'Joaquim Pires', capacity: 5 },
  { name: 'Tainá Lopes', capacity: 4 },
] as const;

export const ATTENTION = [
  { id: 'a1', severity: 'high', title: 'Aguardando peça há 4 dias', detail: 'Pastilha de freio dianteira · Corolla ABC1D23', orderNumber: 1042 },
  { id: 'a2', severity: 'high', title: 'Orçamento sem resposta há 3 dias', detail: 'R$ 2.480 em risco · Maria Helena Souza', orderNumber: 1051 },
  { id: 'a3', severity: 'medium', title: 'Entrega prevista para hoje, ainda em andamento', detail: 'Hilux QWE4R56 · 2 itens do checklist pendentes', orderNumber: 1047 },
  { id: 'a4', severity: 'medium', title: 'Estoque baixo: filtro de óleo PH5949', detail: '3 unidades · consumo de ~2 por dia', orderNumber: null },
  { id: 'a5', severity: 'low', title: 'Cliente reportou problema no portal', detail: 'Barulho persistente após a revisão · Onix RTY8U90', orderNumber: 1039 },
] as const;

export const ACTIVITY = [
  { id: 'e1', minutesAgo: 6, kind: 'status', text: 'OS aprovada pelo cliente no portal', orderNumber: 1053 },
  { id: 'e2', minutesAgo: 19, kind: 'plate', text: 'Placa lida pela câmera: Civic FGH2J34', orderNumber: null },
  { id: 'e3', minutesAgo: 42, kind: 'message', text: 'Nova mensagem do cliente pelo WhatsApp', orderNumber: 1047 },
  { id: 'e4', minutesAgo: 75, kind: 'payment', text: 'Pagamento de R$ 1.180 confirmado', orderNumber: 1044 },
  { id: 'e5', minutesAgo: 130, kind: 'stock', text: 'Compra recebida: 24 un. de filtro de óleo', orderNumber: null },
  { id: 'e6', minutesAgo: 190, kind: 'status', text: 'OS concluída e pronta para entrega', orderNumber: 1041 },
] as const;
