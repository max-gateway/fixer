'use client';

import { CalendarClock, CircleCheck, Table2, TriangleAlert, Wallet, BarChart3 } from 'lucide-react';
import { useMemo, useState, type ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import { civilDate, civilShort, money, type Filters, type Forecast, type ForecastBucket, type Summary } from '@/lib/payables';
import { cn } from '@/lib/utils';

const compact = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL', notation: 'compact', maximumFractionDigits: 1 });
const CRITICAL = '#d03b3b'; // status "crítico" (vencida): sempre com ícone e rótulo, nunca só a cor

/** KPIs clicáveis (cada um aplica o filtro correspondente) e o gráfico de saída de caixa. */
export function Overview({
  summary,
  forecast,
  filters,
  onView,
  onBucket,
}: {
  summary: Summary;
  forecast: Forecast;
  filters: Filters;
  onView: (v: Filters['view']) => void;
  onBucket: (b: ForecastBucket) => void;
}) {
  const { views, paidMonth } = summary;
  const monthName = new Date(`${summary.today}T12:00:00Z`).toLocaleDateString('pt-BR', { month: 'long', timeZone: 'UTC' });
  return (
    <div className="space-y-4">
      <dl className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Kpi icon={<Wallet aria-hidden className="size-4" />} label="A pagar" value={views.open.amount} sub={`${views.open.count} ${views.open.count === 1 ? 'parcela' : 'parcelas'} em aberto`} active={filters.view === 'open'} onClick={() => onView('open')} />
        <Kpi
          icon={<TriangleAlert aria-hidden className="size-4" />}
          label="Vencidas"
          value={views.overdue.amount}
          sub={views.overdue.count ? `${views.overdue.count} ${views.overdue.count === 1 ? 'parcela atrasada' : 'parcelas atrasadas'}` : 'Nada atrasado'}
          tone={views.overdue.count > 0 ? 'danger' : 'ok'}
          active={filters.view === 'overdue'}
          onClick={() => onView('overdue')}
        />
        <Kpi
          icon={<CalendarClock aria-hidden className="size-4" />}
          label="Próximos 7 dias"
          value={views.week.amount}
          sub={views.week.count ? `${views.week.count} ${views.week.count === 1 ? 'parcela' : 'parcelas'}${summary.nextDue ? ` · próxima ${civilShort(summary.nextDue)}` : ''}` : 'Semana livre'}
          active={filters.view === 'week'}
          onClick={() => onView('week')}
        />
        <Kpi
          icon={<CircleCheck aria-hidden className="size-4" />}
          label={`Pago em ${monthName}`}
          value={paidMonth.amount}
          sub={`${paidMonth.count} ${paidMonth.count === 1 ? 'pagamento' : 'pagamentos'}`}
          active={filters.view === 'paid'}
          onClick={() => onView('paid')}
        />
      </dl>
      <ForecastChart forecast={forecast} filters={filters} onBucket={onBucket} />
    </div>
  );
}

function Kpi({
  icon,
  label,
  value,
  sub,
  tone,
  active,
  onClick,
}: {
  icon: ReactNode;
  label: string;
  value: string;
  sub: string;
  tone?: 'danger' | 'ok';
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        'group flex flex-col items-start gap-0.5 rounded-xl border bg-card px-4 py-3 text-left shadow-xs transition-all',
        'hover:border-foreground/25 hover:shadow-sm focus-visible:ring-[3px] focus-visible:ring-ring/40 focus-visible:outline-none',
        active && 'border-brand ring-1 ring-brand/40',
      )}
    >
      <dt className={cn('flex items-center gap-1.5 text-xs font-medium text-muted-foreground', tone === 'danger' && 'text-red-800')}>
        {icon}
        {label}
      </dt>
      <dd className={cn('tabular text-xl font-semibold tracking-tight sm:text-2xl', tone === 'danger' && 'text-red-800')}>{money(value)}</dd>
      <dd className="text-xs text-muted-foreground">{sub}</dd>
    </button>
  );
}

// ---------- gráfico ----------

const bucketLabel = (b: ForecastBucket) =>
  b.kind === 'overdue' ? 'Vencidas' : b.kind === 'later' ? 'Depois' : `${civilShort(b.from!)}${b.to ? ` – ${civilShort(b.to)}` : ''}`;
const axisLabel = (b: ForecastBucket) => (b.kind === 'overdue' ? 'Venc.' : b.kind === 'later' ? 'Depois' : civilShort(b.from!));

function isActive(b: ForecastBucket, f: Filters) {
  if (b.kind === 'overdue') return f.view === 'overdue';
  return f.view === 'open' && f.from === (b.from ?? '') && f.to === (b.to ?? '');
}

function ForecastChart({ forecast, filters, onBucket }: { forecast: Forecast; filters: Filters; onBucket: (b: ForecastBucket) => void }) {
  const [table, setTable] = useState(false);
  const { buckets } = forecast;
  const max = useMemo(() => Math.max(0, ...buckets.map((b) => Number(b.amount))), [buckets]);
  const total = useMemo(() => buckets.reduce((s, b) => s + Number(b.amount), 0), [buckets]);
  // Eixo com 3 marcas redondas (0, metade, topo) sobre o teto arredondado para cima.
  const top = niceCeil(max);
  const peak = buckets.reduce((best, b) => (Number(b.amount) > Number(best.amount) ? b : best), buckets[0]!);

  return (
    <section aria-labelledby="forecast-title" className="rounded-xl border bg-card surface p-4 shadow-xs">
      <header className="mb-3 flex flex-wrap items-start justify-between gap-2">
        <div>
          <h2 id="forecast-title" className="text-sm font-semibold">
            Saída de caixa prevista
          </h2>
          <p className="text-xs text-muted-foreground">
            {total > 0 ? (
              <>
                <span className="tabular font-medium text-foreground">{money(total)}</span> em aberto, por janela de 7 dias a partir de hoje. Clique numa barra para filtrar.
              </>
            ) : (
              'Nenhuma conta em aberto.'
            )}
          </p>
        </div>
        <Button variant="ghost" size="xs" aria-pressed={table} onClick={() => setTable((t) => !t)}>
          {table ? <BarChart3 aria-hidden /> : <Table2 aria-hidden />} {table ? 'Ver gráfico' : 'Ver tabela'}
        </Button>
      </header>

      {total === 0 ? null : table ? (
        <table className="w-full text-sm">
          <caption className="sr-only">Contas em aberto por janela de vencimento</caption>
          <thead>
            <tr className="border-b text-left text-xs text-muted-foreground">
              <th className="py-1.5 font-medium">Período</th>
              <th className="py-1.5 text-right font-medium">Parcelas</th>
              <th className="py-1.5 text-right font-medium">Valor</th>
            </tr>
          </thead>
          <tbody>
            {buckets.map((b) => (
              <tr key={b.key} className="border-b last:border-0">
                <td className="py-1.5">{bucketLabel(b)}</td>
                <td className="tabular py-1.5 text-right">{b.count}</td>
                <td className="tabular py-1.5 text-right font-medium">{money(b.amount)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <div className="grid grid-cols-[auto_1fr] gap-x-2">
          <div aria-hidden className="relative h-44 w-12 text-right text-[11px] text-muted-foreground">
            {[1, 0.5, 0].map((t) => (
              <span key={t} className="tabular absolute right-0 -translate-y-1/2" style={{ top: `${(1 - t) * 100}%` }}>
                {t === 0 ? '0' : compact.format(top * t).replace(/\s/g, '')}
              </span>
            ))}
          </div>
          <div className="relative">
            <div aria-hidden className="pointer-events-none absolute inset-x-0 top-0 h-44">
              {[0, 0.5, 1].map((t) => (
                <div key={t} className="absolute inset-x-0 border-t border-border" style={{ top: `${t * 100}%` }} />
              ))}
            </div>
            <ul className="relative flex h-44 items-end gap-0.5 sm:gap-1.5">
              {buckets.map((b) => {
                const v = Number(b.amount);
                const pct = top > 0 ? (v / top) * 100 : 0;
                const overdue = b.kind === 'overdue';
                const active = isActive(b, filters);
                const showValue = v > 0 && (b === peak || overdue);
                return (
                  <li key={b.key} className="group relative flex h-full min-w-0 flex-1 flex-col justify-end">
                    <button
                      type="button"
                      onClick={() => onBucket(b)}
                      aria-pressed={active}
                      aria-label={`${bucketLabel(b)}: ${money(b.amount)} em ${b.count} ${b.count === 1 ? 'parcela' : 'parcelas'}`}
                      className="peer relative flex h-full w-full flex-col items-center justify-end rounded-sm outline-none focus-visible:bg-muted/60 hover:bg-muted/60"
                    >
                      {showValue && <span className="tabular mb-1 text-[11px] font-medium text-foreground">{compact.format(v).replace(/\s/g, '')}</span>}
                      <span
                        className={cn('w-full max-w-6 rounded-t-[4px] transition-opacity', !overdue && 'bg-brand', active ? 'opacity-100' : 'opacity-80 group-hover:opacity-100', b.kind === 'later' && 'opacity-50')}
                        style={{ height: `${v > 0 ? Math.max(pct, 1.5) : 0}%`, ...(overdue ? { backgroundColor: CRITICAL } : {}) }}
                      />
                    </button>
                    <Tooltip b={b} />
                  </li>
                );
              })}
            </ul>
            <ul aria-hidden className="mt-1.5 flex gap-0.5 sm:gap-1.5">
              {buckets.map((b) => (
                <li key={b.key} className={cn('flex min-w-0 flex-1 items-center justify-center gap-0.5 text-[10px] text-muted-foreground sm:text-[11px]', isActive(b, filters) && 'font-semibold text-foreground')}>
                  {b.kind === 'overdue' && <TriangleAlert className="size-3 shrink-0" style={{ color: CRITICAL }} />}
                  <span className="truncate">{axisLabel(b)}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}
    </section>
  );
}

function Tooltip({ b }: { b: ForecastBucket }) {
  return (
    <div
      role="presentation"
      className="pointer-events-none absolute bottom-full left-1/2 z-10 mb-1 hidden w-max max-w-48 -translate-x-1/2 rounded-lg border bg-popover px-3 py-2 text-xs shadow-md peer-hover:block peer-focus-visible:block"
    >
      <p className="font-medium">{b.kind === 'overdue' ? 'Vencidas' : b.kind === 'later' ? `A partir de ${civilDate(b.from)}` : `${civilDate(b.from)} a ${civilDate(b.to)}`}</p>
      <p className="tabular mt-0.5 text-sm font-semibold">{money(b.amount)}</p>
      <p className="text-muted-foreground">
        {b.count} {b.count === 1 ? 'parcela' : 'parcelas'}
      </p>
    </div>
  );
}

/** Teto "redondo" para o eixo (1, 2, 2,5, 5 × 10^n), para as marcas dizerem números limpos. */
export function niceCeil(v: number): number {
  if (v <= 0) return 0;
  const exp = 10 ** Math.floor(Math.log10(v));
  const f = v / exp;
  return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10) * exp;
}
