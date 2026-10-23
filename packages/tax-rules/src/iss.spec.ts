import { describe, expect, it } from 'vitest';
import { ISS_PLACE_RULES, LC116_GROUPS, LC116_ITEMS } from '../data/iss-lc116.js';
import { issPlace, issRateCheck, lc116Item } from './iss.js';

describe('lista de serviços da LC 116', () => {
  it('manutenção de veículos é o subitem 14.01; funilaria 14.12; guincho 14.14', () => {
    expect(lc116Item('14.01')?.description).toMatch(/^Lubrificação, limpeza, lustração, revisão/);
    expect(lc116Item('14.12')?.description).toBe('Funilaria e lanternagem.');
    expect(lc116Item('14.14')?.description).toMatch(/^Guincho intramunicipal/);
    expect(lc116Item('14.1')).toBeNull(); // ambíguo (14.01 ou 14.10): recusa em vez de adivinhar
    expect(lc116Item('01.01')?.code).toBe('1.01');
    expect(lc116Item('99.99')).toBeNull();
    expect(lc116Item('1401')).toBeNull();
  });

  it('vale a redação mais recente do subitem', () => {
    expect(lc116Item('1.03')?.description).toMatch(/armazenamento ou hospedagem de dados/);
  });

  it('subitens vetados estão marcados como revogados', () => {
    expect(LC116_ITEMS.filter((i) => i.revoked).map((i) => i.code)).toEqual(['3.01', '7.14', '7.15', '13.01', '17.07']);
  });

  it('a lista tem 40 itens e cada subitem pertence a um deles', () => {
    expect(Object.keys(LC116_GROUPS)).toHaveLength(40);
    for (const i of LC116_ITEMS) expect(LC116_GROUPS[i.group], i.code).toBeDefined();
    expect(new Set(LC116_ITEMS.map((i) => i.code)).size).toBe(LC116_ITEMS.length);
  });
});

describe('local de incidência do ISS (art. 3º)', () => {
  it('a oficina (14.01) paga no estabelecimento prestador: regra geral', () => {
    expect(issPlace('14.01')).toEqual({ place: 'PRESTADOR', rule: null });
  });

  it('construção civil, guarda de bem e item 16 têm exceção', () => {
    expect(issPlace('7.02')?.place).toBe('LOCAL_DA_EXECUCAO');
    expect(issPlace('11.01')?.place).toBe('LOCAL_DA_EXECUCAO');
    expect(issPlace('16.02')?.place).toBe('LOCAL_DO_TRANSPORTE'); // o item 16 inteiro
    expect(issPlace('20.01')?.place).toBe('PORTO_AEROPORTO_TERMINAL');
    expect(issPlace('17.05')?.place).toBe('TOMADOR');
  });

  it('item 12 tem exceção, menos o 12.13', () => {
    expect(issPlace('12.01')?.place).toBe('LOCAL_DA_EXECUCAO');
    expect(issPlace('12.13')?.place).toBe('PRESTADOR');
  });

  it('o guincho 14.14 é no local da execução (LC 218/2025) e os demais 14.xx não', () => {
    expect(issPlace('14.14')?.place).toBe('LOCAL_DA_EXECUCAO');
    expect(issPlace('14.13')?.place).toBe('PRESTADOR');
  });

  it('toda regra aponta para subitens ou itens que existem', () => {
    for (const r of ISS_PLACE_RULES) {
      for (const it of r.items) expect(it.includes('.') ? lc116Item(it) : LC116_GROUPS[it], `${r.inciso} ${it}`).toBeTruthy();
    }
  });
});

describe('alíquota do município contra os limites da lei', () => {
  const d = '2026-10-22';
  it('Recife, 14.01 a 5%, está no limite', () => {
    expect(issRateCheck('5', '14.01', d)).toBe('OK');
    expect(issRateCheck('5.00', '14.01', d)).toBe('OK');
  });
  it('acima de 5% e abaixo de 2% são ilegais; 7.02, 7.05 e 16.01 podem ficar abaixo do mínimo', () => {
    expect(issRateCheck('5.01', '14.01', d)).toBe('ACIMA_DO_MAXIMO');
    expect(issRateCheck('1.99', '14.01', d)).toBe('ABAIXO_DO_MINIMO');
    expect(issRateCheck('2', '14.01', d)).toBe('OK');
    expect(issRateCheck('0.5', '7.02', d)).toBe('OK');
    expect(issRateCheck('0', '16.01', d)).toBe('OK');
  });
  it('entrada inválida e vigência', () => {
    expect(issRateCheck('abc', '14.01', d)).toBe('RATE_INVALIDA');
    expect(issRateCheck('5', '99.99', d)).toBe('SUBITEM_INEXISTENTE');
    expect(issRateCheck('5', '14.01', '2033-01-01')).toBe('FORA_DE_VIGENCIA');
  });
});
