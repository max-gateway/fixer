import { describe, expect, it } from 'vitest';
import { normalizeSlug, resolveVariantChain } from './vehicle-variant.js';

const palio = {
  basico: {
    dados: {
      marca: 'FIAT',
      modelo: 'PALIO FIRE ECONOMY',
      cilindradas: 999,
      combustivel: 'ALCOOL / GASOLINA',
      anoModelo: 2015,
    },
  },
  fipe: { dados: [{ codigo_fipe: '001267-0', marca: 'Fiat', modelo: 'Palio Fire Economy 1.0 8V' }] },
};

describe('normalizeSlug', () => {
  it('remove acentos, caixa e pontuação', () => {
    expect(normalizeSlug('  Citroën C3 / Aircross ')).toBe('citroen-c3-aircross');
  });
});

describe('resolveVariantChain', () => {
  it('com código FIPE devolve a cadeia completa MAKE > MODEL > FAMILY > VERSION', () => {
    const r = resolveVariantChain(palio);
    expect(r.resolution).toBe('FIPE');
    expect(r.chain.map((n) => [n.level, n.key])).toEqual([
      ['MAKE', 'fiat'],
      ['MODEL', 'fiat/palio'],
      ['FAMILY', 'fiat/palio/1.0/flex'],
      ['VERSION', 'fipe:001267-0'],
    ]);
  });

  it('é determinístico: o mesmo JSON gera as mesmas chaves', () => {
    expect(resolveVariantChain(palio)).toEqual(resolveVariantChain(structuredClone(palio)));
  });

  it('o VERSION fica sob a FAMILY e carrega o ano-modelo como atributo, não na chave', () => {
    const version = resolveVariantChain(palio).chain.at(-1)!;
    expect(version.parentKey).toBe('fiat/palio/1.0/flex');
    expect(version.fipeCode).toBe('001267-0');
    expect(resolveVariantChain({ ...palio, basico: { dados: { ...palio.basico.dados, anoModelo: 2012 } } }).chain.at(-1)!.key)
      .toBe(version.key);
  });

  it('sem FIPE mas com motor e combustível desce até FAMILY', () => {
    const r = resolveVariantChain({ basico: palio.basico });
    expect(r.resolution).toBe('FAMILY');
    expect(r.chain.map((n) => n.level)).toEqual(['MAKE', 'MODEL', 'FAMILY']);
  });

  it('sem cilindradas/combustível desce até MODEL', () => {
    const r = resolveVariantChain({ basico: { dados: { marca: 'FIAT', modelo: 'PALIO FIRE' } } });
    expect(r.resolution).toBe('MODEL');
    expect(r.chain.map((n) => n.key)).toEqual(['fiat', 'fiat/palio']);
  });

  it('só com marca resolve MAKE', () => {
    const r = resolveVariantChain({ basico: { dados: { marca: 'FIAT' } } });
    expect(r.resolution).toBe('MAKE');
    expect(r.chain.map((n) => n.key)).toEqual(['fiat']);
  });

  it('sem marca resolve NONE com cadeia vazia, sem erro', () => {
    expect(resolveVariantChain({})).toEqual({ resolution: 'NONE', chain: [] });
    expect(resolveVariantChain({ basico: { dados: { modelo: 'PALIO' } } })).toEqual({ resolution: 'NONE', chain: [] });
  });

  it('o MODEL usa só a primeira palavra do modelo (o resto é versão)', () => {
    const r = resolveVariantChain({ basico: { dados: { marca: 'VW', modelo: 'GOL 1.6 MSI TOTAL FLEX' } } });
    expect(r.chain.map((n) => n.key)).toEqual(['vw', 'vw/gol']);
  });

  it('modelos de várias palavras vêm de uma lista informada pelo catálogo', () => {
    const input = { basico: { dados: { marca: 'FIAT', modelo: 'GRAND SIENA ATTRACTIVE' } } };
    expect(resolveVariantChain(input).chain.map((n) => n.key)).toEqual(['fiat', 'fiat/grand']);
    expect(resolveVariantChain(input, { multiWordModels: ['grand siena'] }).chain.map((n) => n.key)).toEqual([
      'fiat',
      'fiat/grand-siena',
    ]);
  });

  it('aceita números como string, como o provedor devolve', () => {
    const r = resolveVariantChain({
      basico: { dados: { marca: 'FIAT', modelo: 'UNO', cilindradas: '999', combustivel: 'GASOLINA' } },
    });
    expect(r.chain.at(-1)!.key).toBe('fiat/uno/1.0/gasolina');
  });

  it('arredonda cilindradas para litros com 1 casa (1598 → 1.6, 999 → 1.0)', () => {
    const k = (cc: number) =>
      resolveVariantChain({ basico: { dados: { marca: 'VW', modelo: 'GOL', cilindradas: cc, combustivel: 'FLEX' } } })
        .chain.at(-1)!.key;
    expect(k(1598)).toBe('vw/gol/1.6/flex');
    expect(k(999)).toBe('vw/gol/1.0/flex');
  });
});
