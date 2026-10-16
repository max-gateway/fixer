import { describe, expect, it } from 'vitest';
import { ST_AUTOPECAS_ANEXO_II } from '../../data/st-autopecas-anexo-ii.js';
import { cfop, cst, interestadual22, monofasico, parseStAnexoII, protocolo, referenceDeadlineWarnings, reform, simplesLegacy, stAnexoII, type Check } from './checks.js';
import { decodeBody, decodeEntities, flat, htmlToText, pctBR, reaisBR } from './html.js';
import { exitCode, formatReport, runChecks } from './run.js';

const td = (...ps: string[]) => `<td>${ps.map((p) => `<p>${p}</p>`).join('')}</td>`;
const tr = (cells: string[][], cls = 'A7') => `<tr class="${cls}">${cells.map((c) => td(...c)).join('')}</tr>`;

describe('utilitários de texto', () => {
  it('htmlToText separa células e linhas e decodifica entidades', () => {
    expect(htmlToText('<table><tr><td>2a Faixa</td><td>7,30%</td><td>5.940,00</td></tr></table><p>Art.&nbsp;1&ordm;</p>')).toBe('2a Faixa | 7,30% | 5.940,00 |\nArt. 1º');
    expect(flat('a | b\n c')).toBe('a b c');
    expect(decodeEntities('&#231;&#xe3;o &amp; &foo;')).toBe('ção & &foo;');
  });

  it('formatação brasileira', () => {
    expect(pctBR('5.50')).toBe('5,50%');
    expect(reaisBR(594_000n)).toBe('5.940,00');
    expect(reaisBR(37_800_000n)).toBe('378.000,00');
    expect(reaisBR(5n)).toBe('0,05');
  });

  it('decodeBody cai para Windows-1252 quando não é UTF-8', () => {
    expect(decodeBody(new Uint8Array([0x61, 0xe7, 0xe3, 0x6f]))).toBe('ação');
    expect(decodeBody(new TextEncoder().encode('ação'))).toBe('ação');
  });
});

describe('Simples, Anexo I (LC 123)', () => {
  const page = (mut: (s: string) => string) => {
    const rows = [
      ['1a Faixa', 'Até 180.000,00', '4,00%', '-'], ['2a Faixa', 'De 180.000,01 a 360.000,00', '7,30%', '5.940,00'], ['3a Faixa', 'x', '9,50%', '13.860,00'],
      ['4a Faixa', 'x', '10,70%', '22.500,00'], ['5a Faixa', 'x', '14,30%', '87.300,00'], ['6a Faixa', 'x', '19,00%', '378.000,00'],
    ];
    const share = [['1a', '5,50%', '3,50%', '12,74%', '2,76%', '41,50%', '34,00%'], ['2a', '5,50%', '3,50%', '12,74%', '2,76%', '41,50%', '34,00%'], ['3a', '5,50%', '3,50%', '12,74%', '2,76%', '42,00%', '33,50%'], ['4a', '5,50%', '3,50%', '12,74%', '2,76%', '42,00%', '33,50%'], ['5a', '5,50%', '3,50%', '12,74%', '2,76%', '42,00%', '33,50%'], ['6a', '13,50%', '10,00%', '28,27%', '6,13%', '42,10%', '-']];
    const html = `<p>ANEXO I DA LEI COMPLEMENTAR No 123</p><table>${rows.map((r) => `<tr>${r.map((c) => `<td>${c}</td>`).join('')}</tr>`).join('')}${share.map((r) => `<tr>${r.map((c) => `<td>${c}</td>`).join('')}</tr>`).join('')}</table>`;
    return mut(html);
  };

  it('confere quando o texto traz as faixas e a repartição do pacote', () => {
    expect(simplesLegacy(page((s) => s))).toEqual({ status: 'PASS', messages: [] });
  });

  it('acusa quando a lei muda uma dedução ou um percentual da repartição', () => {
    const r = simplesLegacy(page((s) => s.replace('13.860,00', '13.900,00').replaceAll('33,50%', '33,00%')));
    expect(r.status).toBe('FAIL');
    expect(r.messages.join(' ')).toMatch(/faixa 3: alíquota e dedução/);
    expect(r.messages.join(' ')).toMatch(/repartição/);
  });

  it('acusa página sem o anexo', () => {
    expect(simplesLegacy('<p>nada</p>').status).toBe('FAIL');
  });
});

describe('ST, Anexo II do Convênio 142', () => {
  const rows = (extra = '') =>
    `<table>${tr([['1.0'], ['01.001.00'], ['3815.12.10', '3815.12.90'], ['Catalisadores']])}` +
    `<tr><td colspan="4"><p>Nova redação dada ao item 85.0 pelo Conv. 66/22</p></td></tr>${tr([['85.0'], ['01.085.00'], ['9401.20.00', '9401.99.00'], ['Assentos']], 'corpoa')}` +
    `<tr><td colspan="4"><p>Redação original, efeitos até 01.05.22.</p></td></tr>${tr([['85.0'], ['01.085.00'], ['9401.20.00 9401.90.90'], ['Assentos']], 'A9verde')}` +
    `<tr><td colspan="4"><p>Revogado o item 110.0 do Anexo II pelo Conv. 165/19</p></td></tr>${tr([['110.0'], ['01.110.00'], ['7314.50.00'], ['Telas']])}${extra}</table><p>ANEXO III</p>`;

  it('lê só a redação vigente: ignora a antiga (verde) e o item revogado', () => {
    const parsed = parseStAnexoII(rows());
    expect(parsed.map((r) => r.cest)).toEqual(['01.001.00', '01.085.00']);
    expect(parsed[1]!.ncm).toEqual(['9401.20.00', '9401.99.00']);
  });

  it('acusa CEST novo no convênio e NCM que mudou', () => {
    const r = stAnexoII(rows(tr([['130.0'], ['01.130.00'], ['8708.10.00'], ['Para-choques']])));
    expect(r.status).toBe('FAIL');
    expect(r.messages.join(' ')).toContain('01.130.00');
    expect(r.messages.join(' ')).toMatch(/só no pacote/); // o pacote tem 131 itens, a amostra 2
  });

  it('o pacote bate consigo mesmo: se o texto trouxesse os 131 itens, passaria', () => {
    const full = `<table>${ST_AUTOPECAS_ANEXO_II.map((i) => tr([[i.item], [i.cest], i.ncm.length ? i.ncm : [''], ['x']])).join('')}</table><p>ANEXO III</p>`;
    expect(stAnexoII(`<p>01.001.00</p>${full}`).status).toBe('PASS');
  });
});

describe('Protocolo ICMS 41/2008', () => {
  const text = (by: string, ufs: string, cest = '01.019.00, 01.062.01, 01.112.00, 01.127.00, 01.128.00 e 01.999.00') =>
    `<p>Nova redação dada ao caput da cláusula primeira pelo Prot. ICMS ${by}, efeitos a partir de 01.10.26.</p><p>Cláusula primeira Nas operações interestaduais com bens e mercadorias relacionadas no Anexo II do Convênio ICMS nº 142, de 14 de dezembro de 2018, com exceção aos Códigos Especificadores da Substituição Tributária – CEST - ${cest}, destinadas aos Estados ${ufs}, fica atribuída ao estabelecimento remetente a responsabilidade.</p><p>Redação anterior dada ao caput</p>`;
  const UFS = 'do Acre, Alagoas, Amazonas, Amapá, Bahia, Maranhão, Mato Grosso, Minas Gerais, Pará, Paraíba, Piauí, Paraná, Rio de Janeiro, Roraima e o Distrito Federal';

  it('confere com a última redação do pacote', () => {
    expect(protocolo(text('93/26', UFS))).toEqual({ status: 'PASS', messages: [] });
  });

  it('acusa UF que entrou ou saiu, CEST que mudou e alteração nova do protocolo', () => {
    const r = protocolo(text('120/27', UFS.replace('Bahia, ', ''), '01.019.00, 01.999.00'));
    expect(r.status).toBe('FAIL');
    const m = r.messages.join(' ');
    expect(m).toContain('Prot. ICMS 120/27');
    expect(m).toMatch(/UFs de destino: só no pacote: BA/);
    expect(m).toMatch(/CEST excetuados/);
  });
});

describe('CFOP, CST e CSOSN', () => {
  it('acusa nova versão do CFOP no menu do Confaz e código que sumiu', () => {
    const page = `<p>menu CFOP_CVSN_1.6.24 CFOP_CVSN_1.9.26</p><p>ANEXO II</p><p>5.102 - Venda de mercadoria adquirida.</p>`;
    const r = cfop(page);
    expect(r.status).toBe('FAIL');
    expect(r.messages.join(' ')).toContain('nova versão do CFOP: CFOP_CVSN_1.9.26');
    expect(r.messages.join(' ')).toMatch(/CFOP: só no pacote/);
  });

  it('CST: item revogado não conta; código novo é acusado', () => {
    const tabela = (extra: string) => `<p>Tabela B - Tributação pelo ICMS</p><table><tr><td>00</td><td>Tributada</td></tr><tr><td>12</td><td>REVOGADO</td></tr><tr><td>12</td><td>Tributada ST antecedentes</td></tr>${extra}</table><p>NOTA EXPLICATIVA</p>`;
    const r = cst(tabela('<tr><td>99</td><td>Novo</td></tr>'));
    expect(r.messages.join(' ')).toContain('só no texto oficial: 99');
    expect(r.messages.join(' ')).not.toContain('só no texto oficial: 12');
  });
});

describe('monofásico e frases-chave', () => {
  it('acusa NCM novo no Anexo I e item a menos no Anexo II', () => {
    const page = '<p>ANEXO I</p><table><tr><td>4016.10.10</td><td>8483.20.00</td><td>9999.99.99</td></tr></table><p>ANEXO II</p><p>1. Tubos</p><p>posições 40.11 (pneus novos de borracha) e 40.13</p>';
    const r = monofasico(page);
    expect(r.status).toBe('FAIL');
    const m = r.messages.join(' ');
    expect(m).toContain('só no texto oficial: 99999999');
    expect(m).toMatch(/Anexo II: o texto tem 1 itens/);
  });

  it('frase-chave que sumiu da resolução é acusada', () => {
    expect(interestadual22('<p>será de doze por cento</p>').status).toBe('FAIL');
  });
});

describe('reforma: prazo do Senado', () => {
  it('avisa depois de 31/10 enquanto a alíquota de referência do ano seguinte segue pendente', () => {
    expect(referenceDeadlineWarnings('2026-10-13')).toEqual([]);
    expect(referenceDeadlineWarnings('2026-10-31')).toEqual([]);
    const w = referenceDeadlineWarnings('2026-11-05');
    expect(w).toHaveLength(1);
    expect(w[0]).toMatch(/2027/);
    expect(referenceDeadlineWarnings('2026-11-05', [{ year: 2027, cbsPct: '8.8', ibsStatePct: null, ibsMunicipalPct: null, status: 'FIXADA', resolution: 'RSF 1/2026', senateDeadline: '2026-10-31' }])).toEqual([]);
  });

  it('texto vazio falha as frases da lei', () => {
    expect(reform('<p>nada</p>', '2026-10-13').status).toBe('FAIL');
  });
});

describe('execução', () => {
  const ok: Check = { id: 'a', table: 't1', sources: [{ key: 'k', url: 'https://x/1' }], run: () => ({ status: 'PASS', messages: [] }) };
  const bad: Check = { id: 'b', table: 't2', sources: [{ key: 'k', url: 'https://x/1' }], run: (d) => ({ status: 'FAIL', messages: [`tamanho ${d.k!.length}`] }) };
  const offline: Check = { id: 'c', table: 't3', sources: [{ key: 'k', url: 'https://x/2' }], run: () => ({ status: 'PASS', messages: [] }) };

  it('baixa cada URL uma vez, trata erro de rede e escolhe o código de saída', async () => {
    const calls: string[] = [];
    const fetcher = async (url: string) => {
      calls.push(url);
      if (url.endsWith('/2')) throw new Error('HTTP 503');
      return 'corpo';
    };
    const out = await runChecks([], '2026-10-13', [ok, bad, offline], fetcher);
    expect(calls).toEqual(['https://x/1', 'https://x/2']);
    expect(out.map((o) => o.status)).toEqual(['PASS', 'FAIL', 'ERROR']);
    expect(exitCode(out)).toBe(1);
    expect(exitCode(out.filter((o) => o.status === 'ERROR'))).toBe(2);
    expect(exitCode(out.filter((o) => o.status === 'PASS'))).toBe(0);
    expect(formatReport(out)).toMatch(/1 ok, 0 aviso\(s\), 1 falha\(s\), 1 erro\(s\) de rede/);
  });

  it('filtra por id ou por tabela', async () => {
    const out = await runChecks(['t2'], '2026-10-13', [ok, bad], async () => 'x');
    expect(out.map((o) => o.id)).toEqual(['b']);
  });
});
