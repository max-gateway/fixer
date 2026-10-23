// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { CostAlert } from '@/lib/invoice-cost';
import type { InvoiceNotice } from '@/lib/invoice-view';

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

import { AttentionPanel } from './attention';
import { InvoiceActions } from './invoice-actions';
import { InvoiceStepper } from './invoice-stepper';
import { invoiceSteps } from './steps';

afterEach(cleanup);

const withClient = (ui: React.ReactNode) => render(<QueryClientProvider client={new QueryClient()}>{ui}</QueryClientProvider>);
const item = (n: number, resolution: 'UNRESOLVED' | 'MANUAL') => ({ itemNumber: n, resolution });
const full = { status: 'FULL' as const, exportStatus: 'PENDING_MATCH' as const, postedAt: null };

describe('InvoiceStepper', () => {
  it('anuncia a etapa atual e o progresso da conciliação', () => {
    render(<InvoiceStepper steps={invoiceSteps({ ...full, items: [item(1, 'MANUAL'), item(2, 'UNRESOLVED')] })} />);
    const nav = screen.getByRole('navigation', { name: 'Etapas da nota' });
    const current = within(nav).getByRole('link', { current: 'step' });
    expect(current.textContent).toContain('Conciliar itens');
    expect(current.textContent).toContain('1 de 2 vinculados');
    expect(current.getAttribute('href')).toBe('#conciliar');
  });

  it('não renderiza nada sem etapas (resumo, sem itens)', () => {
    const { container } = render(<InvoiceStepper steps={[]} />);
    expect(container.innerHTML).toBe('');
  });
});

describe('AttentionPanel', () => {
  const warn: InvoiceNotice = { id: 'needs-review', tone: 'warning', title: 'Nota de finalidade “Devolução”.', detail: 'Confira os itens.' };
  const info: InvoiceNotice = { id: 'ready', tone: 'info', title: 'Todos os itens estão vinculados.' };
  const alert: CostAlert = { code: 'FRETE', severity: 'info', message: 'Frete por fora.', itemNumbers: [1, 2] } as CostAlert;

  it('deixa à vista o que pede decisão e esconde o informativo em “Informações”', () => {
    render(<AttentionPanel notices={[warn, info]} alerts={[alert]} />);
    expect(screen.getByText(/Nota de finalidade/)).toBeTruthy();
    const summary = screen.getByText(/Informações/);
    expect(summary.textContent).toContain('(2)');
    expect(summary.closest('details')!.hasAttribute('open')).toBe(false);
  });

  it('só informativo e um único aviso: abre sozinho', () => {
    render(<AttentionPanel notices={[info]} alerts={[]} />);
    expect(screen.getByText(/Informações/).closest('details')!.hasAttribute('open')).toBe(true);
  });

  it('nada a dizer: nada na tela', () => {
    const { container } = render(<AttentionPanel notices={[]} alerts={[]} />);
    expect(container.innerHTML).toBe('');
  });

  it('o alerta recebe a ação da página (conta a pagar da entrada)', () => {
    const st = { code: 'ST_ENTRADA_PE', severity: 'warning', message: 'ICMS-ST na entrada.', itemNumbers: [], amount: '10.00' } as unknown as CostAlert;
    render(<AttentionPanel notices={[]} alerts={[st]} action={() => <button type="button">Criar conta</button>} />);
    expect(screen.getByRole('button', { name: 'Criar conta' })).toBeTruthy();
  });
});

describe('InvoiceActions: uma ação principal por vez', () => {
  const base = { id: 'n1', canManifest: false, needsReview: false, editable: true, ready: false };

  it('resumo: dar ciência', () => {
    withClient(<InvoiceActions {...base} editable={false} canManifest />);
    expect(screen.getByRole('button', { name: /Dar ciência/ })).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Lançar entrada/ })).toBeNull();
  });

  it('itens pendentes: o botão principal leva ao primeiro item sem peça', () => {
    withClient(<InvoiceActions {...base} unresolvedCount={2} firstPending={3} hasItems />);
    const link = screen.getByRole('link', { name: /Vincular 2 itens pendentes/ });
    expect(link.getAttribute('href')).toBe('#item-3');
    expect(screen.queryByRole('button', { name: /Lançar entrada/ })).toBeNull();
  });

  it('nota que pede revisão: revisar vem antes de vincular ou lançar', () => {
    withClient(<InvoiceActions {...base} needsReview unresolvedCount={1} firstPending={1} ready />);
    expect(screen.getByRole('button', { name: /Revisei esta nota/ })).toBeTruthy();
    expect(screen.queryByRole('link', { name: /Vincular/ })).toBeNull();
    expect(screen.queryByRole('button', { name: /Lançar entrada/ })).toBeNull();
  });

  it('pronta: lançar é o principal e “Revisar preços antes” é o atalho secundário', () => {
    withClient(<InvoiceActions {...base} ready hasItems />);
    expect(screen.getByRole('button', { name: /Lançar entrada no estoque/ })).toBeTruthy();
    expect(screen.getByRole('link', { name: /Revisar preços antes/ }).getAttribute('href')).toBe('#precificar');
  });
});
