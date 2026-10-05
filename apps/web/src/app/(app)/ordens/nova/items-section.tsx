import { Plus, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input, Select } from '@/components/ui/input';
import { brl, type Part, type Service } from '@/lib/orders';
import { Section } from './section';
import type { PartLine } from './validate';

export function ItemsSection({
  parts,
  services,
  partLines,
  serviceIds,
  partsError,
  onPartLines,
  onToggleService,
}: {
  parts: Part[];
  services: Service[];
  partLines: PartLine[];
  serviceIds: Set<string>;
  partsError?: string;
  onPartLines: (update: (lines: PartLine[]) => PartLine[]) => void;
  onToggleService: (id: string, on: boolean) => void;
}) {
  const partById = new Map(parts.map((p) => [p.id, p]));
  const patch = (i: number, p: Partial<PartLine>) => onPartLines((ls) => ls.map((l, j) => (j === i ? { ...l, ...p } : l)));

  return (
    <Section step={4} title="Orçamento" description="Serviços e peças que já se sabe que serão usados. Dá para ajustar depois, na ordem.">
      <fieldset className="space-y-2">
        <legend className="mb-1 text-sm font-medium">Serviços</legend>
        {services.length === 0 && <p className="text-sm text-muted-foreground">Nenhum serviço cadastrado.</p>}
        <div className="grid gap-2 sm:grid-cols-2">
          {services.map((s) => {
            const on = serviceIds.has(s.id);
            return (
              <label
                key={s.id}
                className={`flex cursor-pointer items-center gap-3 rounded-lg border px-3 py-2.5 text-sm transition-colors has-[:focus-visible]:ring-[3px] has-[:focus-visible]:ring-ring/30 ${
                  on ? 'border-brand bg-brand-soft' : 'border-input bg-card hover:bg-accent'
                }`}
              >
                <input type="checkbox" checked={on} onChange={(e) => onToggleService(s.id, e.target.checked)} className="size-4 accent-[var(--brand-primary)]" />
                <span className="min-w-0 flex-1 truncate">{s.name}</span>
                <span className="shrink-0 tabular-nums text-muted-foreground">{brl(s.defaultPrice)}</span>
              </label>
            );
          })}
        </div>
      </fieldset>

      <fieldset className="space-y-2">
        <legend className="mb-1 text-sm font-medium">Peças</legend>
        {partLines.map((line, i) => {
          const part = partById.get(line.partId);
          const qty = Number(line.quantity);
          const short = part && qty > Number(part.stockQty);
          return (
            <div key={i} className="space-y-1">
              <div className="flex items-center gap-2">
                <Select value={line.partId} onChange={(e) => patch(i, { partId: e.target.value })} aria-label="Peça" className="min-w-0 flex-1">
                  <option value="">Selecione…</option>
                  {parts.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name} — {brl(p.sellPrice)} (estoque {Number(p.stockQty)})
                    </option>
                  ))}
                </Select>
                <Input
                  type="number"
                  min="0.01"
                  step="any"
                  value={line.quantity}
                  onChange={(e) => patch(i, { quantity: e.target.value })}
                  aria-label="Quantidade"
                  aria-invalid={line.partId && !(qty > 0) ? true : undefined}
                  className="w-20 shrink-0"
                />
                <span className="hidden w-24 shrink-0 text-right text-sm tabular-nums sm:block">{part && qty > 0 ? brl(qty * Number(part.sellPrice)) : '—'}</span>
                <Button type="button" variant="ghost" size="icon" aria-label="Remover peça" onClick={() => onPartLines((ls) => ls.filter((_, j) => j !== i))}>
                  <Trash2 aria-hidden className="text-destructive" />
                </Button>
              </div>
              {short && (
                <p className="text-xs text-amber-800">
                  Estoque insuficiente ({Number(part.stockQty)} em estoque). Dá para orçar, mas a aprovação só passa com saldo.
                </p>
              )}
            </div>
          );
        })}
        {partsError && (
          <p role="alert" className="text-xs font-medium text-destructive">
            {partsError}
          </p>
        )}
        <Button type="button" variant="outline" size="sm" onClick={() => onPartLines((ls) => [...ls, { partId: '', quantity: '1' }])}>
          <Plus aria-hidden /> Adicionar peça
        </Button>
      </fieldset>
    </Section>
  );
}
