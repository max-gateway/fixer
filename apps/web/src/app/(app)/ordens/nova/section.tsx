import type { ReactNode } from 'react';

/** Cartão numerado de uma etapa do formulário. */
export function Section({ step, title, description, children }: { step: number; title: string; description?: string; children: ReactNode }) {
  return (
    <section className="rounded-xl border bg-card p-5 shadow-xs">
      <header className="mb-4 flex items-start gap-3">
        <span aria-hidden className="grid size-6 shrink-0 place-items-center rounded-full bg-brand text-xs font-semibold text-white">
          {step}
        </span>
        <div>
          <h2 className="text-base font-semibold leading-6">{title}</h2>
          {description && <p className="text-sm text-muted-foreground">{description}</p>}
        </div>
      </header>
      <div className="space-y-4">{children}</div>
    </section>
  );
}
