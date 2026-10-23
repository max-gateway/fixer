import { describe, expect, it } from 'vitest';
import { nationalServiceCode, pickAliquota } from './nfse-parametros.client.js';
import { estimateRbt12, estimateWindow } from './rbt12-estimate.js';

describe('parâmetros municipais da NFS-e Nacional', () => {
  it('código nacional do primeiro desdobramento do item da LC 116', () => {
    expect(nationalServiceCode('14.01')).toBe('140101');
    expect(nationalServiceCode('7.02')).toBe('070201');
  });

  it('escolhe a alíquota vigente na data, no histórico em PascalCase', () => {
    const body = {
      aliquotas: {
        '140101': [
          { Aliq: 3, DtIni: '2020-01-01T00:00:00', DtFim: '2023-12-31T00:00:00' },
          { Aliq: 5, DtIni: '2024-01-01T00:00:00', DtFim: null },
        ],
      },
    };
    expect(pickAliquota(body, '140101', '2026-10-19')).toEqual({ current: { pct: 5, from: '2024-01-01', to: null }, message: null });
    expect(pickAliquota(body, '140101', '2022-06-01').current?.pct).toBe(3);
  });

  it('município sem parâmetro: devolve a mensagem, sem alíquota', () => {
    expect(pickAliquota({ mensagem: 'Município não conveniado', aliquotas: null }, '140101', '2026-10-19')).toEqual({ current: null, message: 'Município não conveniado' });
  });
});

describe('RBT12 estimada pelas OS', () => {
  const now = new Date('2026-10-19T12:00:00Z');
  const at = (iso: string, parts: number, labor: number) => ({ closedAt: new Date(iso), partLines: [{ quantity: 2, unitPrice: parts / 2 }], serviceLines: [{ price: labor, hoursActual: null }] });

  it('soma peças e mão de obra de 10/2025 a 09/2026 e vale para o PA de 10/2026', () => {
    const r = estimateRbt12(now, new Date('2025-08-01T12:00:00Z'), [at('2025-10-05T12:00:00Z', 1000, 200), at('2026-09-30T20:00:00Z', 300, 100)]);
    expect(r).toMatchObject({ ok: true, from: '10/2025', to: '09/2026', orders: 2 });
    if (r.ok) {
      expect(r.rbt12.toString()).toBe('1600');
      expect(r.asOf.toISOString().slice(0, 10)).toBe('2026-10-01');
    }
  });

  it('OS da janela vêm de [1º/10/2025, 1º/10/2026) no fuso de Brasília', () => {
    const w = estimateWindow(now);
    expect(w.from.toISOString()).toBe('2025-10-01T03:00:00.000Z');
    expect(w.to.toISOString()).toBe('2026-10-01T03:00:00.000Z');
  });

  it('histórico que começa depois do primeiro mês da janela não serve', () => {
    expect(estimateRbt12(now, new Date('2025-11-03T12:00:00Z'), [])).toMatchObject({ ok: false, reason: 'HISTORICO_CURTO' });
    expect(estimateRbt12(now, null, [])).toMatchObject({ ok: false, reason: 'HISTORICO_CURTO' });
  });

  it('sem receita na janela: sem valor', () => {
    expect(estimateRbt12(now, new Date('2024-01-01T12:00:00Z'), [])).toMatchObject({ ok: false, reason: 'SEM_RECEITA' });
  });
});
