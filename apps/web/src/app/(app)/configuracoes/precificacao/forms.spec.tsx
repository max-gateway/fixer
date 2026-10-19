// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { RuleForm, type RuleSettings } from './pricing-settings-form';
import type { TaxReadiness } from './readiness';
import { TaxProfileForm, type TaxProfileSettings } from './tax-profile-form';

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

beforeAll(() => {
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
});
afterEach(cleanup);

const wrap = (ui: React.ReactElement) => render(<QueryClientProvider client={new QueryClient()}>{ui}</QueryClientProvider>);

const rule: RuleSettings = { method: 'MARGIN', value: '35', taxPctOverride: null, overheadPct: '0', rounding: 'CENTS_90', minMarginPct: '0', maxJumpPct: '25' };

describe('RuleForm com seletor de margem e markup', () => {
  it('mostra a margem na escala de margem e o exemplo numérico', () => {
    wrap(<RuleForm initial={rule} />);
    expect((screen.getByRole('textbox', { name: 'Margem desejada' }) as HTMLInputElement).value).toBe('35');
    expect(screen.getByRole('slider').getAttribute('aria-valuemax')).toBe('70');
    expect(screen.getByText(/Exemplo: peça que custa/)).toBeTruthy();
    expect(screen.getByText(/Equivale a um markup de 53,8%/)).toBeTruthy();
  });

  it('trocar para markup converte o valor para o equivalente e muda a escala', async () => {
    wrap(<RuleForm initial={rule} />);
    await userEvent.click(screen.getByRole('radio', { name: 'Markup sobre o custo' }));
    expect((screen.getByRole('textbox', { name: 'Markup' }) as HTMLInputElement).value).toBe('54'); // margem 35% = markup 53,8%
    expect(screen.getByRole('slider').getAttribute('aria-valuemax')).toBe('200');
    await userEvent.click(screen.getByRole('radio', { name: 'Margem sobre a venda' }));
    expect((screen.getByRole('textbox', { name: 'Margem desejada' }) as HTMLInputElement).value).toBe('35');
  });

  it('deslizar por teclado muda o valor e atualiza o exemplo', async () => {
    wrap(<RuleForm initial={rule} />);
    screen.getByRole('slider').focus();
    await userEvent.keyboard('{ArrowRight}{ArrowRight}'); // passo de 0,5
    expect((screen.getByRole('textbox', { name: 'Margem desejada' }) as HTMLInputElement).value).toBe('36');
  });

  it('margem, imposto e despesas somando 100% mostram o alerta de impossível', async () => {
    wrap(<RuleForm initial={{ ...rule, value: '70', overheadPct: '30' }} />);
    expect(screen.getByText(/não existe preço possível/)).toBeTruthy();
  });

  it('campos de percentual têm a unidade à vista', () => {
    wrap(<RuleForm initial={rule} />);
    expect(screen.getAllByText('%').length).toBeGreaterThanOrEqual(5);
  });
});

const profile: TaxProfileSettings = {
  rbt12: null, rbt12AsOf: null, icmsSalePct: null, simplesEffectiveRatePct: null, icmsSharePct: null, pisSharePct: null, cofinsSharePct: null,
  requireTaxConfirmation: false, reviewedBy: null, reviewedAt: null, rulesVersion: 'x',
};
const readiness = (regime: TaxReadiness['regime']): TaxReadiness => ({ regime, regimeInformed: true, supported: regime !== 'REAL', steps: [], requiredTables: [], ready: false, summary: '' });

describe('TaxProfileForm por regime', () => {
  it('Simples: pergunta a situação na SEFAZ estadual, com "não sei" quando não informada', () => {
    wrap(<TaxProfileForm initial={profile} readiness={readiness('SIMPLES')} canReview />);
    expect(screen.getByRole('radiogroup', { name: /Situação na SEFAZ estadual/ })).toBeTruthy();
    expect((screen.getByRole('radio', { name: /Não sei/ }) as HTMLButtonElement).getAttribute('aria-checked')).toBe('true');
  });

  it('Presumido não pergunta a situação na SEFAZ (a antecipação calculada é só do Simples)', () => {
    wrap(<TaxProfileForm initial={profile} readiness={readiness('PRESUMIDO')} canReview />);
    expect(screen.queryByRole('radiogroup', { name: /Situação na SEFAZ estadual/ })).toBeNull();
  });

  it('Simples: pede a RBT12 em reais e esconde o ICMS da venda; percentuais do contador ficam recolhidos', () => {
    wrap(<TaxProfileForm initial={profile} readiness={readiness('SIMPLES')} canReview />);
    expect(screen.getByRole('textbox', { name: /Receita dos últimos 12 meses/ })).toBeTruthy();
    expect(screen.getByText('R$')).toBeTruthy();
    expect(screen.queryByRole('textbox', { name: /ICMS cobrado na venda/ })).toBeNull();
    expect(screen.getByRole('button', { name: /Percentuais informados pelo contador/ }).getAttribute('aria-expanded')).toBe('false');
  });

  it('com percentuais já salvos, o bloco do contador abre sozinho', () => {
    wrap(<TaxProfileForm initial={{ ...profile, simplesEffectiveRatePct: '8' }} readiness={readiness('SIMPLES')} canReview />);
    expect(screen.getByRole('button', { name: /Percentuais informados pelo contador/ }).getAttribute('aria-expanded')).toBe('true');
  });

  it('Lucro Presumido: pede o ICMS da venda e não a repartição', () => {
    wrap(<TaxProfileForm initial={profile} readiness={readiness('PRESUMIDO')} canReview />);
    expect(screen.getByRole('textbox', { name: /ICMS cobrado na venda/ })).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Percentuais informados pelo contador/ })).toBeNull();
  });

  it('Lucro Real: explica que não há percentual e não oferece validação', () => {
    wrap(<TaxProfileForm initial={profile} readiness={readiness('REAL')} canReview />);
    expect(screen.getByText(/não existe um percentual sobre a venda/)).toBeTruthy();
    expect(screen.queryByText('Validação do contador')).toBeNull();
  });

  it('exigir confirmação é um interruptor com rótulo', async () => {
    wrap(<TaxProfileForm initial={profile} readiness={readiness('SIMPLES')} canReview />);
    const sw = screen.getByRole('switch', { name: /Exigir confirmação do enquadramento/ });
    expect(sw.getAttribute('aria-checked')).toBe('false');
    await userEvent.click(sw);
    expect(sw.getAttribute('aria-checked')).toBe('true');
  });
});
