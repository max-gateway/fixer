import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { DEFAULT_FILTERS, type Forecast, type PayableRow, type Summary } from '@/lib/payables';
import { BulkBar } from './bulk-bar';
import { Overview } from './overview';
import { PayableList } from './payable-list';
import { Toolbar } from './toolbar';

const TODAY = '2026-10-13';
const noop = vi.fn();

const row = (id: string, due: string, o: Partial<PayableRow> = {}): PayableRow => ({
  id,
  source: 'XML_INSTALLMENT',
  supplierName: 'AUTO PECAS DISTRIBUIDORA LTDA',
  supplierCnpj: '11222333000181',
  description: null,
  category: 'Compras',
  barcode: null,
  documentNumber: '001',
  installment: 1,
  installmentCount: 3,
  dueDate: `${due}T00:00:00.000Z`,
  amount: '144.95',
  status: 'OPEN',
  paidAt: null,
  paidAmount: null,
  interest: null,
  discount: null,
  paymentMethod: null,
  notes: null,
  invoice: { id: 'inv1', number: 1234, series: 1, accessKey: 'x' },
  ...o,
});

const summary: Summary = {
  today: TODAY,
  nextDue: '2026-10-14',
  paidMonth: { count: 2, amount: '300.00' },
  views: {
    open: { count: 5, amount: '724.75' },
    overdue: { count: 1, amount: '144.95' },
    week: { count: 2, amount: '289.90' },
    paid: { count: 2, amount: '300.00' },
    canceled: { count: 0, amount: '0.00' },
    all: { count: 7, amount: '1024.75' },
  },
};

const forecast: Forecast = {
  today: TODAY,
  buckets: [
    { key: 'overdue', kind: 'overdue', from: null, to: '2026-10-12', count: 1, amount: '144.95' },
    { key: 'w0', kind: 'week', from: '2026-10-13', to: '2026-10-19', count: 2, amount: '289.90' },
    { key: 'w1', kind: 'week', from: '2026-10-20', to: '2026-10-26', count: 0, amount: '0.00' },
    { key: 'later', kind: 'later', from: '2026-12-08', to: null, count: 1, amount: '144.95' },
  ],
};

describe('Overview', () => {
  const html = renderToStaticMarkup(<Overview summary={summary} forecast={forecast} filters={DEFAULT_FILTERS} onView={noop} onBucket={noop} />);
  it('mostra os quatro indicadores com valores em reais', () => {
    expect(html).toContain('A pagar');
    expect(html).toContain('Vencidas');
    expect(html).toContain('Próximos 7 dias');
    expect(html).toContain('Pago em outubro');
    expect(html).toMatch(/R\$\s*724,75/);
  });
  it('cada barra é um botão com rótulo acessível e a vencida leva ícone', () => {
    expect(html).toMatch(/aria-label="Vencidas: R\$\s*144,95 em 1 parcela"/);
    expect(html).toContain('<button');
    expect(html).toContain('Venc.');
  });
  it('sem nada em aberto não desenha barras', () => {
    const empty = { ...forecast, buckets: forecast.buckets.map((b) => ({ ...b, count: 0, amount: '0.00' })) };
    expect(renderToStaticMarkup(<Overview summary={summary} forecast={empty} filters={DEFAULT_FILTERS} onView={noop} onBucket={noop} />)).toContain('Nenhuma conta em aberto');
  });
});

describe('PayableList', () => {
  const base = { today: TODAY, selected: new Set<string>(), focusedId: null, loading: false, hasFilters: false, onClearFilters: noop, onNew: noop, onOpen: noop, onToggle: noop, onPay: noop, onCopyBarcode: noop };

  it('agrupa por vencimento com subtotal e marca a vencida', () => {
    const html = renderToStaticMarkup(<PayableList {...base} filters={DEFAULT_FILTERS} rows={[row('a', '2026-10-10'), row('b', '2026-10-13'), row('c', '2026-12-01')]} />);
    expect(html).toContain('Vencidas');
    expect(html).toContain('Hoje');
    expect(html).toContain('Mais adiante');
    expect(html).toContain('Atrasada 3 dias');
    expect(html).toContain('AP'); // avatar
    expect(html).toContain('1/3');
  });

  it('seleção aparece marcada e acessível', () => {
    const html = renderToStaticMarkup(<PayableList {...base} selected={new Set(['a'])} filters={DEFAULT_FILTERS} rows={[row('a', '2026-10-13')]} />);
    expect(html).toContain('aria-selected="true"');
    expect(html).toContain('checked');
  });

  it('conta paga mostra valor pago e o previsto quando diferem', () => {
    const paid = row('p', '2026-10-01', { status: 'PAID', paidAt: '2026-10-05T00:00:00.000Z', paidAmount: '150.00', paymentMethod: 'PIX' });
    const html = renderToStaticMarkup(<PayableList {...base} filters={{ ...DEFAULT_FILTERS, view: 'paid' }} rows={[paid]} />);
    expect(html).toMatch(/R\$\s*150,00/);
    expect(html).toContain('prev.');
    expect(html).toContain('Pix');
  });

  it('lista vazia: estado vazio com chamada para ação; filtrada oferece limpar', () => {
    expect(renderToStaticMarkup(<PayableList {...base} filters={DEFAULT_FILTERS} rows={[]} />)).toContain('Nova conta');
    expect(renderToStaticMarkup(<PayableList {...base} hasFilters filters={DEFAULT_FILTERS} rows={[]} />)).toContain('Limpar filtros');
  });
});

describe('Toolbar e BulkBar', () => {
  it('abas com contagem, filtros e exportação', () => {
    const html = renderToStaticMarkup(
      <Toolbar filters={{ ...DEFAULT_FILTERS, supplier: 'ACME' }} summary={summary} suppliers={[]} categories={['Compras']} today={TODAY} searchRef={noop} onChange={noop} />,
    );
    expect(html).toContain('Em aberto');
    expect(html).toContain('Fornecedor: ACME');
    expect(html).toContain('Limpar filtros');
    expect(html).toContain('/api/payables/export?');
  });
  it('barra de seleção some sem seleção e mostra o total quando há', () => {
    expect(renderToStaticMarkup(<BulkBar count={0} amount="0" canPay canManage onPay={noop} onCancel={noop} onClear={noop} />)).toBe('');
    const html = renderToStaticMarkup(<BulkBar count={3} amount="434.85" canPay canManage onPay={noop} onCancel={noop} onClear={noop} />);
    expect(html).toContain('3 contas');
    expect(html).toMatch(/R\$\s*434,85/);
  });
});
