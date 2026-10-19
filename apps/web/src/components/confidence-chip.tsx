import { CircleCheck, CircleDashed, Minus, Pencil, TriangleAlert, type LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import { Hint } from '@/components/hint';
import { Badge } from '@/components/ui/badge';

// Vocabulário único de confiança de um número calculado (docs/specs/custos-e-impostos-ui.md §3.1): o mesmo estado tem
// sempre o mesmo texto, ícone e cor em qualquer tela. A cor nunca é o único sinal: ícone e texto vão juntos.

export type Confidence = 'CONFIRMADO' | 'ESTIMADO' | 'DEFINIDO' | 'SEM_DADO' | 'INVIAVEL';

const STYLE: Record<Confidence, { label: string; icon: LucideIcon; variant: 'success' | 'warning' | 'secondary' | 'outline' | 'danger' }> = {
  CONFIRMADO: { label: 'Confirmado', icon: CircleCheck, variant: 'success' },
  ESTIMADO: { label: 'Estimado', icon: CircleDashed, variant: 'warning' },
  DEFINIDO: { label: 'Definido por você', icon: Pencil, variant: 'secondary' },
  SEM_DADO: { label: 'Sem dado', icon: Minus, variant: 'outline' },
  INVIAVEL: { label: 'Inviável', icon: TriangleAlert, variant: 'danger' },
};

/** Etiqueta de confiança. `label` troca o texto (ex.: "Imposto estimado"); `hint` explica, ao passar o mouse ou tocar. */
export function ConfidenceChip({ state, label, hint }: { state: Confidence; label?: string; hint?: ReactNode }) {
  const s = STYLE[state];
  const Icon = s.icon;
  const badge = (
    <Badge variant={s.variant} data-confidence={state} className="gap-1">
      <Icon aria-hidden className="size-3" />
      {label ?? s.label}
    </Badge>
  );
  return hint ? <Hint content={hint}>{badge}</Hint> : badge;
}
