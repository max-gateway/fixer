// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import type { PricingPlanView, PricingRowView } from '@/lib/pricing';
import { buildMarks, MarkupPopover, scaleMax } from './price-slider';

beforeAll(() => {
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
});
afterEach(cleanup);

const rule = { method: 'MARGIN' as const, value: '30', overheadPct: '0', rounding: 'CENTS_90', minMarginPct: '20', maxJumpPct: '25' };
const plan = { rule } as unknown as PricingPlanView;
const row = (o: Partial<PricingRowView> = {}) =>
  ({ itemNumber: 1, cost: '100', locked: false, proposed: '160.9', suggested: '160.9', currentPrice: '120', rule, saleTax: { pct: null, confidence: 'ESTIMADO', unavailable: 'SEM_ALIQUOTA', components: [] }, ...o }) as unknown as PricingRowView;

async function open(r: PricingRowView, onApply = vi.fn()) {
  render(<MarkupPopover row={r} plan={plan} busy={false} onApply={onApply} />);
  await userEvent.click(screen.getByRole('button', { name: 'Ajustar o preço pelo markup' }));
  return onApply;
}

describe('buildMarks / scaleMax', () => {
  it('traz a regra e o preço atual e corta os atalhos que cairiam em cima', () => {
    const m = buildMarks({ cost: 100, suggested: 161, current: 140, max: 200 });
    expect(m.map((x) => `${x.tone}:${x.value}`)).toEqual(['rule:61', 'current:40', 'preset:100']);
    expect(m[0]!.price).toBe(161);
    expect(m[1]!.price).toBe(140);
  });

  it('sem regra nem preço atual, só os atalhos', () => {
    expect(buildMarks({ cost: 100, suggested: null, current: null, max: 200 }).map((x) => x.value)).toEqual([30, 50, 100]);
  });

  it('a regra tem prioridade sobre o preço atual quando coincidem', () => {
    const m = buildMarks({ cost: 100, suggested: 150, current: 152, max: 200 });
    expect(m.filter((x) => x.tone !== 'preset').map((x) => x.tone)).toEqual(['rule']);
  });

  it('a escala cresce para caber markups grandes, em passos de 50', () => {
    expect(scaleMax(0)).toBe(250);
    expect(scaleMax(300)).toBe(350);
    expect(scaleMax(Number.NaN, 10)).toBe(250);
  });
});

describe('MarkupPopover', () => {
  it('não aparece sem custo ou com a peça travada', () => {
    const { container, rerender } = render(<MarkupPopover row={row({ cost: null })} plan={plan} busy={false} onApply={vi.fn()} />);
    expect(container.querySelector('button')).toBeNull();
    rerender(<MarkupPopover row={row({ locked: true })} plan={plan} busy={false} onApply={vi.fn()} />);
    expect(container.querySelector('button')).toBeNull();
  });

  it('abre no markup do preço que vale agora e mostra preço e margem', async () => {
    await open(row());
    expect((screen.getByRole('textbox', { name: 'Markup' }) as HTMLInputElement).value).toBe('60,9');
    expect(screen.getByText(/R\$\s*160,90/)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'regra' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'atual' })).toBeTruthy();
  });

  it('deslizar por teclado grava o preço do novo markup, arredondado como a regra', async () => {
    const onApply = await open(row());
    screen.getByRole('slider').focus();
    await userEvent.keyboard('{ArrowRight}');
    expect(onApply).toHaveBeenCalledTimes(1);
    expect(onApply.mock.calls[0]![0]).toBeCloseTo(162.9, 5); // markup 62% → 162 → terminar em ,90
  });

  it('clicar em "regra" volta ao preço sugerido', async () => {
    const onApply = await open(row({ proposed: '140' }));
    await userEvent.click(screen.getByRole('button', { name: 'regra' }));
    expect(onApply.mock.calls.at(-1)![0]).toBe(160.9); // o preço exato da regra, não o do markup arredondado
    expect((screen.getByRole('textbox', { name: 'Markup' }) as HTMLInputElement).value).toBe('60,9');
  });

  it('abre mostrando o preço que está no campo, mesmo que não termine em ,90', async () => {
    await open(row({ proposed: '200', suggested: '160.9' }));
    expect(screen.getByText(/R\$\s*200,00/)).toBeTruthy();
  });

  it('depois de mexer no controle o preço volta a seguir o arredondamento da regra', async () => {
    await open(row({ proposed: '200', suggested: '160.9' }));
    screen.getByRole('slider').focus();
    await userEvent.keyboard('{ArrowRight}');
    expect(screen.getByText(/R\$\s*201,90/)).toBeTruthy(); // 101% → 201 → ,90
  });

  it('avisa quando fica abaixo da margem mínima da regra', async () => {
    await open(row({ proposed: '110', suggested: '160.9' }));
    expect(screen.getByText(/Abaixo da margem mínima da regra \(20%\)/)).toBeTruthy();
  });

  it('avisa que o lançamento fica bloqueado quando o preço não cobre o custo', async () => {
    // markup 5% com 10% de imposto: 105,90 × 90% = 95,31 < 100
    await open(row({ proposed: '105', saleTax: { pct: '10', confidence: 'ESTIMADO', unavailable: null, components: [] } }));
    screen.getByRole('slider').focus();
    await userEvent.keyboard('{ArrowRight}');
    expect(screen.getByText(/não cobre o custo/)).toBeTruthy();
  });

  it('com imposto calculado, a margem desconta o imposto', async () => {
    await open(row({ proposed: '200', saleTax: { pct: '10', confidence: 'ESTIMADO', unavailable: null, components: [] } }));
    // 200 × 90% = 180; (180 − 100) ÷ 200 = 40%
    expect(screen.getByText('40%')).toBeTruthy();
    expect(screen.queryByText(/não cobre o custo/)).toBeNull();
  });
});
