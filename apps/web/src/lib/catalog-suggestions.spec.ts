import { describe, expect, it, vi } from 'vitest';
import { loadSuggestions } from './catalog-suggestions';

const s = (itemId: string, partId = 'p1') => ({ itemId, partId, partSku: 'BE-1', partName: 'Bieleta', catalogSku: 'cat-1' });

describe('loadSuggestions (sugestões do catálogo para os itens da nota)', () => {
  it('pede à API da nota (id escapado) e indexa as sugestões pelo item', async () => {
    const get = vi.fn().mockResolvedValue({ suggestions: [s('it1'), s('it2', 'p2')], unmatched: 1 });
    const out = await loadSuggestions(get, 'inv/1', true);
    expect(get).toHaveBeenCalledWith('/invoices/inv%2F1/catalog-suggestions');
    expect([...out.keys()]).toEqual(['it1', 'it2']);
    expect(out.get('it2')?.partId).toBe('p2');
  });

  it('desligado (nota que não aceita conciliação, ou sem item pendente): nem chama a API', async () => {
    const get = vi.fn();
    expect((await loadSuggestions(get, 'inv1', false)).size).toBe(0);
    expect(get).not.toHaveBeenCalled();
  });

  it('o catálogo é um auxílio: qualquer falha (plataforma fora, sem permissão, sem catálogo configurado) vira "sem sugestões", nunca derruba a nota', async () => {
    for (const err of [new Error('503'), Object.assign(new Error('403'), { status: 403 }), 'texto solto']) {
      const get = vi.fn().mockRejectedValue(err);
      const out = await loadSuggestions(get, 'inv1', true);
      expect(out.size).toBe(0);
    }
  });

  it('resposta fora do formato também vira "sem sugestões"', async () => {
    expect((await loadSuggestions(vi.fn().mockResolvedValue({}), 'inv1', true)).size).toBe(0);
    expect((await loadSuggestions(vi.fn().mockResolvedValue(null), 'inv1', true)).size).toBe(0);
  });

  it('havendo duas sugestões para o mesmo item, vale a primeira', async () => {
    const get = vi.fn().mockResolvedValue({ suggestions: [s('it1', 'a'), s('it1', 'b')] });
    expect((await loadSuggestions(get, 'inv1', true)).get('it1')?.partId).toBe('a');
  });
});
