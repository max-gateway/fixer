import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { dayLabel, groupByDay, initials, nextAction, resolvedRatio, type InvoiceRow, type View } from '@/lib/invoices';
import { InvoiceList } from './invoice-list';
import { Pipeline } from './pipeline';

const row = (id: string, o: Partial<InvoiceRow> = {}): InvoiceRow => ({
  id,
  accessKey: 'x'.repeat(44),
  number: 1234,
  series: 1,
  issuedAt: '2026-10-13T15:00:00.000Z',
  issuerName: 'AUTO PECAS DISTRIBUIDORA LTDA',
  issuerCnpj: '11222333000181',
  totalAmount: '1450.50',
  status: 'FULL',
  exportStatus: 'PENDING_MATCH',
  needsReview: false,
  manifestError: null,
  itemCount: 4,
  unresolvedCount: 1,
  ...o,
});

const counts: Record<View, number> = { pending: 3, ready: 2, posted: 10, summary: 1, canceled: 0, ignored: 4, all: 20 };

describe('helpers', () => {
  it('escolhe a próxima ação', () => {
    expect(nextAction(row('a', { status: 'SUMMARY' }))).toBe('manifest');
    expect(nextAction(row('a', { exportStatus: 'READY' }))).toBe('confirm');
    expect(nextAction(row('a', { exportStatus: 'READY', needsReview: true }))).toBe('review');
    expect(nextAction(row('a', { exportStatus: 'POSTED' }))).toBeNull();
  });
  it('calcula o progresso só para notas com XML', () => {
    expect(resolvedRatio(row('a'))).toBe(0.75);
    expect(resolvedRatio(row('a', { status: 'SUMMARY', itemCount: 0 }))).toBeNull();
  });
  it('agrupa por dia e rotula Hoje/Ontem', () => {
    const now = new Date('2026-10-13T18:00:00Z');
    expect(dayLabel('2026-10-13T15:00:00Z', now)).toBe('Hoje');
    expect(dayLabel('2026-10-12T15:00:00Z', now)).toBe('Ontem');
    expect(dayLabel(null, now)).toBe('Sem data');
    const g = groupByDay([row('a'), row('b'), row('c', { issuedAt: '2026-10-01T12:00:00Z' })], now);
    expect(g.map((x) => x.rows.length)).toEqual([2, 1]);
  });
  it('gera iniciais ignorando sufixos', () => {
    expect(initials('AUTO PECAS DISTRIBUIDORA LTDA')).toBe('AP');
    expect(initials('Zé & Cia ME')).toBe('ZC');
  });
});

describe('Pipeline', () => {
  it('mostra as quatro etapas com contagem e marca a ativa', () => {
    const html = renderToStaticMarkup(<Pipeline view="ready" counts={counts} onView={vi.fn()} />);
    expect(html).toContain('Para conciliar');
    expect(html).toContain('Prontas');
    expect(html).toMatch(/aria-current="page"[^>]*>[\s\S]*Prontas/);
  });
});

describe('InvoiceList', () => {
  const props = { view: 'pending' as View, filtered: false, loading: false, activeId: null, focusedId: null, selected: new Set<string>(), onOpen: vi.fn(), onToggle: vi.fn(), onHover: vi.fn() };
  it('lista as notas com valor e situação', () => {
    const html = renderToStaticMarkup(<InvoiceList {...props} rows={[row('a')]} />);
    expect(html).toContain('AUTO PECAS DISTRIBUIDORA LTDA');
    expect(html).toContain('Conciliar itens');
    expect(html).toContain('1 sem peça');
  });
  it('mostra o vazio específico da etapa e o da busca', () => {
    expect(renderToStaticMarkup(<InvoiceList {...props} rows={[]} />)).toContain('Nada para conciliar');
    expect(renderToStaticMarkup(<InvoiceList {...props} rows={[]} filtered />)).toContain('Nenhuma nota com essa busca');
  });
});
