import { Injectable } from '@nestjs/common';
import {
  apportion,
  delta as computeDelta,
  mean,
  movingAverage,
  niceTicks,
  outliers,
  quantileLevels,
  seasonalForecast,
  seeded,
  sum,
} from './analytics.js';
import {
  axisMoney,
  count,
  dayLabel,
  isoDay,
  listJoin,
  money,
  moneyCompact,
  percent,
  signed,
  WEEKDAYS_LONG,
  WEEKDAYS_PT,
  weekdayShort,
} from './format.js';
import {
  ACTIVITY,
  ATTENTION,
  DAY_MS,
  dailyHistory,
  MECHANICS,
  SERVICES,
  STATUS_WEIGHTS,
  type DayMetric,
} from './mock-data.js';
import type {
  ChartMetric,
  DashboardOverview,
  DashboardRange,
  DeltaView,
  FunnelStage,
  HeatCell,
  Insight,
  Kpi,
  MechanicLoad,
  Tone,
} from './types.js';

const DAYS: Record<DashboardRange, number> = { '7d': 7, '30d': 30, '90d': 90 };
const HEAT_HOURS = [8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18];
const HEAT_WEEKDAYS = [1, 2, 3, 4, 5, 6]; // seg..sáb

/**
 * Tudo que o dashboard mostra é calculado aqui; a tela só desenha. Hoje a fonte é um gerador
 * determinístico (mock-data.ts) — trocar por consultas ao Prisma não muda o contrato (types.ts).
 */
@Injectable()
export class DashboardService {
  overview(range: DashboardRange, now: Date = new Date()): DashboardOverview {
    const n = DAYS[range];
    const history = dailyHistory(now);
    const cur = history.slice(-n);
    const prev = history.slice(-2 * n, -n);

    const revenue = this.metric('revenue', 'Receita', 'currency', cur, prev, history);
    const orders = this.metric('orders', 'Ordens abertas', 'count', cur, prev, history);
    const mechanics = this.mechanics(now);
    const attention = ATTENTION.map((a) => ({
      ...a,
      href: a.orderNumber ? `/ordens?q=${a.orderNumber}` : null,
    }));
    const high = attention.filter((a) => a.severity === 'high').length;

    return {
      range,
      generatedAt: now.toISOString(),
      mock: true,
      periodLabel: this.periodLabel(cur, n),
      previousLabel: `vs. ${dayLabel(prev[0]!.date)} – ${dayLabel(prev[prev.length - 1]!.date)}`,
      headline: {
        title: `${this.greeting(now)}!`,
        subtitle:
          high > 0
            ? `${high} ${high === 1 ? 'item pede' : 'itens pedem'} atenção agora. ${count(mechanics.reduce((s, m) => s + m.active, 0))} veículos estão no pátio.`
            : 'Tudo em dia. Nenhum item crítico no momento.',
      },
      kpis: this.kpis(cur, prev, n),
      chart: { revenue, orders },
      status: this.status(cur),
      funnel: this.funnel(cur),
      heatmap: this.heatmap(),
      topServices: this.topServices(cur),
      mechanics,
      attention,
      activity: ACTIVITY.map((a) => ({
        id: a.id,
        at: new Date(now.getTime() - a.minutesAgo * 60_000).toISOString(),
        relative: a.minutesAgo < 60 ? `há ${a.minutesAgo} min` : `há ${Math.round(a.minutesAgo / 60)} h`,
        kind: a.kind,
        text: a.text,
        orderNumber: a.orderNumber,
      })),
      insights: this.insights(cur, history, revenue, mechanics),
    };
  }

  // ---------------------------------------------------------------- KPIs

  private kpis(cur: DayMetric[], prev: DayMetric[], n: number): Kpi[] {
    const rev = [sum(cur.map((d) => d.revenue)), sum(prev.map((d) => d.revenue))] as const;
    const ord = [sum(cur.map((d) => d.orders)), sum(prev.map((d) => d.orders))] as const;
    const ticket = [rev[0] / (ord[0] || 1), rev[1] / (ord[1] || 1)] as const;
    const approval = [
      (sum(cur.map((d) => d.approved)) / (sum(cur.map((d) => d.quotes)) || 1)) * 100,
      (sum(prev.map((d) => d.approved)) / (sum(prev.map((d) => d.quotes)) || 1)) * 100,
    ] as const;
    const approvalPp = approval[0] - approval[1];
    const dir = Math.abs(approvalPp) < 0.5 ? 'flat' : approvalPp > 0 ? 'up' : 'down';

    return [
      {
        id: 'revenue',
        label: 'Receita',
        display: moneyCompact(rev[0]),
        delta: this.deltaView(rev[0], rev[1]),
        tone: this.tone(computeDelta(rev[0], rev[1]).direction),
        sparkline: cur.map((d) => d.revenue),
        hint: `Média de ${money(rev[0] / n)} por dia`,
      },
      {
        id: 'orders',
        label: 'Ordens abertas',
        display: count(ord[0]),
        delta: this.deltaView(ord[0], ord[1]),
        tone: this.tone(computeDelta(ord[0], ord[1]).direction),
        sparkline: cur.map((d) => d.orders),
        hint: `${(ord[0] / n).toFixed(1).replace('.', ',')} por dia`,
      },
      {
        id: 'ticket',
        label: 'Ticket médio',
        display: money(ticket[0]),
        delta: this.deltaView(ticket[0], ticket[1]),
        tone: this.tone(computeDelta(ticket[0], ticket[1]).direction),
        sparkline: cur.map((d) => (d.orders ? d.revenue / d.orders : 0)),
        hint: 'Receita ÷ ordens abertas',
      },
      {
        id: 'approval',
        label: 'Aprovação de orçamentos',
        display: percent(approval[0], 1),
        delta: { pct: Math.round(approvalPp * 10) / 10, direction: dir, label: `${signed(approvalPp)} p.p.` },
        tone: this.tone(dir),
        sparkline: cur.map((d) => (d.quotes ? (d.approved / d.quotes) * 100 : 0)),
        hint: 'Orçamentos que viraram OS',
      },
    ];
  }

  // ---------------------------------------------------------------- Gráfico

  private metric(
    id: 'revenue' | 'orders',
    label: string,
    unit: 'currency' | 'count',
    cur: DayMetric[],
    prev: DayMetric[],
    history: DayMetric[],
  ): ChartMetric {
    const pick = (d: DayMetric) => d[id];
    const fmt = unit === 'currency' ? money : count;
    const values = cur.map(pick);
    const avg = movingAverage(values, 7);
    const today = cur[cur.length - 1]!.date.getTime();

    const nextDates = Array.from({ length: 7 }, (_, i) => new Date(today + (i + 1) * DAY_MS));
    const fc = seasonalForecast(
      history.map((d) => ({ weekday: d.weekday, value: pick(d) })),
      nextDates.map((d) => d.getUTCDay()),
    );

    const max = Math.max(...values, ...prev.map(pick), ...fc.map((f) => f.high));
    const ticks = niceTicks(max, 4);
    const total = sum(values);
    const prevTotal = sum(prev.map(pick));
    const bestIdx = values.indexOf(Math.max(...values));
    const best = cur[bestIdx]!;
    const d = this.deltaView(total, prevTotal);

    // Dias atípicos viram anotações; no máximo 3, os mais extremos.
    const ratios = this.weekdayRatios(cur, history, pick);
    const annotations = outliers(ratios, 2)
      .sort((a, b) => Math.abs(ratios[b]! - 1) - Math.abs(ratios[a]! - 1))
      .slice(0, 3)
      .map((i) => ({
        date: isoDay(cur[i]!.date),
        label: ratios[i]! > 1 ? 'Pico atípico' : 'Queda atípica',
        tone: (ratios[i]! > 1 ? 'good' : 'warn') as Tone,
      }));

    return {
      id,
      label,
      unit,
      points: cur.map((day, i) => {
        const p = prev[i];
        return {
          date: isoDay(day.date),
          label: dayLabel(day.date),
          weekday: weekdayShort(day.date),
          value: values[i]!,
          display: fmt(values[i]!),
          previous: p ? pick(p) : null,
          previousDisplay: p ? fmt(pick(p)) : null,
          avg: Math.round(avg[i]! * 100) / 100,
          avgDisplay: fmt(avg[i]!),
        };
      }),
      forecast: nextDates.map((date, i) => ({
        date: isoDay(date),
        label: dayLabel(date),
        weekday: weekdayShort(date),
        value: Math.round(fc[i]!.value),
        low: Math.round(fc[i]!.low),
        high: Math.round(fc[i]!.high),
        display: fmt(fc[i]!.value),
        rangeDisplay: `${fmt(fc[i]!.low)} – ${fmt(fc[i]!.high)}`,
      })),
      ticks: ticks.map((value) => ({ value, label: unit === 'currency' ? axisMoney(value) : count(value) })),
      max: ticks[ticks.length - 1]!,
      total: { display: fmt(total), previousDisplay: fmt(prevTotal), delta: d },
      best: { date: isoDay(best.date), label: `${weekdayShort(best.date)}, ${dayLabel(best.date)}`, display: fmt(pick(best)) },
      annotations,
      summary: `${label} em ${cur.length} dias: ${fmt(total)} (${d.label} vs. período anterior). Melhor dia: ${dayLabel(best.date)}, ${fmt(pick(best))}.`,
    };
  }

  // ---------------------------------------------------------------- Distribuições

  private status(cur: DayMetric[]) {
    const total = sum(cur.map((d) => d.orders));
    const counts = apportion(total, STATUS_WEIGHTS.map((s) => s.weight));
    return STATUS_WEIGHTS.map((s, i) => ({
      status: s.status,
      label: s.label,
      count: counts[i]!,
      share: total ? counts[i]! / total : 0,
      display: `${count(counts[i]!)} · ${percent((counts[i]! / (total || 1)) * 100)}`,
    }));
  }

  private funnel(cur: DayMetric[]): FunnelStage[] {
    const stages = [
      { id: 'quotes', label: 'Orçamentos', count: sum(cur.map((d) => d.quotes)) },
      { id: 'approved', label: 'Aprovadas', count: sum(cur.map((d) => d.approved)) },
      { id: 'completed', label: 'Concluídas', count: sum(cur.map((d) => d.completed)) },
      { id: 'delivered', label: 'Entregues', count: sum(cur.map((d) => d.delivered)) },
    ];
    const first = stages[0]!.count || 1;
    return stages.map((s, i) => ({
      ...s,
      fromPrevious: i === 0 ? null : Math.round((s.count / (stages[i - 1]!.count || 1)) * 1000) / 10,
      fromFirst: Math.round((s.count / first) * 1000) / 10,
    }));
  }

  /** Ocupação média do pátio por dia da semana × hora. Padrão de uso: não depende do período. */
  private heatmap(): DashboardOverview['heatmap'] {
    const hourCurve = (h: number) => (h === 12 || h === 13 ? 0.45 : h >= 17 ? 0.55 : 1) * (h >= 9 && h <= 11 ? 1.15 : h >= 14 && h <= 16 ? 1.05 : 0.8);
    const dayCurve = [0, 1.05, 1.1, 1.0, 0.95, 1.2, 0.5];
    const raw = HEAT_WEEKDAYS.flatMap((weekday) =>
      HEAT_HOURS.map((hour) => {
        const r = seeded(weekday * 97 + hour)();
        return { weekday, hour, value: Math.round(6.5 * dayCurve[weekday]! * hourCurve(hour) * (0.8 + r * 0.4)) };
      }),
    );
    const levels = quantileLevels(raw.map((c) => c.value));
    const cells: HeatCell[] = raw.map((c, i) => ({
      ...c,
      level: levels[i] as HeatCell['level'],
      display: `${WEEKDAYS_PT[c.weekday]}, ${c.hour}h: ${c.value} ${c.value === 1 ? 'veículo' : 'veículos'} em média`,
    }));
    const peak = raw.reduce((a, b) => (b.value > a.value ? b : a));
    return {
      weekdays: HEAT_WEEKDAYS.map((w) => WEEKDAYS_PT[w]!),
      hours: HEAT_HOURS,
      cells,
      peak: `${WEEKDAYS_LONG[peak.weekday]} às ${peak.hour}h`,
    };
  }

  private topServices(cur: DayMetric[]) {
    const total = sum(cur.map((d) => d.orders));
    const counts = apportion(total, SERVICES.map((s) => s.weight));
    const rows = SERVICES.map((s, i) => ({ name: s.name, orders: counts[i]!, revenue: counts[i]! * s.avg }));
    const all = sum(rows.map((r) => r.revenue)) || 1;
    return rows
      .sort((a, b) => b.revenue - a.revenue)
      .map((r) => ({ ...r, display: moneyCompact(r.revenue), share: r.revenue / all }));
  }

  private mechanics(now: Date): MechanicLoad[] {
    const rand = seeded(Math.floor(now.getTime() / 3_600_000)); // muda de hora em hora
    return MECHANICS.map((m) => {
      const active = Math.min(m.capacity + 1, Math.max(0, Math.round(m.capacity * (0.35 + rand() * 0.75))));
      const utilization = active / m.capacity;
      const [tone, note]: [Tone, string] =
        utilization > 1 ? ['bad', 'Acima da capacidade'] : utilization >= 0.8 ? ['warn', 'Quase no limite'] : utilization < 0.4 ? ['info', 'Pode receber mais'] : ['good', 'Carga saudável'];
      return { name: m.name, active, capacity: m.capacity, utilization: Math.round(utilization * 100) / 100, tone, note };
    });
  }

  // ---------------------------------------------------------------- Insights

  private insights(cur: DayMetric[], history: DayMetric[], revenue: ChartMetric, mechanics: MechanicLoad[]): Insight[] {
    const out: Insight[] = [];

    const byWeekday = new Map<number, number>();
    cur.forEach((d) => byWeekday.set(d.weekday, (byWeekday.get(d.weekday) ?? 0) + d.revenue));
    const total = sum(cur.map((d) => d.revenue)) || 1;
    const [bestDay, bestRev] = [...byWeekday].reduce((a, b) => (b[1] > a[1] ? b : a));
    out.push({
      id: 'best-weekday',
      tone: 'info',
      title: `${WEEKDAYS_LONG[bestDay]![0]!.toUpperCase()}${WEEKDAYS_LONG[bestDay]!.slice(1)} concentra a receita`,
      body: `${percent((bestRev / total) * 100)} do faturamento do período vem desse dia. Vale reforçar a equipe e o estoque nele.`,
    });

    const nextWeek = sum(revenue.forecast.map((f) => f.value));
    const lastWeek = sum(cur.slice(-7).map((d) => d.revenue));
    const fd = computeDelta(nextWeek, lastWeek);
    out.push({
      id: 'forecast',
      tone: fd.direction === 'down' ? 'warn' : 'good',
      title: `Próximos 7 dias: ${moneyCompact(nextWeek)} previstos`,
      body:
        fd.pct === null
          ? 'Sem base suficiente para comparar.'
          : `${fd.direction === 'down' ? 'Queda' : 'Alta'} de ${Math.abs(fd.pct).toFixed(1).replace('.', ',')}% sobre a última semana, segundo a sazonalidade das 4 semanas anteriores.`,
    });

    const ratios = this.weekdayRatios(cur, history, (d) => d.revenue);
    const [top] = outliers(ratios, 2)
      .filter((i) => ratios[i]! > 1)
      .sort((a, b) => ratios[b]! - ratios[a]!);
    if (top !== undefined) {
      out.push({
        id: 'outlier',
        tone: 'good',
        title: `Dia atípico em ${dayLabel(cur[top]!.date)}`,
        body: `${money(cur[top]!.revenue)} de receita, ${ratios[top]!.toFixed(1).replace('.', ',')}× o normal para ${WEEKDAYS_LONG[cur[top]!.weekday]}. Provável serviço de frota ou seguradora.`,
      });
    }

    const over = mechanics.filter((m) => m.utilization >= 0.8).map((m) => m.name.split(' ')[0]);
    out.push({
      id: 'capacity',
      tone: over.length ? 'warn' : 'good',
      title: over.length ? `${listJoin(over as string[])} ${over.length > 1 ? 'estão' : 'está'} no limite` : 'Capacidade equilibrada',
      body: over.length
        ? 'Redistribua ordens novas para quem tem folga antes de aprovar mais orçamentos.'
        : 'Nenhum mecânico acima de 80% da capacidade agora.',
    });

    return out;
  }

  // ---------------------------------------------------------------- Helpers

  /** Valor do dia ÷ média histórica do mesmo dia da semana: domingo baixo é normal, não anomalia. */
  private weekdayRatios(cur: DayMetric[], history: DayMetric[], pick: (d: DayMetric) => number): number[] {
    const avg = new Map<number, number>();
    for (let wd = 0; wd < 7; wd++) avg.set(wd, mean(history.filter((d) => d.weekday === wd).map(pick)));
    return cur.map((d) => (avg.get(d.weekday)! > 0 ? pick(d) / avg.get(d.weekday)! : 1));
  }

  private deltaView(current: number, previous: number): DeltaView {
    const d = computeDelta(current, previous);
    return { ...d, label: d.pct === null ? 'novo' : `${signed(d.pct)}%` };
  }

  private tone(direction: 'up' | 'down' | 'flat'): Tone {
    return direction === 'up' ? 'good' : direction === 'down' ? 'bad' : 'info';
  }

  private periodLabel(cur: DayMetric[], n: number): string {
    return `Últimos ${n} dias · ${dayLabel(cur[0]!.date)} – ${dayLabel(cur[cur.length - 1]!.date)}`;
  }

  private greeting(now: Date): string {
    const hour = (now.getUTCHours() + 21) % 24; // America/Sao_Paulo (UTC-3)
    return hour < 12 ? 'Bom dia' : hour < 18 ? 'Boa tarde' : 'Boa noite';
  }
}
