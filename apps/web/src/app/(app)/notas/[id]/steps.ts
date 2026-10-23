import { shortDate, type InvoiceDetail, type InvoiceItem } from '@/lib/invoices';

export type StepState = 'done' | 'current' | 'todo';

export interface InvoiceStep {
  key: 'conciliar' | 'precificar' | 'lancar';
  label: string;
  detail: string;
  state: StepState;
  /** Âncora da seção na página. */
  href: string;
}

type StepInput = Pick<InvoiceDetail, 'status' | 'exportStatus' | 'postedAt'> & { items: Pick<InvoiceItem, 'resolution' | 'itemNumber'>[] };

/** Primeiro item sem peça (a página leva a pessoa até ele); null quando todos estão resolvidos. */
export function firstUnresolved(items: Pick<InvoiceItem, 'resolution' | 'itemNumber'>[]): number | null {
  const pending = items.filter((i) => i.resolution === 'UNRESOLVED');
  return pending.length ? Math.min(...pending.map((i) => i.itemNumber)) : null;
}

/**
 * As três etapas de uma nota completa: conciliar os itens com as peças, conferir os preços e lançar a entrada. Só existe quando a
 * nota tem XML completo e itens; resumo, ciência e nota ignorada não têm fluxo de etapas.
 */
export function invoiceSteps(inv: StepInput): InvoiceStep[] {
  if (inv.status !== 'FULL' || inv.items.length === 0) return [];
  const total = inv.items.length;
  const unresolved = inv.items.filter((i) => i.resolution === 'UNRESOLVED').length;
  const posted = inv.exportStatus === 'POSTED';
  const matched = unresolved === 0;
  return [
    {
      key: 'conciliar',
      label: 'Conciliar itens',
      detail: matched ? `${total} de ${total} vinculados` : `${total - unresolved} de ${total} vinculados`,
      state: matched ? 'done' : 'current',
      href: '#conciliar',
    },
    {
      key: 'precificar',
      label: 'Precificar',
      detail: posted ? 'Concluído' : matched ? 'Revise as sugestões' : 'Depois de vincular',
      state: posted ? 'done' : matched ? 'current' : 'todo',
      href: '#precificar',
    },
    {
      key: 'lancar',
      label: 'Lançar entrada',
      detail: posted ? `Lançada em ${shortDate(inv.postedAt)}` : 'Soma ao estoque',
      state: posted ? 'done' : 'todo',
      href: '#precificar',
    },
  ];
}
