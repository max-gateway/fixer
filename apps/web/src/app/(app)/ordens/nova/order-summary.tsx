import { LoaderCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { brl, type Part, type Service } from '@/lib/orders';
import { formatPlate } from '@/lib/masks';
import type { FormValues, PartLine } from './validate';

/** Total do orçamento: preço de tabela × quantidade (o preço é congelado no servidor ao criar). */
export function computeLines(parts: Part[], services: Service[], partLines: PartLine[], serviceIds: Set<string>) {
  const partById = new Map(parts.map((p) => [p.id, p]));
  const lines = [
    ...services.filter((s) => serviceIds.has(s.id)).map((s) => ({ key: `s-${s.id}`, label: s.name, value: Number(s.defaultPrice) })),
    ...partLines.flatMap((l, i) => {
      const p = partById.get(l.partId);
      const qty = Number(l.quantity);
      return p && qty > 0 ? [{ key: `p-${i}`, label: `${p.name} × ${qty}`, value: qty * Number(p.sellPrice) }] : [];
    }),
  ];
  return { lines, total: lines.reduce((sum, l) => sum + l.value, 0) };
}

export function OrderSummary({
  values,
  lines,
  total,
  error,
  saving,
}: {
  values: FormValues;
  lines: { key: string; label: string; value: number }[];
  total: number;
  error: string | null;
  saving: boolean;
}) {
  const vehicle = [values.brand, values.model].filter(Boolean).join(' ');
  return (
    <aside className="space-y-4 rounded-xl border bg-card p-5 shadow-xs lg:sticky lg:top-6">
      <div>
        <h2 className="text-base font-semibold">Resumo</h2>
        <p className="text-sm text-muted-foreground">
          {values.plate ? <span className="font-mono tracking-widest">{formatPlate(values.plate)}</span> : 'Placa não informada'}
          {vehicle && <> · {vehicle}</>}
        </p>
      </div>

      {lines.length === 0 ? (
        <p className="text-sm text-muted-foreground">Sem itens ainda: a ordem nasce como orçamento em branco e você completa depois.</p>
      ) : (
        <ul className="space-y-1.5 text-sm">
          {lines.map((l) => (
            <li key={l.key} className="flex justify-between gap-3">
              <span className="min-w-0 truncate">{l.label}</span>
              <span className="shrink-0 tabular-nums">{brl(l.value)}</span>
            </li>
          ))}
        </ul>
      )}

      <div className="flex items-baseline justify-between border-t pt-3">
        <span className="text-sm text-muted-foreground">Total estimado</span>
        <span className="text-xl font-semibold tabular-nums">{brl(total)}</span>
      </div>

      {error && (
        <p role="alert" className="rounded-md bg-red-50 px-3 py-2 text-sm font-medium text-red-800">
          {error}
        </p>
      )}

      <Button type="submit" size="lg" disabled={saving} className="w-full bg-brand hover:bg-brand-hover">
        {saving && <LoaderCircle aria-hidden className="animate-spin" />}
        {saving ? 'Criando…' : 'Criar orçamento'}
      </Button>
    </aside>
  );
}
