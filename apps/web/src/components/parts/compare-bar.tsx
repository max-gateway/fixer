'use client';

import { GitCompareArrows, X } from 'lucide-react';
import { PartImage } from '@/components/catalog/part-image';
import { Button } from '@/components/ui/button';
import type { PartHit } from '@/lib/part-search';

export const MAX_COMPARE = 4;

/** Barra flutuante com as peças marcadas para comparar. */
export function CompareBar({ hits, onCompare, onClear }: { hits: PartHit[]; onCompare: () => void; onClear: () => void }) {
  if (hits.length === 0) return null;
  return (
    <div role="region" aria-label="Comparação" className="surface animate-rise fixed inset-x-3 bottom-20 z-30 mx-auto flex max-w-xl items-center gap-3 rounded-2xl border bg-card p-2.5 md:bottom-6">
      <div className="flex -space-x-2">
        {hits.map((c) => (
          <PartImage key={c.sku} url={c.imageUrl} className="size-10 rounded-lg border-2 border-card bg-white" />
        ))}
      </div>
      <p className="min-w-0 flex-1 text-sm">
        <strong>{hits.length}</strong> {hits.length === 1 ? 'peça marcada' : 'peças marcadas'}
        {hits.length < 2 && <span className="block text-xs text-muted-foreground">Marque mais uma para comparar</span>}
      </p>
      <Button size="sm" disabled={hits.length < 2} onClick={onCompare}>
        <GitCompareArrows aria-hidden /> Comparar
      </Button>
      <Button variant="ghost" size="icon-sm" onClick={onClear} aria-label="Limpar comparação">
        <X aria-hidden />
      </Button>
    </div>
  );
}
