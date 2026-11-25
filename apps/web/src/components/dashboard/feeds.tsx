import { ChevronRight, Lightbulb, MessageCircle, Package, ScanLine, Sparkles, TriangleAlert, Wallet, Wrench } from 'lucide-react';
import Link from 'next/link';
import type { ReactNode } from 'react';
import type { ActivityItem, AttentionItem, Insight, Tone } from '@/lib/dashboard';
import { cn } from '@/lib/utils';

const SEVERITY = {
  high: { label: 'Urgente', dot: 'bg-red-600', chip: 'bg-red-100 text-red-800' },
  medium: { label: 'Hoje', dot: 'bg-amber-500', chip: 'bg-amber-100 text-amber-900' },
  low: { label: 'Acompanhar', dot: 'bg-slate-500', chip: 'bg-muted text-muted-foreground' },
} as const;

export function AttentionList({ items }: { items: AttentionItem[] }) {
  return (
    <ul className="-mx-2 divide-y">
      {items.map((a) => {
        const s = SEVERITY[a.severity];
        const body: ReactNode = (
          <>
            <TriangleAlert aria-hidden className={cn('mt-0.5 size-4 shrink-0', a.severity === 'high' ? 'text-red-600' : a.severity === 'medium' ? 'text-amber-600' : 'text-slate-500')} />
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium">
                {a.orderNumber && <span className="tabular text-muted-foreground">#{a.orderNumber} · </span>}
                {a.title}
              </p>
              <p className="truncate text-xs text-muted-foreground">{a.detail}</p>
            </div>
            <span className={cn('shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold', s.chip)}>{s.label}</span>
            {a.href && <ChevronRight aria-hidden className="size-4 shrink-0 text-muted-foreground" />}
          </>
        );
        return (
          <li key={a.id}>
            {a.href ? (
              <Link href={a.href} className="flex items-start gap-3 rounded-md px-2 py-3 transition-colors hover:bg-muted/70">
                {body}
              </Link>
            ) : (
              <div className="flex items-start gap-3 px-2 py-3">{body}</div>
            )}
          </li>
        );
      })}
    </ul>
  );
}

const KIND_ICON = { status: Wrench, payment: Wallet, message: MessageCircle, stock: Package, plate: ScanLine } as const;

export function ActivityFeed({ items }: { items: ActivityItem[] }) {
  return (
    <ol className="relative space-y-4 before:absolute before:left-[13px] before:top-2 before:bottom-2 before:w-px before:bg-border">
      {items.map((e) => {
        const Icon = KIND_ICON[e.kind];
        return (
          <li key={e.id} className="relative flex items-start gap-3">
            <span className="z-10 grid size-7 shrink-0 place-items-center rounded-full border bg-card text-muted-foreground">
              <Icon aria-hidden className="size-3.5" />
            </span>
            <div className="min-w-0 pt-0.5">
              <p className="text-sm">
                {e.text}
                {e.orderNumber && (
                  <Link href={`/ordens?q=${e.orderNumber}`} className="tabular ml-1 font-medium text-brand underline-offset-2 hover:underline">
                    #{e.orderNumber}
                  </Link>
                )}
              </p>
              <time dateTime={e.at} className="text-xs text-muted-foreground">
                {e.relative}
              </time>
            </div>
          </li>
        );
      })}
    </ol>
  );
}

const TONE: Record<Tone, string> = {
  good: 'bg-emerald-50 text-emerald-800 ring-emerald-200',
  warn: 'bg-amber-50 text-amber-900 ring-amber-200',
  bad: 'bg-red-50 text-red-800 ring-red-200',
  info: 'bg-brand-soft text-brand ring-brand/20',
};

export function Insights({ items }: { items: Insight[] }) {
  return (
    <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
      {items.map((i) => (
        <li key={i.id} className="flex gap-3 rounded-xl border bg-card p-4 shadow-xs">
          <span className={cn('grid size-8 shrink-0 place-items-center rounded-lg ring-1', TONE[i.tone])}>
            {i.tone === 'info' ? <Lightbulb aria-hidden className="size-4" /> : <Sparkles aria-hidden className="size-4" />}
          </span>
          <div className="min-w-0">
            <h3 className="text-sm font-semibold leading-snug">{i.title}</h3>
            <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{i.body}</p>
          </div>
        </li>
      ))}
    </ul>
  );
}
