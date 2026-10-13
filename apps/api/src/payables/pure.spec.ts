import { describe, expect, it } from 'vitest';
import { dueFromFactor, mod10, mod11Bank, mod11Utility, parseBoleto } from './boleto.js';
import { csvCell, csvDate, csvMoney, toCsv } from './csv.js';
import { addMonths, todayIso } from './dates.js';
import { buildForecast, toCents } from './forecast.js';

/** Monta uma linha digitável bancária válida (47 dígitos) a partir dos campos. */
function bankLine(o: { bank?: string; factor: string; cents: string; free?: string }): string {
  const bank = o.bank ?? '341';
  const free = o.free ?? '1234567890123456789012345'; // 25 posições do campo livre
  const valor = o.cents.padStart(10, '0');
  const withoutDv = `${bank}9${o.factor}${valor}${free}`; // banco, moeda, fator, valor, livre (sem o DV geral)
  const dv = mod11Bank(withoutDv.slice(0, 4) + withoutDv.slice(4));
  const f1 = `${bank}9${free.slice(0, 5)}`;
  const f2 = free.slice(5, 15);
  const f3 = free.slice(15, 25);
  return `${f1}${mod10(f1)}${f2}${mod10(f2)}${f3}${mod10(f3)}${dv}${o.factor}${valor}`;
}

describe('parseBoleto: bancário', () => {
  // 07/10/1997 + 8000 dias
  const NOW = new Date('2026-10-13T12:00:00Z');
  const factor = '8800';
  const expectedDue = (() => {
    const d = new Date(Date.UTC(1997, 9, 7) + 8800 * 86_400_000);
    return d.toISOString().slice(0, 10);
  })();

  it('extrai valor e vencimento de uma linha digitável válida, com ou sem máscara', () => {
    const line = bankLine({ factor, cents: '123456' });
    const r = parseBoleto(line, NOW);
    expect(r).toMatchObject({ ok: true, kind: 'bank', amount: '1234.56', dueDate: expectedDue, bankCode: '341' });
    const masked = `${line.slice(0, 5)}.${line.slice(5, 10)} ${line.slice(10, 15)}.${line.slice(15, 21)} ${line.slice(21, 26)}.${line.slice(26, 32)} ${line[32]} ${line.slice(33)}`;
    expect(parseBoleto(masked, NOW)).toMatchObject({ ok: true, amount: '1234.56' });
  });

  it('valor zero e fator 0000 significam "livre" / "sem vencimento"', () => {
    expect(parseBoleto(bankLine({ factor: '0000', cents: '0' }), NOW)).toMatchObject({ ok: true, amount: null, dueDate: null });
  });

  it('um dígito trocado em qualquer campo é recusado', () => {
    const line = bankLine({ factor, cents: '123456' });
    for (const i of [2, 12, 23, 40]) {
      const bad = line.slice(0, i) + String((Number(line[i]) + 1) % 10) + line.slice(i + 1);
      expect(parseBoleto(bad, NOW)).toEqual({ ok: false, reason: 'CHECK_DIGIT' });
    }
  });

  it('o código de barras de 44 dígitos também vale', () => {
    const line = bankLine({ factor, cents: '5000' });
    const barcode = line.slice(0, 4) + line[32] + line.slice(33, 47) + line.slice(4, 9) + line.slice(10, 20) + line.slice(21, 31);
    expect(parseBoleto(barcode, NOW)).toMatchObject({ ok: true, amount: '50.00', dueDate: expectedDue });
  });

  it('tamanho errado', () => {
    expect(parseBoleto('123', NOW)).toEqual({ ok: false, reason: 'LENGTH' });
    expect(parseBoleto('', NOW)).toEqual({ ok: false, reason: 'LENGTH' });
  });
});

describe('dueFromFactor', () => {
  it('antes do retorno do fator (9999 = 21/02/2025)', () => {
    expect(dueFromFactor(9999, new Date('2025-02-10T12:00:00Z'))).toBe('2025-02-21');
  });
  it('depois do retorno, 1000 = 22/02/2025', () => {
    expect(dueFromFactor(1000, new Date('2025-03-01T12:00:00Z'))).toBe('2025-02-22');
    expect(dueFromFactor(1010, new Date('2025-03-01T12:00:00Z'))).toBe('2025-03-04');
  });
  it('fator fora de faixa não vira data', () => {
    expect(dueFromFactor(0)).toBeNull();
    expect(dueFromFactor(500)).toBeNull();
  });
});

describe('parseBoleto: arrecadação (48)', () => {
  function utility(idDigit: '6' | '7' | '8' | '9', centsStr: string): string {
    // produto 8, segmento 1, identificador do valor, DV geral (fica 0: a validação por bloco não o confere), valor, empresa/livre.
    const body = `81${idDigit}0${centsStr.padStart(11, '0')}${'7'.repeat(29)}`;
    expect(body).toHaveLength(44);
    // DV geral (posição 3) fica 0 aqui: a validação por bloco não o confere.
    const dv = idDigit === '6' || idDigit === '7' ? mod10 : mod11Utility;
    return [0, 11, 22, 33].map((i) => body.slice(i, i + 11)).map((b) => b + dv(b)).join('');
  }
  it('valor efetivo (8) traz o valor', () => {
    expect(parseBoleto(utility('8', '15990'), new Date())).toMatchObject({ ok: true, kind: 'utility', amount: '159.90', dueDate: null });
  });
  it('valor de referência (9) não traz valor', () => {
    expect(parseBoleto(utility('9', '15990'), new Date())).toMatchObject({ ok: true, kind: 'utility', amount: null });
  });
  it('módulo 10 (6) também fecha, e adulteração é pega', () => {
    const ok = utility('6', '1000');
    expect(parseBoleto(ok, new Date())).toMatchObject({ ok: true, amount: '10.00' });
    const bad = ok.slice(0, 5) + String((Number(ok[5]) + 1) % 10) + ok.slice(6);
    expect(parseBoleto(bad, new Date())).toEqual({ ok: false, reason: 'CHECK_DIGIT' });
  });
});

describe('buildForecast', () => {
  const rows = [
    { dueDate: '2026-10-01', amount: '100.10' }, // vencida
    { dueDate: '2026-10-13', amount: '50.00' }, // hoje: 1ª janela
    { dueDate: '2026-10-19', amount: '0.05' }, // último dia da 1ª janela
    { dueDate: '2026-10-20', amount: '10.00' }, // 2ª janela
    { dueDate: '2027-03-01', amount: '7.00' }, // além do horizonte
  ];
  const f = buildForecast(rows, '2026-10-13', 2);

  it('classifica nas pontas e nas janelas de 7 dias corridos', () => {
    expect(f.map((b) => [b.key, b.count, b.amount])).toEqual([
      ['overdue', 1, '100.10'],
      ['w0', 2, '50.05'],
      ['w1', 1, '10.00'],
      ['later', 1, '7.00'],
    ]);
    expect(f[1]).toMatchObject({ from: '2026-10-13', to: '2026-10-19' });
  });
  it('soma em centavos, sem erro de ponto flutuante', () => {
    const many = Array.from({ length: 1000 }, () => ({ dueDate: '2026-10-14', amount: '0.10' }));
    expect(buildForecast(many, '2026-10-13', 1)[1]!.amount).toBe('100.00');
    expect(toCents('12.3')).toBe(1230n);
  });
});

describe('datas', () => {
  it('"hoje" é o de Brasília, não o UTC (21h em Brasília já é dia seguinte em UTC)', () => {
    expect(todayIso(new Date('2026-10-14T00:30:00Z'))).toBe('2026-10-13');
    expect(todayIso(new Date('2026-10-14T03:30:00Z'))).toBe('2026-10-14');
  });
  it('addMonths limita ao último dia do mês', () => {
    expect(addMonths('2026-01-31', 1).toISOString()).toBe('2026-02-28T00:00:00.000Z');
    expect(addMonths('2028-01-31', 1).toISOString()).toBe('2028-02-29T00:00:00.000Z');
    expect(addMonths('2026-11-15', 2).toISOString()).toBe('2027-01-15T00:00:00.000Z');
  });
});

describe('csv', () => {
  it('escapa aspas, ponto e vírgula e quebra de linha', () => {
    expect(csvCell('a;b')).toBe('"a;b"');
    expect(csvCell('diz "oi"')).toBe('"diz ""oi"""');
    expect(csvCell('l1\nl2')).toBe('"l1\nl2"');
  });
  it('neutraliza fórmulas', () => {
    expect(csvCell('=HYPERLINK("x")')).toBe(`"'=HYPERLINK(""x"")"`);
    expect(csvCell('+55 11')).toBe("'+55 11");
  });
  it('formata valor e data no padrão brasileiro e leva BOM', () => {
    expect(csvMoney('1234.50')).toBe('1234,50');
    expect(csvDate('2026-10-05')).toBe('05/10/2026');
    expect(toCsv(['A', 'B'], [['x', '1,5']])).toBe('﻿A;B\r\nx;1,5\r\n');
  });
});
