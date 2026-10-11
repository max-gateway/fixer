import { describe, expect, it } from 'vitest';
import { apportion, delta, niceTicks, quantileLevels, seasonalForecast } from './analytics.js';
import { DashboardService } from './dashboard.service.js';

const NOW = new Date('2026-10-05T15:00:00Z');
const service = new DashboardService();

describe('analytics', () => {
  it('delta ignora variações abaixo de 0,5% e trata base zero', () => {
    expect(delta(100.2, 100).direction).toBe('flat');
    expect(delta(120, 100)).toEqual({ pct: 20, direction: 'up' });
    expect(delta(5, 0).pct).toBeNull();
  });

  it('niceTicks cobre o máximo com passos redondos', () => {
    const t = niceTicks(8300, 4);
    expect(t[0]).toBe(0);
    expect(t[t.length - 1]).toBeGreaterThanOrEqual(8300);
    expect(new Set(t.slice(1).map((v, i) => v - t[i]!)).size).toBe(1);
  });

  it('apportion preserva o total', () => {
    expect(apportion(101, [0.14, 0.1, 0.27, 0.08, 0.13, 0.25, 0.03]).reduce((a, b) => a + b)).toBe(101);
  });

  it('quantileLevels deixa zero como 0 e usa 1–4 no resto', () => {
    const l = quantileLevels([0, 1, 2, 3, 4, 100]);
    expect(l[0]).toBe(0);
    expect(Math.max(...l)).toBe(4);
    expect(Math.min(...l.slice(1))).toBeGreaterThanOrEqual(1);
  });

  it('previsão mantém a faixa ordenada e respeita o dia da semana', () => {
    const history = Array.from({ length: 28 }, (_, i) => ({ weekday: i % 7, value: (i % 7) * 100 + (i % 3) }));
    const [mon, sun] = seasonalForecast(history, [1, 0]);
    expect(mon!.low).toBeLessThanOrEqual(mon!.value);
    expect(mon!.value).toBeLessThanOrEqual(mon!.high);
    expect(mon!.value).toBeGreaterThan(sun!.value);
  });
});

describe('DashboardService', () => {
  it('é determinístico para o mesmo instante', () => {
    expect(service.overview('30d', NOW)).toEqual(service.overview('30d', NOW));
  });

  it.each([['7d', 7], ['30d', 30], ['90d', 90]] as const)('série de %s tem %i pontos e 7 de previsão', (range, n) => {
    const o = service.overview(range, NOW);
    expect(o.chart.revenue.points).toHaveLength(n);
    expect(o.chart.revenue.points.every((p) => p.previous !== null)).toBe(true);
    expect(o.chart.revenue.forecast).toHaveLength(7);
  });

  it('o eixo cobre todos os valores desenhados', () => {
    const { revenue } = service.overview('90d', NOW).chart;
    const top = Math.max(...revenue.points.map((p) => p.value), ...revenue.forecast.map((f) => f.high));
    expect(revenue.max).toBeGreaterThanOrEqual(top);
  });

  it('status e funil são coerentes com as ordens do período', () => {
    const o = service.overview('30d', NOW);
    const total = o.chart.orders.points.reduce((s, p) => s + p.value, 0);
    expect(o.status.reduce((s, r) => s + r.count, 0)).toBe(total);
    expect(o.topServices.reduce((s, r) => s + r.orders, 0)).toBe(total);
    expect(o.funnel[0]!.fromFirst).toBe(100);
    expect(o.funnel[3]!.count).toBeLessThanOrEqual(o.funnel[1]!.count);
  });

  it('entrega KPIs, insights e mapa de calor completos', () => {
    const o = service.overview('30d', NOW);
    expect(o.kpis.map((k) => k.id)).toEqual(['revenue', 'orders', 'ticket', 'approval']);
    expect(o.insights.length).toBeGreaterThanOrEqual(3);
    expect(o.heatmap.cells).toHaveLength(o.heatmap.weekdays.length * o.heatmap.hours.length);
    expect(o.headline.title).toBe('Boa tarde!');
  });
});
