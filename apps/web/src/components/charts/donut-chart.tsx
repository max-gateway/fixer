'use client';

import { useEffect, useState, type ReactNode } from 'react';
import { cn } from '@/lib/utils';

export type DonutSlice = {
  key: string;
  name: string;
  /** Complemento do nome na legenda (quem recebe, como entra no custo...). */
  hint?: string;
  value: number;
};

// Cor por fatia, em ordem fixa: segue a posição na lista, nunca o tamanho. Nome e valor ficam na legenda, então a cor não carrega sozinha.
const STROKE = ['stroke-brand', 'stroke-sky-400', 'stroke-amber-500', 'stroke-slate-500', 'stroke-teal-600', 'stroke-slate-300', 'stroke-sky-600', 'stroke-rose-500'] as const;
const FILL = ['bg-brand', 'bg-sky-400', 'bg-amber-500', 'bg-slate-500', 'bg-teal-600', 'bg-slate-300', 'bg-sky-600', 'bg-rose-500'] as const;

const R = 46;
const C = 2 * Math.PI * R;
const GAP = 1.2; // folga entre fatias, em unidades do traçado (≈ 2px a 176px)

type Props = {
  slices: DonutSlice[];
  /** Texto grande no centro: o total, ou a fatia sob o mouse/foco. */
  centerValue: (slice: DonutSlice | null, total: number) => string;
  /** Texto pequeno sob o valor do centro. */
  centerLabel: (slice: DonutSlice | null) => string;
  /** Duas linhas da legenda de cada fatia. */
  row: (slice: DonutSlice, total: number) => { primary: string; secondary: string };
  /** Descrição do gráfico para leitor de tela. */
  label: string;
  /** Legenda embaixo da rosca, para painéis estreitos. */
  stacked?: boolean;
  /** Algo à direita do nome na legenda (etiqueta). */
  tag?: (slice: DonutSlice) => ReactNode;
};

/**
 * Rosca com legenda: o centro mostra o total (ou a fatia sob o mouse/foco) e a legenda traz os valores. Funciona por teclado
 * e tem a mesma informação em lista, então não depende de cor nem de mouse. Anima ao montar e respeita "reduzir movimento".
 */
export function DonutChart({ slices, centerValue, centerLabel, row, label, stacked = false, tag }: Props) {
  const total = slices.reduce((s, x) => s + x.value, 0);
  const [active, setActive] = useState<string | null>(null);
  const [drawn, setDrawn] = useState(false);
  useEffect(() => {
    const id = requestAnimationFrame(() => setDrawn(true));
    return () => cancelAnimationFrame(id);
  }, []);

  const current = slices.find((s) => s.key === active) ?? null;
  let offset = 0;
  const arcs = slices.map((s, i) => {
    const len = total > 0 ? (s.value / total) * C : 0;
    const arc = { ...s, i, start: offset, len: Math.max(len - GAP, 0.5) };
    offset += len;
    return arc;
  });

  return (
    <div className={cn('flex flex-col items-center gap-5', !stacked && 'sm:flex-row')}>
      <div className="relative size-44 shrink-0">
        <svg viewBox="0 0 120 120" role="img" aria-label={`${label}: ${slices.map((s) => `${s.name} ${row(s, total).primary}`).join(', ')}`} className="size-full -rotate-90">
          <circle cx="60" cy="60" r={R} fill="none" strokeWidth="14" className="stroke-muted" />
          {arcs.map((a) => (
            <circle
              key={a.key}
              cx="60"
              cy="60"
              r={R}
              fill="none"
              strokeWidth={active === a.key ? 17 : 14}
              strokeDasharray={`${drawn ? a.len : 0} ${C}`}
              strokeDashoffset={-a.start}
              className={cn(STROKE[a.i % STROKE.length], 'transition-[stroke-dasharray,stroke-width,opacity] duration-700 ease-out motion-reduce:transition-none', active && active !== a.key && 'opacity-30')}
              onMouseEnter={() => setActive(a.key)}
              onMouseLeave={() => setActive(null)}
            />
          ))}
        </svg>
        <div className="pointer-events-none absolute inset-0 grid place-items-center text-center">
          <div className="max-w-24 leading-tight">
            <p className="text-2xl font-semibold tabular-nums">{centerValue(current, total)}</p>
            <p className="text-xs text-muted-foreground">{centerLabel(current)}</p>
          </div>
        </div>
      </div>

      <ul className="w-full min-w-0 flex-1 space-y-1">
        {arcs.map((a) => {
          const r = row(a, total);
          return (
            <li key={a.key}>
              <button
                type="button"
                onMouseEnter={() => setActive(a.key)}
                onMouseLeave={() => setActive(null)}
                onFocus={() => setActive(a.key)}
                onBlur={() => setActive(null)}
                className={cn('flex w-full items-center gap-2.5 rounded-md px-2 py-1.5 text-left text-sm outline-none transition-colors focus-visible:ring-[3px] focus-visible:ring-ring/50', active === a.key ? 'bg-muted' : 'hover:bg-muted/60')}
              >
                <span aria-hidden className={cn('size-2.5 shrink-0 rounded-sm', FILL[a.i % FILL.length])} />
                <span className="min-w-0 flex-1">
                  {a.name} {a.hint && <span className="text-xs text-muted-foreground">{a.hint}</span>}
                  {tag?.(a)}
                </span>
                <span className="text-right tabular-nums">
                  <span className="block font-medium">{r.primary}</span>
                  <span className="block text-xs text-muted-foreground">{r.secondary}</span>
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
