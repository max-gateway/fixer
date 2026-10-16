// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { MarkupSlider, type SliderMark } from './markup-slider';

beforeAll(() => {
  // O Radix mede o controle com ResizeObserver, que o jsdom não traz.
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
});
afterEach(cleanup);

const marks: SliderMark[] = [
  { value: 40, label: 'regra', tone: 'rule' },
  { value: 100, label: '100%', tone: 'preset' },
];

function setup(props: Partial<React.ComponentProps<typeof MarkupSlider>> = {}) {
  const onChange = vi.fn();
  const onCommit = vi.fn();
  render(<MarkupSlider label="Markup" value={50} min={0} max={200} step={1} marks={marks} onChange={onChange} onCommit={onCommit} {...props} />);
  return { onChange, onCommit, thumb: screen.getByRole('slider'), input: screen.getByRole('textbox', { name: 'Markup' }) as HTMLInputElement };
}

describe('MarkupSlider', () => {
  it('mostra o rótulo, o valor com vírgula decimal, a unidade e os atalhos', () => {
    setup({ value: 37.5 });
    expect((screen.getByRole('textbox', { name: 'Markup' }) as HTMLInputElement).value).toBe('37,5');
    expect(screen.getByText('%')).toBeTruthy();
    expect(screen.getByRole('slider').getAttribute('aria-valuenow')).toBe('37.5');
    expect(screen.getByRole('button', { name: 'regra' })).toBeTruthy();
    expect(screen.getByRole('button', { name: '100%' })).toBeTruthy();
  });

  it('o polegar tem nome acessível e os limites da escala', () => {
    const { thumb } = setup();
    expect(thumb.getAttribute('aria-label')).toBe('Markup');
    expect(thumb.getAttribute('aria-valuemin')).toBe('0');
    expect(thumb.getAttribute('aria-valuemax')).toBe('200');
  });

  it('seta para a direita sobe um passo e já grava (teclado conta como soltar)', async () => {
    const { thumb, onChange, onCommit } = setup();
    thumb.focus();
    await userEvent.keyboard('{ArrowRight}');
    expect(onChange).toHaveBeenLastCalledWith(51);
    expect(onCommit).toHaveBeenLastCalledWith(51);
    await userEvent.keyboard('{ArrowLeft}');
    expect(onChange).toHaveBeenLastCalledWith(49);
  });

  it('Home e End vão às pontas da escala', async () => {
    const { thumb, onChange } = setup();
    thumb.focus();
    await userEvent.keyboard('{End}');
    expect(onChange).toHaveBeenLastCalledWith(200);
    await userEvent.keyboard('{Home}');
    expect(onChange).toHaveBeenLastCalledWith(0);
  });

  it('digitar um número com vírgula e apertar Enter muda e grava', async () => {
    const { input, onChange, onCommit } = setup();
    await userEvent.clear(input);
    await userEvent.type(input, '75,5{Enter}');
    expect(onChange).toHaveBeenLastCalledWith(75.5);
    expect(onCommit).toHaveBeenLastCalledWith(75.5);
  });

  it('sair do campo também grava; valor inválido volta ao que estava', async () => {
    const { input, onChange, onCommit } = setup();
    await userEvent.clear(input);
    await userEvent.type(input, 'abc');
    fireEvent.blur(input);
    expect(onChange).not.toHaveBeenCalled();
    expect(onCommit).not.toHaveBeenCalled();
    expect(input.value).toBe('50');
    await userEvent.clear(input);
    await userEvent.type(input, '60');
    fireEvent.blur(input);
    expect(onCommit).toHaveBeenLastCalledWith(60);
  });

  it('Esc descarta o que foi digitado', async () => {
    const { input, onChange } = setup();
    await userEvent.clear(input);
    await userEvent.type(input, '99{Escape}');
    expect(input.value).toBe('50');
    expect(onChange).not.toHaveBeenCalled();
  });

  it('clicar num atalho vai direto ao valor e grava', async () => {
    const { onChange, onCommit } = setup();
    await userEvent.click(screen.getByRole('button', { name: 'regra' }));
    expect(onChange).toHaveBeenLastCalledWith(40);
    expect(onCommit).toHaveBeenLastCalledWith(40);
  });

  it('com onPickMark, clicar no atalho entrega o marcador inteiro (com o preço exato) e não mexe em onChange', async () => {
    const onPickMark = vi.fn();
    const { onChange, onCommit } = setup({ onPickMark, marks: [{ value: 60.9, label: 'regra', tone: 'rule', price: 160.9 }] });
    await userEvent.click(screen.getByRole('button', { name: 'regra' }));
    expect(onPickMark).toHaveBeenCalledWith({ value: 60.9, label: 'regra', tone: 'rule', price: 160.9 });
    expect(onChange).not.toHaveBeenCalled();
    expect(onCommit).not.toHaveBeenCalled();
  });

  it('desativado: nem digita nem desliza nem atalha', async () => {
    const { input, thumb, onChange } = setup({ disabled: true });
    expect(input.disabled).toBe(true);
    expect(thumb.getAttribute('data-disabled')).not.toBeNull();
    await userEvent.click(screen.getByRole('button', { name: '100%' }));
    expect(onChange).not.toHaveBeenCalled();
  });

  it('erro aparece como alerta e marca o campo como inválido', () => {
    setup({ error: 'Informe um número' });
    expect(screen.getByRole('alert').textContent).toBe('Informe um número');
    expect(screen.getByRole('textbox', { name: 'Markup' }).getAttribute('aria-invalid')).toBe('true');
  });

  it('valor acima da escala não quebra o controle: o polegar fica na ponta', () => {
    const { thumb } = setup({ value: 500 });
    expect(thumb.getAttribute('aria-valuenow')).toBe('200');
  });
});
