'use client';

import { motion, useReducedMotion } from 'motion/react';
import { useState } from 'react';
import { Badge } from '@/components/ui/badge';
import type { DashboardOverview, HeatCell, Tone } from '@/lib/dashboard';
import { cn } from '@/lib/utils';

const mix = (pct: number) => `color-mix(in oklab, var(--brand-primary) ${pct}%, var(--card))`;

/** Barra horizontal que cresce da base; a largura é o dado, o rótulo vem do backend. */
function Bar({ pct, color = 'var(--brand-primary)', delay = 0 }: { pct: number; color?: string; delay?: number }) {
  const reduce = useReducedMotion();
  return (
    <div className="h-2.5 overflow-hidden rounded-full bg-muted">
      <motion.div
        className="h-full rounded-full"
        style={{ background: color }}
        initial={{ width: reduce ? `${pct}%` : 0 }}
        animate={{ width: `${pct}%` }}
        transition={{ duration: 0.7, delay, ease: [0.22, 1, 0.36, 1] }}
      />
    </div>
  );
}

export function StatusBars({ rows }: { rows: DashboardOverview['status'] }) {
  const max = Math.max(...rows.map((r) => r.share), 0.01);
  return (
    <ul className="space-y-3">
      {rows.map((r, i) => (
        <li key={r.status}>
          <div className="mb-1 flex items-baseline justify-between text-sm">
            <span>{r.label}</span>
            <span className="tabular text-xs text-muted-foreground">{r.display}</span>
          </div>
          <Bar pct={(r.share / max) * 100} color={r.status === 'CANCELLED' ? 'var(--muted-foreground)' : undefined} delay={i * 0.05} />
        </li>
      ))}
    </ul>
  );
}

export function Funnel({ stages }: { stages: DashboardOverview['funnel'] }) {
  return (
    <ol className="space-y-2">
      {stages.map((s, i) => (
        <li key={s.id}>
          {s.fromPrevious !== null && (
            <p className="tabular mb-1 pl-1 text-[11px] text-muted-foreground">↳ {s.fromPrevious.toString().replace('.', ',')}% da etapa anterior</p>
          )}
          <div className="flex items-center gap-3">
            <motion.div
              className={cn('flex h-9 items-center rounded-md px-3 text-sm font-semibold', i < 2 ? 'text-foreground' : 'text-white')}
              style={{ background: mix(55 + i * 15), minWidth: 56 }}
              initial={{ width: 0 }}
              animate={{ width: `${Math.max(s.fromFirst, 18)}%` }}
              transition={{ duration: 0.7, delay: i * 0.08, ease: [0.22, 1, 0.36, 1] }}
            >
              <span className="tabular">{s.count}</span>
            </motion.div>
            <span className="text-sm text-muted-foreground">{s.label}</span>
          </div>
        </li>
      ))}
    </ol>
  );
}

export function TopServices({ rows }: { rows: DashboardOverview['topServices'] }) {
  const max = Math.max(...rows.map((r) => r.revenue), 1);
  return (
    <ul className="space-y-3">
      {rows.map((r, i) => (
        <li key={r.name}>
          <div className="mb-1 flex items-baseline justify-between gap-3 text-sm">
            <span className="truncate">{r.name}</span>
            <span className="tabular shrink-0 font-medium">{r.display}</span>
          </div>
          <Bar pct={(r.revenue / max) * 100} delay={i * 0.05} />
          <p className="tabular mt-0.5 text-[11px] text-muted-foreground">
            {r.orders} ordens · {Math.round(r.share * 100)}% da receita
          </p>
        </li>
      ))}
    </ul>
  );
}

const TONE_BADGE: Record<Tone, 'success' | 'warning' | 'danger' | 'secondary'> = { good: 'success', warn: 'warning', bad: 'danger', info: 'secondary' };
const TONE_FILL: Record<Tone, string> = { good: 'var(--brand-primary)', warn: '#b45309', bad: '#b91c1c', info: 'var(--brand-primary)' };

export function MechanicsLoad({ rows }: { rows: DashboardOverview['mechanics'] }) {
  return (
    <ul className="space-y-4">
      {rows.map((m) => (
        <li key={m.name} className="flex items-center gap-3">
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium">{m.name}</p>
            {/* Um segmento por vaga de capacidade: leitura exata (3 de 5), sem precisar de eixo. */}
            <div className="mt-1.5 flex gap-1" role="img" aria-label={`${m.active} de ${m.capacity} vagas ocupadas`}>
              {Array.from({ length: Math.max(m.capacity, m.active) }, (_, i) => (
                <span key={i} className="h-2 flex-1 rounded-full" style={{ background: i < m.active ? TONE_FILL[m.tone] : 'var(--muted)' }} />
              ))}
            </div>
          </div>
          <Badge variant={TONE_BADGE[m.tone]} className="tabular shrink-0">
            {m.active}/{m.capacity} · {m.note}
          </Badge>
        </li>
      ))}
    </ul>
  );
}

const LEVEL_BG = ['var(--secondary)', mix(20), mix(40), mix(68), mix(100)];

export function Heatmap({ data }: { data: DashboardOverview['heatmap'] }) {
  const [hover, setHover] = useState<HeatCell | null>(null);
  // O backend entrega as células em ordem dia-da-semana × hora.
  const byDay = data.weekdays.map((_, row) => data.cells.slice(row * data.hours.length, (row + 1) * data.hours.length));
  return (
    <div>
      <div className="overflow-x-auto">
        <div className="min-w-[420px]" role="table" aria-label="Ocupação média do pátio por dia da semana e hora">
          <div className="mb-1 grid gap-1" style={{ gridTemplateColumns: `36px repeat(${data.hours.length}, 1fr)` }} role="row">
            <span />
            {data.hours.map((h) => (
              <span key={h} className="tabular text-center text-[10px] text-muted-foreground" role="columnheader">
                {h}h
              </span>
            ))}
          </div>
          {byDay.map((cells, row) => (
            <div key={data.weekdays[row]} className="mb-1 grid gap-1" style={{ gridTemplateColumns: `36px repeat(${data.hours.length}, 1fr)` }} role="row">
              <span className="self-center text-[11px] text-muted-foreground" role="rowheader">
                {data.weekdays[row]}
              </span>
              {cells.map((c) => (
                <button
                  key={c.hour}
                  type="button"
                  role="cell"
                  aria-label={c.display}
                  onPointerEnter={() => setHover(c)}
                  onFocus={() => setHover(c)}
                  onPointerLeave={() => setHover(null)}
                  onBlur={() => setHover(null)}
                  className={cn('aspect-square min-h-6 rounded-[5px] transition-transform hover:scale-110 hover:ring-2 hover:ring-foreground/40 focus-visible:scale-110', hover === c && 'ring-2 ring-foreground/40')}
                  style={{ background: LEVEL_BG[c.level] }}
                />
              ))}
            </div>
          ))}
        </div>
      </div>
      <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
        <p aria-live="polite" className="tabular min-h-4">
          {hover ? hover.display : <>Pico: <strong className="text-foreground">{data.peak}</strong></>}
        </p>
        <div className="flex items-center gap-1" aria-hidden>
          menos
          {LEVEL_BG.map((bg, i) => (
            <span key={i} className="size-3 rounded-[3px]" style={{ background: bg }} />
          ))}
          mais
        </div>
      </div>
    </div>
  );
}
