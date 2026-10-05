import { describe, expect, it } from 'vitest';
import { canTransition, hasDebitedStock, isTerminal } from './status.js';

describe('status machine', () => {
  it('permite o fluxo feliz', () => {
    const flow = ['QUOTE', 'APPROVED', 'IN_PROGRESS', 'COMPLETED', 'DELIVERED'] as const;
    for (let i = 0; i < flow.length - 1; i++) {
      expect(canTransition(flow[i], flow[i + 1])).toBe(true);
    }
  });

  it('permite ir e voltar entre IN_PROGRESS e AWAITING_PART', () => {
    expect(canTransition('IN_PROGRESS', 'AWAITING_PART')).toBe(true);
    expect(canTransition('AWAITING_PART', 'IN_PROGRESS')).toBe(true);
  });

  it('não pula etapas nem sai de estados terminais', () => {
    expect(canTransition('QUOTE', 'IN_PROGRESS')).toBe(false);
    expect(canTransition('COMPLETED', 'CANCELLED')).toBe(false);
    expect(isTerminal('DELIVERED')).toBe(true);
    expect(isTerminal('CANCELLED')).toBe(true);
    expect(canTransition('CANCELLED', 'QUOTE')).toBe(false);
  });

  it('estoque só foi debitado depois de QUOTE', () => {
    expect(hasDebitedStock('QUOTE')).toBe(false);
    expect(hasDebitedStock('APPROVED')).toBe(true);
  });
});
