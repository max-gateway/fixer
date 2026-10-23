import { Check } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { InvoiceStep } from './steps';

/** As três etapas da nota (conciliar, precificar, lançar). Cada uma é um link para a seção; a atual é anunciada com aria-current. */
export function InvoiceStepper({ steps }: { steps: InvoiceStep[] }) {
  if (steps.length === 0) return null;
  return (
    <nav aria-label="Etapas da nota">
      <ol className="grid gap-2 sm:grid-cols-3">
        {steps.map((s, i) => (
          <li key={s.key}>
            <a
              href={s.href}
              aria-current={s.state === 'current' ? 'step' : undefined}
              className={cn(
                'group flex items-center gap-3 rounded-xl border px-3 py-2.5 transition-colors focus-visible:outline-2 focus-visible:outline-offset-2',
                s.state === 'current' && 'border-brand/40 bg-brand-soft',
                s.state === 'done' && 'bg-card hover:bg-muted/50',
                s.state === 'todo' && 'bg-muted/30 text-muted-foreground hover:bg-muted/50',
              )}
            >
              <span
                aria-hidden
                className={cn(
                  'grid size-7 shrink-0 place-items-center rounded-full text-xs font-semibold',
                  s.state === 'done' && 'bg-emerald-600 text-white',
                  s.state === 'current' && 'bg-brand text-white',
                  s.state === 'todo' && 'border bg-background',
                )}
              >
                {s.state === 'done' ? <Check className="size-4" /> : i + 1}
              </span>
              <span className="min-w-0">
                <span className="block text-sm font-medium leading-tight text-foreground">
                  {s.label}
                  <span className="sr-only">{s.state === 'done' ? ' (concluída)' : s.state === 'current' ? ' (etapa atual)' : ' (pendente)'}</span>
                </span>
                <span className="block truncate text-xs text-muted-foreground">{s.detail}</span>
              </span>
            </a>
          </li>
        ))}
      </ol>
    </nav>
  );
}
