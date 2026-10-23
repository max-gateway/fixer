import { describe, expect, it } from 'vitest';
import { classifyBarcodeLinks } from './catalog-link.js';

const A = '7891111111111';
const B = '7892222222222';

describe('classifyBarcodeLinks (peça da oficina × GTIN do catálogo)', () => {
  it('um GTIN que casa com exatamente uma peça do catálogo, livre: vinculável', () => {
    const out = classifyBarcodeLinks([{ id: 'p1', ean: A }], [{ barcode: A, skus: ['cat-1'] }], new Map());
    expect(out).toEqual([{ kind: 'LINKABLE', partId: 'p1', catalogSku: 'cat-1' }]);
  });

  it('GTIN sem peça no catálogo: sem correspondência', () => {
    expect(classifyBarcodeLinks([{ id: 'p1', ean: A }], [{ barcode: A, skus: [] }], new Map())).toEqual([{ kind: 'NO_MATCH', partId: 'p1' }]);
  });

  it('GTIN ausente da resposta também é sem correspondência', () => {
    expect(classifyBarcodeLinks([{ id: 'p1', ean: A }], [], new Map())).toEqual([{ kind: 'NO_MATCH', partId: 'p1' }]);
  });

  it('GTIN de mais de uma peça do catálogo (duplicidade no cadastro): ambíguo, quem decide é a pessoa', () => {
    const out = classifyBarcodeLinks([{ id: 'p1', ean: A }], [{ barcode: A, skus: ['cat-1', 'cat-2'] }], new Map());
    expect(out).toEqual([{ kind: 'AMBIGUOUS_CATALOG', partId: 'p1', catalogSkus: ['cat-1', 'cat-2'] }]);
  });

  it('a peça do catálogo já está vinculada a OUTRA peça da oficina: conflito, nada é vinculado', () => {
    const out = classifyBarcodeLinks([{ id: 'p1', ean: A }], [{ barcode: A, skus: ['cat-1'] }], new Map([['cat-1', 'p9']]));
    expect(out).toEqual([{ kind: 'CONFLICT', partId: 'p1', catalogSku: 'cat-1', takenBy: 'p9' }]);
  });

  it('já vinculada à PRÓPRIA peça não é conflito (repetir é seguro)', () => {
    const out = classifyBarcodeLinks([{ id: 'p1', ean: A }], [{ barcode: A, skus: ['cat-1'] }], new Map([['cat-1', 'p1']]));
    expect(out).toEqual([{ kind: 'LINKABLE', partId: 'p1', catalogSku: 'cat-1' }]);
  });

  it('duas peças da oficina com o MESMO GTIN: ambíguo local, nenhuma é vinculada sozinha', () => {
    const out = classifyBarcodeLinks(
      [
        { id: 'p1', ean: A },
        { id: 'p2', ean: A },
      ],
      [{ barcode: A, skus: ['cat-1'] }],
      new Map(),
    );
    expect(out).toEqual([
      { kind: 'AMBIGUOUS_LOCAL', partId: 'p1', ean: A, partIds: ['p1', 'p2'] },
      { kind: 'AMBIGUOUS_LOCAL', partId: 'p2', ean: A, partIds: ['p1', 'p2'] },
    ]);
  });

  it('duas peças da oficina com GTIN diferentes que apontam para a MESMA peça do catálogo: as duas viram conflito (a unicidade do vínculo não deixa vincular ambas)', () => {
    const out = classifyBarcodeLinks(
      [
        { id: 'p1', ean: A },
        { id: 'p2', ean: B },
      ],
      [
        { barcode: A, skus: ['cat-1'] },
        { barcode: B, skus: ['cat-1'] },
      ],
      new Map(),
    );
    expect(out).toEqual([
      { kind: 'CONFLICT', partId: 'p1', catalogSku: 'cat-1', takenBy: 'p2' },
      { kind: 'CONFLICT', partId: 'p2', catalogSku: 'cat-1', takenBy: 'p1' },
    ]);
  });

  it('cada peça recebe exatamente um veredito, na ordem da entrada', () => {
    const parts = [
      { id: 'a', ean: A },
      { id: 'b', ean: B },
      { id: 'c', ean: '7893333333333' },
    ];
    const out = classifyBarcodeLinks(parts, [{ barcode: A, skus: ['x'] }, { barcode: B, skus: [] }], new Map());
    expect(out.map((v) => [v.partId, v.kind])).toEqual([
      ['a', 'LINKABLE'],
      ['b', 'NO_MATCH'],
      ['c', 'NO_MATCH'],
    ]);
  });

  it('lista vazia devolve lista vazia', () => {
    expect(classifyBarcodeLinks([], [], new Map())).toEqual([]);
  });
});
