import { itemFiscalFacts, landedCost } from '@/lib/invoice-view';
import type { InvoiceItem } from '@/lib/invoices';
import type { WithCost } from '@/lib/invoice-cost';

/** Dados fiscais do item como vieram no XML (NCM, CEST, CFOP, GTIN), na mesma ordem e formato em qualquer tela. */
export function ItemFiscalLine({ item }: { item: Pick<InvoiceItem, 'ncm' | 'cest' | 'cfop' | 'ean'> }) {
  return (
    <>
      {itemFiscalFacts(item).map((f, i) => (
        <span key={f.label}>
          {i > 0 && ' · '}
          {f.label} <span className="tabular">{f.value}</span>
        </span>
      ))}
    </>
  );
}

/** Custo real por unidade em estoque, quando a API calculou. */
export function ItemLandedCost({ item }: { item: WithCost<InvoiceItem> }) {
  const v = landedCost(item.cost);
  if (!v) return null;
  return (
    <span>
      Custo real <strong className="tabular font-medium text-foreground">{v}</strong>/un
    </span>
  );
}
