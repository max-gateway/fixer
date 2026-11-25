import type { LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

/*
 * Peças visuais da jornada, na linguagem da logo: preto profundo, azul elétrico e o traço inclinado do "E" de FIXER.
 * Azul marca o que o Fixer faz sozinho; âmbar, o que vale conferir. O resto é tinta e cinza-azulado.
 */

/** O traço inclinado da logo. */
export function Slash({ className }: { className?: string }) {
  return <span aria-hidden className={cn('inline-block h-1.5 w-7 -skew-x-[35deg] rounded-[2px] bg-brand', className)} />;
}

/** Cabeçalho de uma etapa: posição na jornada, título e a frase que diz o que acontece nela. */
export function StepHeader({ id, index, total, title, description, aside }: { id?: string; index: number; total: number; title: string; description: ReactNode; aside?: ReactNode }) {
  return (
    <header className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
      <div className="min-w-0 space-y-1.5">
        <p className="flex items-center gap-2 text-xs font-semibold tracking-wide text-brand uppercase">
          <Slash className="w-5" /> Etapa {index} de {total}
        </p>
        <h2 id={id} className="text-xl font-semibold tracking-tight sm:text-2xl">{title}</h2>
        <p className="max-w-2xl text-sm text-muted-foreground">{description}</p>
      </div>
      {aside}
    </header>
  );
}

/** Superfície branca elevada, a unidade de conteúdo de cada etapa. */
export function Surface({ className, children, ...props }: React.ComponentProps<'div'>) {
  return (
    <div className={cn('surface rounded-2xl border bg-card p-4 sm:p-5', className)} {...props}>
      {children}
    </div>
  );
}

/** Um dado buscado sozinho: rótulo, valor e de onde veio. Valor ausente aparece como pendência, não como vazio. */
export function DataItem({ icon: Icon, label, value, source, estimated, className }: { icon: LucideIcon; label: string; value: ReactNode | null; source?: string | null; estimated?: boolean; className?: string }) {
  return (
    <div className={cn('flex min-w-0 items-start gap-3', className)}>
      <span aria-hidden className={cn('grid size-9 shrink-0 place-items-center rounded-xl', value == null ? 'bg-slate-100 text-slate-400' : 'bg-brand-soft text-brand')}>
        <Icon className="size-4" />
      </span>
      <dl className="min-w-0">
        <dt className="text-xs text-muted-foreground">{label}</dt>
        <dd className="font-medium break-words">{value ?? <span className="font-normal text-amber-800">Não encontrado</span>}</dd>
        {source && <dd className={cn('text-xs', estimated ? 'text-amber-800' : 'text-muted-foreground')}>{source}</dd>}
      </dl>
    </div>
  );
}

/** Aviso em linha, com ícone; a cor nunca é o único sinal. */
export function Note({ tone, icon: Icon, children, className }: { tone: 'info' | 'warn' | 'error' | 'ok'; icon: LucideIcon; children: ReactNode; className?: string }) {
  const style = {
    info: 'border-sky-200 bg-sky-50 text-sky-950',
    warn: 'border-amber-200 bg-amber-50 text-amber-950',
    error: 'border-red-200 bg-red-50 text-red-900',
    ok: 'border-emerald-200 bg-emerald-50 text-emerald-950',
  }[tone];
  return (
    <div role={tone === 'error' ? 'alert' : 'status'} className={cn('flex items-start gap-3 rounded-xl border p-3.5 text-sm', style, className)}>
      <Icon aria-hidden className="mt-0.5 size-4 shrink-0" />
      <div className="min-w-0 space-y-1">{children}</div>
    </div>
  );
}
