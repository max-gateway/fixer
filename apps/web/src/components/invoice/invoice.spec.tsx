import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { WithCost } from '@/lib/invoice-cost';
import { invoiceNotices } from '@/lib/invoice-view';
import type { InvoiceItem } from '@/lib/invoices';
import { InvoiceNotices } from './notices';
import { TaxIncidence } from './tax-incidence';

const item = (n: number, components: { code: 'ICMS_PROPRIO' | 'IPI' | 'ICMS_ST'; amount: string; treatment: 'COST' | 'INFO' }[]): WithCost<InvoiceItem> =>
  ({
    id: `i${n}`,
    itemNumber: n,
    description: `Pastilha de freio ${n}`,
    totalPrice: '100.00',
    cost: { landed: '12', total: '100', profile: 'RESALE', components: components.map((c) => ({ ...c, source: 'XML', allocated: false })) },
  }) as unknown as WithCost<InvoiceItem>;

describe('TaxIncidence', () => {
  it('mostra cada imposto com o total e como ele pesa no custo', () => {
    const out = renderToStaticMarkup(<TaxIncidence items={[item(1, [{ code: 'ICMS_PROPRIO', amount: '18', treatment: 'INFO' }, { code: 'IPI', amount: '5', treatment: 'COST' }])]} />);
    expect(out).toContain('Impostos nesta nota');
    expect(out).toContain('ICMS');
    expect(out).toContain('IPI');
    expect(out).toContain('já está no preço');
    expect(out).toContain('soma ao custo');
  });
  it('só oferece o seletor de item quando há mais de um item com imposto', () => {
    const one = renderToStaticMarkup(<TaxIncidence items={[item(1, [{ code: 'IPI', amount: '5', treatment: 'COST' }])]} />);
    const two = renderToStaticMarkup(<TaxIncidence items={[item(1, [{ code: 'IPI', amount: '5', treatment: 'COST' }]), item(2, [{ code: 'ICMS_ST', amount: '3', treatment: 'COST' }])]} />);
    expect(one).not.toContain('Todos os itens');
    expect(two).toContain('Todos os itens');
  });
  it('sem custo calculado não desenha nada', () => {
    expect(renderToStaticMarkup(<TaxIncidence items={[{ id: 'x', itemNumber: 1, totalPrice: '10', cost: null } as unknown as WithCost<InvoiceItem>]} />)).toBe('');
  });
});

describe('InvoiceNotices', () => {
  const base = { status: 'FULL', exportStatus: 'READY', needsReview: false, finality: 1, ignoredReason: null, manifestError: null, manifestAttempts: 0, postedAt: null } as const;
  it('o painel mostra só o principal; a página mostra todos, com o mesmo texto', () => {
    const notices = invoiceNotices({ ...base, needsReview: true });
    expect(notices.length).toBeGreaterThan(1);
    const pane = renderToStaticMarkup(<InvoiceNotices notices={notices} max={1} />);
    const page = renderToStaticMarkup(<InvoiceNotices notices={notices} />);
    expect(pane).toContain(notices[0]!.title);
    expect(pane).not.toContain(notices[1]!.title);
    expect(page).toContain(notices[0]!.title);
    expect(page).toContain(notices[1]!.title);
  });
});
