import { describe, expect, it } from 'vitest';
import { taxNotes } from './tax-notes.js';

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
