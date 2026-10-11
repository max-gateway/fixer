'use client';

import { ArrowDownRight, ArrowUpRight, Minus } from 'lucide-react';
import { motion, useReducedMotion } from 'motion/react';
import { useId } from 'react';
import { Badge } from '@/components/ui/badge';
import { areaPath, smoothPath, type Pt } from '@/lib/chart-geometry';
import type { DeltaView, Kpi, Tone } from '@/lib/dashboard';
import { Card } from './card';

const VARIANT = { good: 'success', bad: 'danger', warn: 'warning', info: 'secondary' } as const;

/** Variação com ícone + sinal + cor: o estado nunca depende só da cor. */
export function DeltaBadge({ delta, tone }: { delta: DeltaView; tone: Tone }) {
  const Icon = delta.direction === 'up' ? ArrowUpRight : delta.direction === 'down' ? ArrowDownRight : Minus;
  return (
    <Badge variant={VARIANT[tone]} className="tabular gap-0.5">
      <Icon aria-hidden />
      {delta.label}
    </Badge>
  );
}

const W = 140;
const H = 40;

function Sparkline({ values }: { values: number[] }) {
  const gid = useId().replace(/[^a-zA-Z0-9]/g, '');
  const reduce = useReducedMotion();
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const pts: Pt[] = values.map((v, i) => [(i / Math.max(1, values.length - 1)) * W, H - 4 - ((v - min) / span) * (H - 10)]);
  const line = smoothPath(pts);
  const last = pts[pts.length - 1]!;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="h-10 w-full overflow-visible" preserveAspectRatio="none" aria-hidden>
      <defs>
        <linearGradient id={gid} x1="0" x2="0" y1="0" y2="1">
          <stop offset="0%" stopColor="var(--brand-primary)" stopOpacity="0.22" />
          <stop offset="100%" stopColor="var(--brand-primary)" stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={areaPath(line, pts[0]!, last, H)} fill={`url(#${gid})`} />
      <motion.path
        d={line}
        fill="none"
        stroke="var(--brand-primary)"
        strokeWidth="1.75"
        strokeLinecap="round"
        strokeLinejoin="round"
        vectorEffect="non-scaling-stroke"
        initial={{ pathLength: reduce ? 1 : 0 }}
        animate={{ pathLength: 1 }}
        transition={{ duration: reduce ? 0 : 1, ease: 'easeOut' }}
      />
      <path d={`M${last[0]},${last[1]}h0`} stroke="var(--brand-primary)" strokeWidth="6" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

export function KpiCard({ kpi, index }: { kpi: Kpi; index: number }) {
  return (
    <Card index={index} className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-sm font-medium text-muted-foreground">{kpi.label}</h3>
        <DeltaBadge delta={kpi.delta} tone={kpi.tone} />
      </div>
      <p className="tabular text-[1.75rem] font-semibold leading-none tracking-tight">{kpi.display}</p>
      <Sparkline values={kpi.sparkline} />
      <p className="text-xs text-muted-foreground">{kpi.hint}</p>
    </Card>
  );
}
