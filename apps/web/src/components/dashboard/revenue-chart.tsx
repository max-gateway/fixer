'use client';

import { motion, useReducedMotion } from 'motion/react';
import { useCallback, useEffect, useId, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { areaPath, bandPath, labelIndexes, smoothPath, type Pt } from '@/lib/chart-geometry';
import type { ChartMetric, DashboardOverview } from '@/lib/dashboard';
import { cn } from '@/lib/utils';
import { DeltaBadge } from './kpi-card';

const HEIGHT = 340;
const M = { top: 20, right: 16, bottom: 30, left: 58 };
const INK = 'var(--foreground)';
const MUTED = 'var(--muted-foreground)';
const GRID = 'var(--border)';
const BRAND = 'var(--brand-primary)';

type Layer = 'compare' | 'forecast' | 'avg';

export function RevenueChart({ chart, previousLabel }: { chart: DashboardOverview['chart']; previousLabel: string }) {
  const [metricId, setMetricId] = useState<'revenue' | 'orders'>('revenue');
  const [layers, setLayers] = useState<Record<Layer, boolean>>({ compare: true, forecast: true, avg: false });
  const [table, setTable] = useState(false);
  const metric = chart[metricId];

  const toggle = (l: Layer) => setLayers((s) => ({ ...s, [l]: !s[l] }));

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="space-y-1">
          <p className="text-sm text-muted-foreground">{metric.label} no período</p>
          <div className="flex flex-wrap items-baseline gap-3">
            <span className="tabular text-3xl font-semibold tracking-tight">{metric.total.display}</span>
            <DeltaBadge delta={metric.total.delta} tone={metric.total.delta.direction === 'down' ? 'bad' : 'good'} />
            <span className="text-xs text-muted-foreground">
              {previousLabel}: <span className="tabular">{metric.total.previousDisplay}</span>
            </span>
          </div>
        </div>
        <Tabs value={metricId} onValueChange={(v) => setMetricId(v as 'revenue' | 'orders')}>
          <TabsList aria-label="Métrica do gráfico">
            <TabsTrigger value="revenue">Receita</TabsTrigger>
            <TabsTrigger value="orders">Ordens</TabsTrigger>
          </TabsList>
        </Tabs>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <LayerToggle on={layers.compare} onClick={() => toggle('compare')} swatch={<Swatch dashed color={MUTED} />}>
          Período anterior
        </LayerToggle>
        <LayerToggle on={layers.avg} onClick={() => toggle('avg')} swatch={<Swatch color={INK} />}>
          Média móvel 7d
        </LayerToggle>
        <LayerToggle on={layers.forecast} onClick={() => toggle('forecast')} swatch={<Swatch dashed color={BRAND} />}>
          Previsão 7d
        </LayerToggle>
        <Button variant="ghost" size="xs" className="ml-auto" aria-pressed={table} onClick={() => setTable((t) => !t)}>
          {table ? 'Ver gráfico' : 'Ver tabela'}
        </Button>
      </div>

      {table ? <DataTable metric={metric} /> : <Plot key={metricId} metric={metric} layers={layers} previousLabel={previousLabel} />}
    </div>
  );
}

function LayerToggle({ on, onClick, swatch, children }: { on: boolean; onClick: () => void; swatch: React.ReactNode; children: React.ReactNode }) {
  return (
    <button
      type="button"
      aria-pressed={on}
      onClick={onClick}
      className={cn(
        'inline-flex h-7 items-center gap-2 rounded-full border px-3 text-xs font-medium transition-colors',
        on ? 'border-foreground/20 bg-card text-foreground shadow-xs' : 'border-transparent bg-muted text-muted-foreground hover:text-foreground',
      )}
    >
      {swatch}
      {children}
    </button>
  );
}

function Swatch({ color, dashed }: { color: string; dashed?: boolean }) {
  return (
    <svg width="16" height="8" aria-hidden>
      <line x1="0" x2="16" y1="4" y2="4" stroke={color} strokeWidth="2" strokeDasharray={dashed ? '3 3' : undefined} strokeLinecap="round" />
    </svg>
  );
}

function Plot({ metric, layers, previousLabel }: { metric: ChartMetric; layers: Record<Layer, boolean>; previousLabel: string }) {
  const uid = useId().replace(/[^a-zA-Z0-9]/g, '');
  const reduce = useReducedMotion();
  const wrapRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(720);
  const [active, setActive] = useState<number | null>(null);
  const showForecast = layers.forecast;

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setWidth(Math.max(280, Math.floor(e!.contentRect.width))));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const { points, forecast } = metric;
  const total = points.length + (showForecast ? forecast.length : 0);
  const innerW = width - M.left - M.right;
  const innerH = HEIGHT - M.top - M.bottom;
  const x = useCallback((i: number) => M.left + (total <= 1 ? 0 : (i / (total - 1)) * innerW), [total, innerW]);
  const y = useCallback((v: number) => M.top + innerH - (v / metric.max) * innerH, [innerH, metric.max]);

  const geo = useMemo(() => {
    const cur: Pt[] = points.map((p, i) => [x(i), y(p.value)]);
    const prev: Pt[] = points.flatMap((p, i) => (p.previous === null ? [] : [[x(i), y(p.previous)] as Pt]));
    const avg: Pt[] = points.map((p, i) => [x(i), y(p.avg)]);
    const last = points.length - 1;
    const fc: Pt[] = [cur[last]!, ...forecast.map((f, i) => [x(last + 1 + i), y(f.value)] as Pt)];
    const hi: Pt[] = [cur[last]!, ...forecast.map((f, i) => [x(last + 1 + i), y(f.high)] as Pt)];
    const lo: Pt[] = [cur[last]!, ...forecast.map((f, i) => [x(last + 1 + i), y(f.low)] as Pt)];
    const line = smoothPath(cur);
    return {
      cur,
      line,
      area: areaPath(line, cur[0]!, cur[last]!, M.top + innerH),
      prev: smoothPath(prev),
      avg: smoothPath(avg),
      fc: smoothPath(fc),
      band: bandPath(hi, lo),
    };
  }, [points, forecast, x, y, innerH]);

  const labels = useMemo(() => {
    const all = [...points, ...(showForecast ? forecast : [])];
    return labelIndexes(all.length, innerW / Math.max(1, all.length - 1), 64).map((i) => ({ i, text: all[i]!.label }));
  }, [points, forecast, showForecast, innerW]);

  const at = (i: number) => (i < points.length ? { kind: 'actual' as const, p: points[i]! } : { kind: 'forecast' as const, f: forecast[i - points.length]! });

  const onMove = (e: PointerEvent<SVGRectElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    const t = (e.clientX - r.left) / r.width;
    setActive(Math.min(total - 1, Math.max(0, Math.round(t * (total - 1)))));
  };

  const onKey = (e: KeyboardEvent) => {
    const step = { ArrowRight: 1, ArrowLeft: -1 }[e.key as 'ArrowRight' | 'ArrowLeft'];
    if (step) {
      e.preventDefault();
      setActive((a) => Math.min(total - 1, Math.max(0, (a ?? (step > 0 ? -1 : total)) + step)));
    } else if (e.key === 'Home') setActive(0);
    else if (e.key === 'End') setActive(total - 1);
    else if (e.key === 'Escape') setActive(null);
  };

  const bestIdx = points.findIndex((p) => p.date === metric.best.date);
  const annotationAt = (date: string) => metric.annotations.find((a) => a.date === date);
  const cur = active === null ? null : at(active);
  const gradientId = `fill-${uid}`;
  const clipId = `clip-${uid}`;

  return (
    <div ref={wrapRef} className="relative">
      <svg
        width={width}
        height={HEIGHT}
        role="group"
        aria-label={`Gráfico de ${metric.label.toLowerCase()}. ${metric.summary} Use as setas para percorrer os dias.`}
        tabIndex={0}
        onKeyDown={onKey}
        onBlur={() => setActive(null)}
        className="block overflow-visible rounded-md outline-none focus-visible:ring-[3px] focus-visible:ring-ring/40"
      >
        <defs>
          <linearGradient id={gradientId} x1="0" x2="0" y1="0" y2="1">
            <stop offset="0%" stopColor={BRAND} stopOpacity="0.28" />
            <stop offset="100%" stopColor={BRAND} stopOpacity="0" />
          </linearGradient>
          <clipPath id={clipId}>
            <motion.rect
              x={M.left - 2}
              y={0}
              height={HEIGHT}
              initial={{ width: reduce ? width : 0 }}
              animate={{ width }}
              transition={{ duration: reduce ? 0 : 0.9, ease: [0.22, 1, 0.36, 1] }}
            />
          </clipPath>
        </defs>

        {/* Grade e eixo Y: recessivos, a linha de base é a única um pouco mais firme. */}
        {metric.ticks.map((t) => (
          <g key={t.value}>
            <line x1={M.left} x2={width - M.right} y1={y(t.value)} y2={y(t.value)} stroke={GRID} strokeWidth={t.value === 0 ? 1.25 : 1} strokeDasharray={t.value === 0 ? undefined : '2 4'} />
            <text x={M.left - 10} y={y(t.value)} dy="0.32em" textAnchor="end" fontSize="11" fill={MUTED} className="tabular">
              {t.label}
            </text>
          </g>
        ))}

        {showForecast && (
          <g>
            <rect x={x(points.length - 1)} y={M.top} width={Math.max(0, x(total - 1) - x(points.length - 1))} height={innerH} fill="var(--secondary)" opacity="0.55" />
            <text x={x(points.length - 1) + 8} y={M.top + 12} fontSize="10.5" fontWeight="600" fill={MUTED} letterSpacing="0.04em">
              PREVISÃO
            </text>
          </g>
        )}

        <g clipPath={`url(#${clipId})`}>
          {layers.compare && geo.prev && <path d={geo.prev} fill="none" stroke={MUTED} strokeOpacity="0.75" strokeWidth="1.5" strokeDasharray="4 4" strokeLinecap="round" />}
          <path d={geo.area} fill={`url(#${gradientId})`} />
          {layers.avg && <path d={geo.avg} fill="none" stroke={INK} strokeOpacity="0.8" strokeWidth="1.5" strokeLinejoin="round" />}
          <path d={geo.line} fill="none" stroke={BRAND} strokeWidth="2.25" strokeLinejoin="round" strokeLinecap="round" />
          {showForecast && (
            <>
              <path d={geo.band} fill={BRAND} fillOpacity="0.1" />
              <path d={geo.fc} fill="none" stroke={BRAND} strokeWidth="2" strokeDasharray="5 5" strokeLinecap="round" />
            </>
          )}
        </g>

        {/* Anotações: losango no dia atípico; o texto está no tooltip e na tabela. */}
        {points.map((p, i) => {
          const a = annotationAt(p.date);
          if (!a) return null;
          return <Diamond key={p.date} cx={x(i)} cy={y(p.value)} tone={a.tone} />;
        })}
        {bestIdx >= 0 && (
          <g>
            <circle cx={x(bestIdx)} cy={y(points[bestIdx]!.value)} r="4.5" fill={BRAND} stroke="var(--card)" strokeWidth="2" />
            <text x={Math.min(Math.max(x(bestIdx), M.left + 36), width - M.right - 36)} y={y(points[bestIdx]!.value) - 11} textAnchor="middle" fontSize="11" fontWeight="600" fill={INK} className="tabular" paintOrder="stroke" stroke="var(--card)" strokeWidth="3">
              Melhor dia · {metric.best.display}
            </text>
          </g>
        )}

        {labels.map(({ i, text }) => (
          <text key={i} x={x(i)} y={HEIGHT - 8} textAnchor={i === 0 ? 'start' : i === total - 1 ? 'end' : 'middle'} fontSize="11" fill={MUTED}>
            {text}
          </text>
        ))}

        {active !== null && cur && (
          <g pointerEvents="none">
            <line x1={x(active)} x2={x(active)} y1={M.top} y2={M.top + innerH} stroke={INK} strokeOpacity="0.35" strokeWidth="1" />
            {cur.kind === 'actual' && cur.p.previous !== null && layers.compare && (
              <circle cx={x(active)} cy={y(cur.p.previous)} r="3.5" fill={MUTED} stroke="var(--card)" strokeWidth="2" />
            )}
            <circle cx={x(active)} cy={y(cur.kind === 'actual' ? cur.p.value : cur.f.value)} r="5.5" fill={BRAND} stroke="var(--card)" strokeWidth="2.5" />
          </g>
        )}

        {/* Alvo de ponteiro do tamanho de toda a área: o leitor mira numa data, não numa linha de 2px. */}
        <rect x={M.left} y={M.top} width={innerW} height={innerH} fill="transparent" onPointerMove={onMove} onPointerDown={onMove} onPointerLeave={() => setActive(null)} />
      </svg>

      {active !== null && cur && (
        <Tooltip metric={metric} cur={cur} left={x(active)} width={width} previousLabel={previousLabel} annotation={cur.kind === 'actual' ? annotationAt(cur.p.date) : undefined} showCompare={layers.compare} showAvg={layers.avg} />
      )}
      <p className="sr-only" aria-live="polite">
        {cur ? (cur.kind === 'actual' ? `${cur.p.label}: ${cur.p.display}` : `${cur.f.label}, previsto: ${cur.f.display}`) : ''}
      </p>
    </div>
  );
}

function Diamond({ cx, cy, tone }: { cx: number; cy: number; tone: string }) {
  const fill = tone === 'good' ? '#047857' : '#b45309';
  return <path d={`M${cx},${cy - 6}L${cx + 6},${cy}L${cx},${cy + 6}L${cx - 6},${cy}Z`} fill={fill} stroke="var(--card)" strokeWidth="2" />;
}

type Cur = { kind: 'actual'; p: ChartMetric['points'][number] } | { kind: 'forecast'; f: ChartMetric['forecast'][number] };

function Tooltip({ metric, cur, left, width, previousLabel, annotation, showCompare, showAvg }: { metric: ChartMetric; cur: Cur; left: number; width: number; previousLabel: string; annotation?: ChartMetric['annotations'][number]; showCompare: boolean; showAvg: boolean }) {
  const flip = left > width * 0.62;
  return (
    <div
      role="tooltip"
      className="pointer-events-none absolute top-2 z-10 w-52 rounded-lg border bg-card/95 p-3 text-xs shadow-lg backdrop-blur-sm"
      style={{ left: flip ? undefined : left + 14, right: flip ? width - left + 14 : undefined }}
    >
      <p className="mb-1.5 font-medium text-muted-foreground">
        {cur.kind === 'actual' ? cur.p.weekday : cur.f.weekday}, {cur.kind === 'actual' ? cur.p.label : cur.f.label}
        {cur.kind === 'forecast' && <Badge variant="secondary" className="ml-2 px-1.5 py-0 text-[10px]">previsto</Badge>}
      </p>
      <Row stroke={BRAND} value={cur.kind === 'actual' ? cur.p.display : cur.f.display} label={cur.kind === 'actual' ? metric.label : 'Estimativa'} strong />
      {cur.kind === 'forecast' && <p className="mt-1 text-muted-foreground tabular">Faixa provável: {cur.f.rangeDisplay}</p>}
      {cur.kind === 'actual' && showCompare && cur.p.previousDisplay && <Row stroke={MUTED} dashed value={cur.p.previousDisplay} label={previousLabel.replace('vs. ', '')} />}
      {cur.kind === 'actual' && showAvg && <Row stroke={INK} value={cur.p.avgDisplay} label="Média móvel 7d" />}
      {annotation && (
        <p className={cn('mt-2 rounded-md px-2 py-1 font-medium', annotation.tone === 'good' ? 'bg-emerald-100 text-emerald-800' : 'bg-amber-100 text-amber-900')}>{annotation.label}</p>
      )}
    </div>
  );
}

function Row({ stroke, value, label, strong, dashed }: { stroke: string; value: string; label: string; strong?: boolean; dashed?: boolean }) {
  return (
    <div className="mt-1 flex items-center gap-2">
      <Swatch color={stroke} dashed={dashed} />
      <span className={cn('tabular', strong ? 'text-sm font-semibold text-foreground' : 'font-medium')}>{value}</span>
      <span className="truncate text-muted-foreground">{label}</span>
    </div>
  );
}

function DataTable({ metric }: { metric: ChartMetric }) {
  return (
    <ScrollArea className="h-[340px] rounded-md border bg-card">
      <table className="w-full text-left text-sm">
        <caption className="sr-only">{metric.summary}</caption>
        <thead className="sticky top-0 bg-muted text-xs text-muted-foreground">
          <tr>
            <th className="px-4 py-2 font-medium">Dia</th>
            <th className="px-4 py-2 text-right font-medium">{metric.label}</th>
            <th className="px-4 py-2 text-right font-medium">Período anterior</th>
            <th className="px-4 py-2 font-medium">Nota</th>
          </tr>
        </thead>
        <tbody>
          {[...metric.points].reverse().map((p) => (
            <tr key={p.date} className="border-t">
              <td className="px-4 py-1.5">{p.weekday}, {p.label}</td>
              <td className="tabular px-4 py-1.5 text-right font-medium">{p.display}</td>
              <td className="tabular px-4 py-1.5 text-right text-muted-foreground">{p.previousDisplay ?? '—'}</td>
              <td className="px-4 py-1.5 text-xs text-muted-foreground">{metric.annotations.find((a) => a.date === p.date)?.label ?? ''}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </ScrollArea>
  );
}
