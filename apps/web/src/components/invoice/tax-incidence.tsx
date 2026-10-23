'use client';

import { ChevronDown, Receipt } from 'lucide-react';
import { useState } from 'react';
import { DonutChart } from '@/components/charts/donut-chart';
import { Select } from '@/components/ui/input';
import type { WithCost } from '@/lib/invoice-cost';
import { invoiceTaxes, TREATMENT_LABEL } from '@/lib/invoice-view';
import { money, type InvoiceItem } from '@/lib/invoices';

const pct1 = (n: number) => `${n.toLocaleString('pt-BR', { maximumFractionDigits: 1 })}%`;

/**
 * Impostos que incidem nos produtos da nota, em rosca: quanto é ICMS, ICMS-ST, IPI, PIS, COFINS, e como cada um pesa no custo
 * (já está no preço do fornecedor, soma ao custo ou abate). Dá para olhar a nota toda ou um item. Valores do XML, pelo livro de
 * custo da API; nada é recalculado aqui.
 */
export function TaxIncidence({ items, stacked = false, collapsible = false }: { items: WithCost<InvoiceItem>[]; stacked?: boolean; /** Começa fechado, só com o título e o total (a página da nota); o modal mostra aberto. */ collapsible?: boolean }) {
  const [itemNumber, setItemNumber] = useState<number | null>(null);
  const all = invoiceTaxes(items);
  // Sem custo calculado (só resumo, ou nota sem itens) não há o que mostrar.
  if (all.slices.length === 0) return null;

  const t = itemNumber == null ? all : invoiceTaxes(items, itemNumber);
  const withTaxes = items.filter((i) => invoiceTaxes([i]).slices.length > 0);

  const title = (
    <>
      <span aria-hidden className="grid size-8 shrink-0 place-items-center rounded-lg bg-brand-soft text-brand">
        <Receipt className="size-4" />
      </span>
      <div className="min-w-0 flex-1">
        <h3 className="text-sm font-semibold leading-tight">Impostos {itemNumber == null ? 'nesta nota' : `no item ${itemNumber}`}</h3>
        <p className="text-xs text-muted-foreground">
          {money(t.total)} de impostos em {money(t.base)} de produtos
        </p>
      </div>
    </>
  );
  const picker =
    withTaxes.length > 1 ? (
      <Select aria-label="Ver os impostos de" value={itemNumber ?? ''} onChange={(e) => setItemNumber(e.target.value === '' ? null : Number(e.target.value))} className="h-8 w-auto max-w-44 text-xs">
        <option value="">Todos os itens</option>
        {withTaxes.map((i) => (
          <option key={i.id} value={i.itemNumber}>
            {i.itemNumber}. {i.description.slice(0, 28)}
          </option>
        ))}
      </Select>
    ) : null;

  const body = (
    <>
      {t.slices.length === 0 ? (
        <p className="rounded-lg bg-muted/60 p-3 text-sm text-muted-foreground">Este item não traz imposto no XML.</p>
      ) : (
        <DonutChart
          stacked={stacked}
          label="Impostos que incidem nos produtos"
          slices={t.slices.map((s) => ({ key: s.code, name: s.name, hint: TREATMENT_LABEL[s.treatment], value: s.amount }))}
          centerValue={(s, total) => money(s ? s.value : total)}
          centerLabel={(s) => (s ? s.name : 'em impostos')}
          row={(s, total) => ({ primary: money(s.value), secondary: `${pct1((s.value / total) * 100)} dos impostos${t.base > 0 ? ` · ${pct1((s.value / t.base) * 100)} dos produtos` : ''}` })}
        />
      )}

      <dl className="grid grid-cols-3 gap-px overflow-hidden rounded-lg border bg-border text-center">
        {(['INFO', 'COST', 'CREDIT'] as const).map((k) => (
          <div key={k} className="bg-card px-2 py-2">
            <dt className="text-[11px] text-muted-foreground">{TREATMENT_LABEL[k].replace(/^./, (c) => c.toUpperCase())}</dt>
            <dd className="tabular text-sm font-semibold">{money(t.byTreatment[k])}</dd>
          </div>
        ))}
      </dl>
      <p className="text-xs text-muted-foreground">O que “já está no preço” o fornecedor recolheu e não muda o custo. O que “soma ao custo” entra no preço de venda; o crédito “abate” o custo.</p>
    </>
  );

  if (collapsible) {
    return (
      <details aria-label="Impostos nesta nota" className="group rounded-2xl border bg-card shadow-sm">
        <summary className="flex cursor-pointer list-none items-center gap-x-3 rounded-2xl p-4 focus-visible:outline-2 focus-visible:outline-offset-2 [&::-webkit-details-marker]:hidden">
          {title}
          <ChevronDown aria-hidden className="size-4 shrink-0 text-muted-foreground transition-transform group-open:rotate-180" />
        </summary>
        <div className="space-y-4 px-4 pb-4">
          {picker && <div className="flex justify-end">{picker}</div>}
          {body}
        </div>
      </details>
    );
  }

  return (
    <section aria-label="Impostos nesta nota" className="space-y-4 rounded-xl border bg-card surface p-4 shadow-xs">
      <header className="flex flex-wrap items-center gap-x-3 gap-y-2">
        {title}
        {picker}
      </header>
      {body}
    </section>
  );
}
