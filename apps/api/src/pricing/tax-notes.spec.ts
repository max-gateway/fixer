import { describe, expect, it } from 'vitest';
import { resolveEnquadramento, taxNotes } from './tax-notes.js';

const today = '2026-10-13';
const codes = (i: Parameters<typeof taxNotes>[0]) => taxNotes(i).map((n) => n.code);

describe('avisos entre o XML e as tabelas de regra', () => {
  it('NCM de autopeça monofásica sem indicação na nota: avisa', () => {
    expect(codes({ ncm: '85111000', xmlMonofasico: false, xmlSt: false, asOf: today })).toContain('MONOFASICO_NA_LISTA_SEM_XML');
  });

  it('nota diz monofásico mas o NCM não está na lista: avisa', () => {
    expect(codes({ ncm: '39269090', xmlMonofasico: true, xmlSt: false, asOf: today })).toEqual(['MONOFASICO_XML_FORA_DA_LISTA']);
  });

  it('nota e tabela concordam: sem aviso de monofásico', () => {
    expect(codes({ ncm: '85111000', xmlMonofasico: true, xmlSt: true, asOf: today }).filter((c) => c.startsWith('MONOFASICO'))).toEqual([]);
  });

  it('NCM que só vale em certos casos (Anexo II ou ex-tarifário): pede confirmação, com a condição da lei', () => {
    const n = taxNotes({ ncm: '40169990', xmlMonofasico: false, xmlSt: false, asOf: today }).find((x) => x.code === 'MONOFASICO_DEPENDE');
    expect(n?.text).toMatch(/Ex 03 e 05/);
  });

  it('em 2027 a lista não vale mais e não gera aviso de monofásico', () => {
    expect(codes({ ncm: '85111000', xmlMonofasico: false, xmlSt: false, asOf: '2027-01-01' }).filter((c) => c.startsWith('MONOFASICO'))).toEqual([]);
  });

  it('ST: no Anexo II sem ICMS-ST na nota avisa, com o CEST; fora do Anexo com ST na nota também', () => {
    const n = taxNotes({ ncm: '38151210', xmlMonofasico: false, xmlSt: false, asOf: today });
    expect(n.find((x) => x.code === 'ST_NO_ANEXO_SEM_XML')?.text).toMatch(/01\.001\.00/);
    expect(codes({ ncm: '39269090', xmlMonofasico: false, xmlSt: true, asOf: today })).toEqual(['ST_XML_FORA_DO_ANEXO']);
  });

  it('nota e anexo concordam: sem aviso de ST', () => {
    expect(codes({ ncm: '38151210', xmlMonofasico: false, xmlSt: true, asOf: today }).filter((c) => c.startsWith('ST_'))).toEqual([]);
  });

  it('NCM ausente não gera aviso de ST fora do anexo', () => {
    expect(codes({ ncm: null, xmlMonofasico: false, xmlSt: true, asOf: today })).toEqual([]);
  });
});

describe('resolveEnquadramento: o que a lei e a nota resolvem sem clique', () => {
  const ok = { ncm: '39269090', xmlMonofasico: false, xmlSt: false, asOf: today, hasXmlTax: true };

  it('sem ST em NCM fora do Anexo II e PIS/COFINS normal em NCM fora da lista: normal nos dois', () => {
    expect(resolveEnquadramento(ok)).toEqual({ auto: true, monofasico: false, lawOverridesNote: false });
  });

  it('ST na nota e o NCM no Anexo II (fora da lista monofásica): concorda', () => {
    expect(resolveEnquadramento({ ...ok, ncm: '38151210', xmlSt: true })).toMatchObject({ auto: true, monofasico: false });
  });

  it('NCM da lista monofásica e a nota também: monofásico', () => {
    expect(resolveEnquadramento({ ...ok, ncm: '85111000', xmlMonofasico: true, xmlSt: true })).toEqual({ auto: true, monofasico: true, lawOverridesNote: false });
  });

  it('NCM da lista monofásica e a nota com PIS/COFINS normal: a lei prevalece (o revendedor tem 0% pelo NCM, Lei 10.485, art. 3º, § 2º)', () => {
    expect(resolveEnquadramento({ ...ok, ncm: '85111000', xmlSt: true })).toEqual({ auto: true, monofasico: true, lawOverridesNote: true });
  });

  it('nota monofásica mas NCM fora da lista: conflito, a pessoa decide', () => {
    expect(resolveEnquadramento({ ...ok, xmlMonofasico: true }).auto).toBe(false);
  });

  it('NCM que só é monofásico em certos casos (ex-tarifário, destino): a pessoa decide', () => {
    expect(resolveEnquadramento({ ...ok, ncm: '40169990' }).auto).toBe(false);
  });

  it('ST divergente entre a nota e o Anexo II, nos dois sentidos: a pessoa decide', () => {
    expect(resolveEnquadramento({ ...ok, ncm: '38151210' }).auto).toBe(false); // no Anexo II, sem ST na nota
    expect(resolveEnquadramento({ ...ok, xmlSt: true }).auto).toBe(false); // ST na nota, fora do Anexo II
  });

  it('sem dados fiscais no XML ou NCM incompleto: sem evidência', () => {
    expect(resolveEnquadramento({ ...ok, hasXmlTax: false }).auto).toBe(false);
    expect(resolveEnquadramento({ ...ok, ncm: '3926' }).auto).toBe(false);
    expect(resolveEnquadramento({ ...ok, ncm: null }).auto).toBe(false);
  });

  it('depois que a lista monofásica acaba (2027) não há o que resolver pela lei', () => {
    expect(resolveEnquadramento({ ...ok, asOf: '2027-01-01' }).auto).toBe(false);
  });
});
