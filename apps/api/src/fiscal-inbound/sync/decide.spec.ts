import { describe, expect, it } from 'vitest';
import { backoffMs, decide, decideTransportFailure, MAX_CONSECUTIVE_BLOCKS, type DecideInput } from './decide.js';

const now = new Date('2026-10-11T12:00:00Z');
const MIN = 60_000;
const base: DecideInput = {
  cStat: 138,
  xMotivo: 'x',
  ultNsu: 50n,
  maxNsu: 100n,
  prevFailures: 0,
  prevStatusCode: null,
  now,
  random: () => 0,
};
const delay = (d: { nextPollAt: Date }) => d.nextPollAt.getTime() - now.getTime();

describe('decide', () => {
  it('138 com mais documentos: continua em ~1 s, sem esperar a hora cheia', () => {
    const d = decide(base);
    expect(d.outcome).toBe('MORE');
    expect(delay(d)).toBe(1_000);
    expect(d.failures).toBe(0);
    expect(d.error).toBeNull();
  });

  it('138 com ultNSU = maxNSU: fila esgotada, espera 1 h (NT §3.5)', () => {
    const d = decide({ ...base, ultNsu: 100n });
    expect(d.outcome).toBe('IDLE');
    expect(delay(d)).toBeGreaterThanOrEqual(60 * MIN);
  });

  it('138 sem avanço (ultNSU > maxNSU ou ausente) não vira laço infinito', () => {
    expect(decide({ ...base, ultNsu: 120n }).outcome).toBe('IDLE');
    expect(decide({ ...base, ultNsu: null }).outcome).toBe('IDLE');
  });

  it('137: espera pelo menos 1 h, com jitter de até 5 min', () => {
    expect(delay(decide({ ...base, cStat: 137, random: () => 0 }))).toBe(60 * MIN);
    expect(delay(decide({ ...base, cStat: 137, random: () => 0.999 }))).toBeLessThan(65 * MIN);
    expect(delay(decide({ ...base, cStat: 137, random: () => 0.999 }))).toBeGreaterThan(64 * MIN);
  });

  it('656: bloqueio de 1 h; espera 65 min e registra o NSU que a SEFAZ devolveu', () => {
    const d = decide({ ...base, cStat: 656, ultNsu: 1234n, xMotivo: 'Consumo Indevido' });
    expect(d.outcome).toBe('BLOCKED');
    expect(delay(d)).toBe(65 * MIN);
    expect(d.error).toContain('1234');
    expect(d.failures).toBe(1);
  });

  it(`656 em sequência: desliga na ${MAX_CONSECUTIVE_BLOCKS}ª ocorrência`, () => {
    const second = decide({ ...base, cStat: 656, prevFailures: 1, prevStatusCode: 656 });
    expect(second).toMatchObject({ outcome: 'BLOCKED', failures: 2 });
    const third = decide({ ...base, cStat: 656, prevFailures: 2, prevStatusCode: 656 });
    expect(third).toMatchObject({ outcome: 'DISABLE', failures: 3 });
    expect(third.error).toMatch(/desligada/);
  });

  it('656 depois de uma resposta normal recomeça a contagem', () => {
    const d = decide({ ...base, cStat: 656, prevFailures: 2, prevStatusCode: 138 });
    expect(d).toMatchObject({ outcome: 'BLOCKED', failures: 1 });
  });

  it.each([280, 281, 283, 284, 285, 286, 472, 473, 489, 490, 593])('rejeição %i (certificado/CNPJ) desliga o sync', (cStat) => {
    const d = decide({ ...base, cStat, xMotivo: 'Rejeição' });
    expect(d.outcome).toBe('DISABLE');
    expect(d.error).toContain(String(cStat));
  });

  it('589 (NSU maior que o da SEFAZ) não é corrigido sozinho', () => {
    const d = decide({ ...base, cStat: 589 });
    expect(d.outcome).toBe('RETRY');
    expect(d.error).toContain('589');
  });

  it.each([108, 109, 215, 252, 999])('cStat %i: falha transitória com backoff', (cStat) => {
    const d = decide({ ...base, cStat, prevFailures: 2 });
    expect(d).toMatchObject({ outcome: 'RETRY', failures: 3 });
    expect(delay(d)).toBe(4 * MIN);
  });
});

describe('backoff', () => {
  it('dobra a cada falha e trava em 1 h', () => {
    expect([1, 2, 3, 4, 5, 6, 7, 8, 20].map((n) => backoffMs(n) / MIN)).toEqual([1, 2, 4, 8, 16, 32, 60, 60, 60]);
  });

  it('falha de transporte acumula falhas', () => {
    const d = decideTransportFailure(4, now, 'timeout');
    expect(d).toMatchObject({ outcome: 'RETRY', failures: 5, error: 'timeout' });
    expect(delay(d)).toBe(16 * MIN);
  });
});
