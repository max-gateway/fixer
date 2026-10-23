import { cn } from '@/lib/utils';

export type MarginLevel = 'loss' | 'below' | 'ok';

/** Onde a margem está em relação à regra: negativa ou abaixo do mínimo, abaixo da meta, ou na meta (ou acima). */
export function marginLevel(margin: number, min: number, target: number | null): MarginLevel {
  if (margin < min) return 'loss';
  if (target !== null && margin < target) return 'below';
  return 'ok';
}

const COLOR: Record<MarginLevel, string> = { loss: 'bg-red-500', below: 'bg-amber-500', ok: 'bg-emerald-500' };
const LABEL: Record<MarginLevel, string> = { loss: 'abaixo do mínimo', below: 'abaixo da meta', ok: 'na meta' };

/**
 * Barra de margem: o preenchimento vai de 0 até o dobro da meta (ou do mínimo, sem meta) e a cor diz a situação. A cor nunca vem
 * sozinha: o rótulo acessível e o texto ao lado dizem o mesmo.
 */
export function MarginBar({ margin, min, target, className }: { margin: number; min: number; target: number | null; className?: string }) {
  const level = marginLevel(margin, min, target);
  const scale = Math.max((target ?? min) * 2, 1);
  const width = Math.max(0, Math.min(100, (margin / scale) * 100));
  return (
    <span role="img" aria-label={`Margem ${LABEL[level]}`} className={cn('block h-1.5 w-full overflow-hidden rounded-full bg-muted', className)}>
      <span className={cn('block h-full rounded-full transition-[width]', COLOR[level])} style={{ width: `${width}%` }} />
    </span>
  );
}
