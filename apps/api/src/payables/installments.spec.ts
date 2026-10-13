import { describe, expect, it } from 'vitest';
import { BILLING_3X, makeProcNfe, PAG_CASH } from '../../test/fiscal/nfe-xml.js';
import { parseProcNfe } from '../fiscal-inbound/parser/nfe.parser.js';
import { draftPayables } from './installments.js';

const draft = (billing?: string) => draftPayables(parseProcNfe(makeProcNfe({ billing }).xml));

describe('parser: cobrança', () => {
  it('lê as duplicatas e o pagamento declarado', () => {
    const nfe = parseProcNfe(makeProcNfe({ billing: BILLING_3X }).xml);
    expect(nfe.installments).toEqual([
      { number: '001', dueDate: '2026-11-05', amount: '144.95' },
      { number: '002', dueDate: '2026-12-05', amount: '144.95' },
      { number: '003', dueDate: '2027-01-05', amount: '144.95' },
    ]);
    expect(nfe.declaredPayment).toBe('434.85');
  });

  it('uma única duplicata (o parser a trata como lista)', () => {
    const one = '<cobr><dup><nDup>1</nDup><dVenc>2026-11-01</dVenc><vDup>10.00</vDup></dup></cobr>';
    expect(parseProcNfe(makeProcNfe({ billing: one }).xml).installments).toHaveLength(1);
  });

  it('sem cobr nem pag: nada declarado; tPag 90 (sem pagamento) não conta', () => {
    const none = parseProcNfe(makeProcNfe().xml);
    expect(none.installments).toEqual([]);
    expect(none.declaredPayment).toBeNull();
    const free = '<pag><detPag><tPag>90</tPag><vPag>0.00</vPag></detPag></pag>';
    expect(parseProcNfe(makeProcNfe({ billing: free }).xml).declaredPayment).toBeNull();
  });
});

describe('draftPayables', () => {
  it('uma parcela por duplicata, numeradas e com a data civil do XML', () => {
    const d = draft(BILLING_3X);
    expect(d).toHaveLength(3);
    expect(d[0]).toMatchObject({ source: 'XML_INSTALLMENT', installment: 1, installmentCount: 3, documentNumber: '001', amount: '144.95' });
    expect(d[2]!.dueDate.toISOString()).toBe('2027-01-05T00:00:00.000Z');
  });

  it('sem duplicatas, pagamento declarado vira parcela única na emissão', () => {
    const d = draft(PAG_CASH);
    expect(d).toEqual([
      expect.objectContaining({ source: 'XML_TOTAL', installment: 1, installmentCount: 1, documentNumber: '1234', amount: '434.85' }),
    ]);
    expect(d[0]!.dueDate.toISOString()).toBe('2026-10-05T00:00:00.000Z');
  });

  it('sem nenhuma informação de cobrança, não inventa conta', () => {
    expect(draft()).toEqual([]);
  });

  it('descarta duplicata com valor zerado ou malformado; vencimento ausente cai na emissão', () => {
    const odd = `<cobr>
      <dup><nDup>1</nDup><dVenc>2026-11-01</dVenc><vDup>0.00</vDup></dup>
      <dup><nDup>2</nDup><dVenc>2026-11-01</dVenc><vDup>abc</vDup></dup>
      <dup><nDup>3</nDup><vDup>50.5</vDup></dup>
    </cobr>`;
    const d = draft(odd);
    expect(d).toHaveLength(1);
    expect(d[0]).toMatchObject({ installment: 1, installmentCount: 1, documentNumber: '3', amount: '50.50' });
    expect(d[0]!.dueDate.toISOString()).toBe('2026-10-05T00:00:00.000Z');
  });
});
