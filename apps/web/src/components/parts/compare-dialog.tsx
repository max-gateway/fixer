'use client';

import { Equal, Loader2, X } from 'lucide-react';
import { useMemo, useState } from 'react';
import { PartImage } from '@/components/catalog/part-image';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { Switch } from '@/components/ui/switch';
import { formatCents, type PartDetail, type PartHit } from '@/lib/part-search';
import { cn } from '@/lib/utils';
import { usePartDetails } from './use-parts';

const key = (s: string) => s.replace(/[\s.\-/]/g, '').toUpperCase();

type Cell = { text: string; muted?: boolean };
type RowDef = { label: string; cells: Cell[] };

/** Duas peças são equivalentes quando o código de uma consta nos cross-references da outra (em qualquer marca). */
function equivalence(details: (PartDetail | undefined)[], hits: PartHit[]): Cell[] {
  return hits.map((h, i) => {
    const others = hits.filter((_, j) => j !== i && details[j]);
    const eq = others.filter((o) => {
      const j = hits.indexOf(o);
      const mine = key(h.partNumber);
      return details[j]!.crossPairs.some((p) => key(p.slice(p.indexOf(':') + 1)) === mine) || (details[i]?.crossPairs ?? []).some((p) => key(p.slice(p.indexOf(':') + 1)) === key(o.partNumber));
    });
    return eq.length ? { text: eq.map((o) => o.partNumber).join(', ') } : { text: 'Nenhuma das outras', muted: true };
  });
}

/** Compara até 4 peças lado a lado: o essencial primeiro, depois as especificações de todas, e a opção de ver só o que difere. */
export function CompareDialog({ open, onOpenChange, hits, onOpenPart, onRemove }: { open: boolean; onOpenChange: (o: boolean) => void; hits: PartHit[]; onOpenPart: (sku: string) => void; onRemove: (sku: string) => void }) {
  const [onlyDiff, setOnlyDiff] = useState(false);
  const queries = usePartDetails(open ? hits.map((h) => h.sku) : []);
  const details = queries.map((q) => q.data);
  const loading = queries.some((q) => q.isLoading);

  const rows: RowDef[] = useMemo(() => {
    const dash: Cell = { text: '—', muted: true };
    const base: RowDef[] = [
      { label: 'Marca', cells: hits.map((h) => (h.brand ? { text: h.brand.name } : dash)) },
      { label: 'Código', cells: hits.map((h) => ({ text: h.partNumber })) },
      { label: 'Categoria', cells: hits.map((h) => (h.category ? { text: h.category.name } : dash)) },
      { label: 'Preço', cells: hits.map((h) => (h.offer?.priceCents != null ? { text: formatCents(h.offer.priceCents) } : dash)) },
      { label: 'Estoque', cells: hits.map((h) => (h.offer ? { text: h.offer.quantityAvailable > 0 ? `${h.offer.quantityAvailable} un` : 'Sem saldo' } : dash)) },
      { label: 'Código de barras', cells: details.map((d) => (d?.barcodes.length ? { text: d.barcodes.join(', ') } : dash)) },
      { label: 'Veículos compatíveis', cells: details.map((d) => (d ? { text: d.isUniversalFit ? 'Universal' : String(d.applications.length) } : dash)) },
      { label: 'Equivalente a', cells: equivalence(details, hits) },
    ];
    const names = [...new Set(details.flatMap((d) => d?.catalogAttributes.map((a) => a.name) ?? []))];
    const attrs = names.map<RowDef>((n) => ({ label: n, cells: details.map((d) => { const v = d?.catalogAttributes.find((a) => a.name === n)?.value; return v ? { text: v } : dash; }) }));
    return [...base, ...attrs];
  }, [hits, details]);

  const same = (r: RowDef) => r.cells.every((c) => c.text === r.cells[0]!.text);
  const shown = onlyDiff ? rows.filter((r) => !same(r)) : rows;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90dvh] max-w-5xl gap-4 overflow-hidden sm:max-w-5xl">
        <div className="flex items-start justify-between gap-4 pr-8">
          <div>
            <DialogTitle>Comparar peças</DialogTitle>
            <DialogDescription>{hits.length} peças lado a lado. Os valores iguais em todas aparecem esmaecidos.</DialogDescription>
          </div>
          <label className="flex shrink-0 items-center gap-2 text-sm">
            <Switch checked={onlyDiff} onCheckedChange={setOnlyDiff} /> Só diferenças
          </label>
        </div>
        <div className="-mx-1 overflow-auto px-1">
          <table className="w-full min-w-[40rem] border-separate border-spacing-0 text-sm">
            <thead>
              <tr>
                <th className="sticky left-0 z-10 w-36 bg-popover" />
                {hits.map((h) => (
                  <th key={h.sku} className="p-2 align-top font-normal">
                    <div className="relative space-y-2 rounded-xl border p-2 text-left">
                      <button type="button" onClick={() => onRemove(h.sku)} aria-label={`Tirar ${h.name}`} className="absolute top-1 right-1 z-10 grid size-6 place-items-center rounded-md bg-card/90 text-muted-foreground hover:text-foreground">
                        <X aria-hidden className="size-3.5" />
                      </button>
                      <PartImage key={h.imageUrl} url={h.imageUrl} className="aspect-[4/3] w-full rounded-lg bg-white" />
                      <button type="button" onClick={() => onOpenPart(h.sku)} className="line-clamp-2 text-left text-sm font-semibold hover:text-brand hover:underline">
                        {h.name}
                      </button>
                    </div>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {shown.map((r) => {
                const eq = same(r);
                return (
                  <tr key={r.label} className="group">
                    <th scope="row" className="sticky left-0 z-10 border-t bg-popover px-2 py-2 text-left text-xs font-medium text-muted-foreground">
                      <span className="flex items-center gap-1.5">
                        {eq && <Equal aria-label="igual em todas" className="size-3" />} {r.label}
                      </span>
                    </th>
                    {r.cells.map((c, i) => (
                      <td key={i} className={cn('tabular border-t px-3 py-2', (eq || c.muted) && 'text-muted-foreground', !eq && !c.muted && 'font-medium')}>
                        {c.text}
                      </td>
                    ))}
                  </tr>
                );
              })}
              {shown.length === 0 && (
                <tr>
                  <td colSpan={hits.length + 1} className="p-6 text-center text-sm text-muted-foreground">
                    Todas as informações são iguais.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
          {loading && (
            <p className="flex items-center justify-center gap-2 p-3 text-xs text-muted-foreground">
              <Loader2 aria-hidden className="size-3.5 animate-spin" /> Carregando especificações…
            </p>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
