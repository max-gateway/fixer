'use client';

import { ChevronLeft, ChevronRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

/** Janela de páginas: a primeira, a última e três em volta da atual, com reticências. */
export function Pagination({ page, pages, onPage }: { page: number; pages: number; onPage: (p: number) => void }) {
  if (pages <= 1) return null;
  const set = new Set([1, pages, page - 1, page, page + 1].filter((p) => p >= 1 && p <= pages));
  const list = [...set].sort((a, b) => a - b);
  return (
    <nav aria-label="Páginas" className="flex items-center justify-center gap-1 pt-2">
      <Button variant="ghost" size="icon-sm" onClick={() => onPage(page - 1)} disabled={page <= 1} aria-label="Página anterior">
        <ChevronLeft aria-hidden />
      </Button>
      {list.map((p, i) => (
        <span key={p} className="flex items-center gap-1">
          {i > 0 && p - list[i - 1]! > 1 && <span className="px-1 text-muted-foreground">…</span>}
          <button
            type="button"
            onClick={() => onPage(p)}
            aria-current={p === page ? 'page' : undefined}
            className={cn('tabular grid h-8 min-w-8 place-items-center rounded-md px-2 text-sm', p === page ? 'bg-brand font-semibold text-primary-foreground' : 'hover:bg-muted')}
          >
            {p}
          </button>
        </span>
      ))}
      <Button variant="ghost" size="icon-sm" onClick={() => onPage(page + 1)} disabled={page >= pages} aria-label="Próxima página">
        <ChevronRight aria-hidden />
      </Button>
    </nav>
  );
}
