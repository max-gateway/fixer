// Espelho de apps/api/src/dashboard/types.ts: o backend calcula, a tela só desenha.
export type DashboardRange = '7d' | '30d' | '90d';
export type Tone = 'good' | 'warn' | 'bad' | 'info';

export type DeltaView = { pct: number | null; direction: 'up' | 'down' | 'flat'; label: string };

export type Kpi = {
  id: 'revenue' | 'orders' | 'ticket' | 'approval';
  label: string;
  display: string;
  delta: DeltaView;
  /** Já considera a polaridade da métrica (ex.: queda de prazo é boa). */
  tone: Tone;
  sparkline: number[];
  hint: string;
};

export type Tick = { value: number; label: string };

export type ChartPoint = { date: string; label: string; weekday: string; value: number; display: string; previous: number | null; previousDisplay: string | null; avg: number; avgDisplay: string };
export type ForecastChartPoint = { date: string; label: string; weekday: string; value: number; low: number; high: number; display: string; rangeDisplay: string };

export type ChartMetric = {
  id: 'revenue' | 'orders';
  label: string;
  unit: 'currency' | 'count';
  points: ChartPoint[];
  forecast: ForecastChartPoint[];
  ticks: Tick[];
  max: number;
  total: { display: string; previousDisplay: string; delta: DeltaView };
  best: { date: string; label: string; display: string };
  annotations: { date: string; label: string; tone: Tone }[];
  /** Texto para leitor de tela: o gráfico nunca é a única forma de ler os números. */
  summary: string;
};

export type StatusRow = { status: string; label: string; count: number; share: number; display: string };
export type FunnelStage = { id: string; label: string; count: number; fromPrevious: number | null; fromFirst: number };
export type HeatCell = { weekday: number; hour: number; value: number; level: 0 | 1 | 2 | 3 | 4; display: string };
export type TopService = { name: string; revenue: number; display: string; orders: number; share: number };
export type MechanicLoad = { name: string; active: number; capacity: number; utilization: number; tone: Tone; note: string };
export type AttentionItem = { id: string; severity: 'high' | 'medium' | 'low'; title: string; detail: string; orderNumber: number | null; href: string | null };
export type ActivityItem = { id: string; at: string; relative: string; kind: 'status' | 'payment' | 'message' | 'stock' | 'plate'; text: string; orderNumber: number | null };
export type Insight = { id: string; tone: Tone; title: string; body: string };

export type DashboardOverview = {
  range: DashboardRange;
  generatedAt: string;
  mock: true;
  periodLabel: string;
  previousLabel: string;
  headline: { title: string; subtitle: string };
  kpis: Kpi[];
  chart: { revenue: ChartMetric; orders: ChartMetric };
  status: StatusRow[];
  funnel: FunnelStage[];
  heatmap: { weekdays: string[]; hours: number[]; cells: HeatCell[]; peak: string };
  topServices: TopService[];
  mechanics: MechanicLoad[];
  attention: AttentionItem[];
  activity: ActivityItem[];
  insights: Insight[];
};
