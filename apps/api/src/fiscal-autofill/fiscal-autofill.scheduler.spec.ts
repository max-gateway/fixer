import { describe, expect, it, vi } from 'vitest';
import { TenantContext } from '../tenancy/tenant-context.js';
import { dueForRefresh, FiscalAutofillScheduler, refreshWindow, type RefreshCandidate } from './fiscal-autofill.scheduler.js';

const ORG = '11111111-1111-4111-8111-111111111111';
const cand = (over: Partial<RefreshCandidate> = {}): RefreshCandidate => ({ orgId: ORG, actorId: 'u1', regime: 'SIMPLES', attempts: [], ...over });
const DIA_22 = new Date('2026-10-22T15:00:00Z');
const at = (iso: string) => new Date(iso);

describe('janela de atualização mensal', () => {
  it('começa no dia 21 às 00:00 de Brasília', () => {
    expect(refreshWindow(DIA_22)).toEqual({ day: 22, start: at('2026-10-21T03:00:00Z') });
    // 21/10 02:00Z ainda é dia 20 em Brasília.
    expect(refreshWindow(at('2026-10-21T02:00:00Z')).day).toBe(20);
  });
});

describe('quem está devendo a atualização', () => {
  it('antes do dia 21 ninguém', () => {
    expect(dueForRefresh([cand()], at('2026-10-20T15:00:00Z'))).toEqual([]);
  });
  it('Simples sem tentativa na janela: sim', () => {
    expect(dueForRefresh([cand()], DIA_22)).toHaveLength(1);
  });
  it('só Simples (Presumido e Real atualizam na virada do ano, não todo mês)', () => {
    expect(dueForRefresh([cand({ regime: 'PRESUMIDO' }), cand({ regime: null })], DIA_22)).toEqual([]);
  });
  it('sucesso na janela: não repete até o mês seguinte', () => {
    expect(dueForRefresh([cand({ attempts: [{ action: 'autofill.refresh.ok', at: at('2026-10-21T12:00:00Z') }] })], DIA_22)).toEqual([]);
    // O sucesso do mês anterior não vale para este mês.
    expect(dueForRefresh([cand({ attempts: [{ action: 'autofill.refresh.ok', at: at('2026-09-22T12:00:00Z') }] })], DIA_22)).toHaveLength(1);
  });
  it('tentativa sem sucesso espera 3 dias para tentar de novo (consulta paga)', () => {
    const tentou = (iso: string) => cand({ attempts: [{ action: 'autofill.refresh.try', at: at(iso) }] });
    expect(dueForRefresh([tentou('2026-10-21T15:00:00Z')], DIA_22)).toEqual([]);
    expect(dueForRefresh([tentou('2026-10-19T14:00:00Z')], DIA_22)).toHaveLength(1);
  });
});

describe('FiscalAutofillScheduler', () => {
  function make(report: unknown, candidates: RefreshCandidate[] = [cand()]) {
    const create = vi.fn(async () => ({}));
    const run = vi.fn(async () => report);
    const directory = { taxRefreshCandidates: vi.fn(async () => candidates) };
    const scheduler = new FiscalAutofillScheduler({ fiscalAuditLog: { create } } as never, { run } as never, { enabled: true } as never, directory as never);
    return { scheduler, create, run, directory };
  }
  const ok = { steps: [{ step: 'RBT12', status: 'OK' }], fields: [{ field: 'rbt12', outcome: 'PREENCHIDO', source: 'INTEGRA_PGDASD' }] };

  it('roda o preenchimento como quem deu o consentimento, dentro da organização, e registra o sucesso', async () => {
    const { scheduler, run, create } = make(ok);
    run.mockImplementation(async () => {
      expect(TenantContext.require()).toBe(ORG);
      return ok;
    });
    expect(await scheduler.tickAll(DIA_22)).toEqual({ refreshed: 1, failed: 0 });
    expect(run).toHaveBeenCalledWith({}, { id: 'u1' });
    expect(create).toHaveBeenCalledWith({ data: expect.objectContaining({ userId: 'u1', action: 'autofill.refresh.ok' }) });
  });

  it('Receita sem declaração ainda: registra tentativa, não sucesso', async () => {
    const { scheduler, create } = make({ steps: [{ step: 'RBT12', status: 'SEM_DADO' }], fields: [{ field: 'rbt12', outcome: 'SEM_DADO' }] });
    expect(await scheduler.tickAll(DIA_22)).toEqual({ refreshed: 0, failed: 0 });
    expect(create).toHaveBeenCalledWith({ data: expect.objectContaining({ action: 'autofill.refresh.try' }) });
  });

  it('valor digitado mantido (CONFLITO) conta como entregue pela Receita: não insiste', async () => {
    const { scheduler, create } = make({ steps: [], fields: [{ field: 'rbt12', outcome: 'CONFLITO' }] });
    await scheduler.tickAll(DIA_22);
    expect(create).toHaveBeenCalledWith({ data: expect.objectContaining({ action: 'autofill.refresh.ok' }) });
  });

  it('a falha de uma organização não impede as outras', async () => {
    const B = '22222222-2222-4222-8222-222222222222';
    const { scheduler, run } = make(ok, [cand(), cand({ orgId: B, actorId: 'u2' })]);
    run.mockRejectedValueOnce(new Error('boom')).mockResolvedValueOnce(ok as never);
    expect(await scheduler.tickAll(DIA_22)).toEqual({ refreshed: 1, failed: 1 });
  });

  it('fora da janela não consulta ninguém', async () => {
    const { scheduler, run } = make(ok);
    await scheduler.tickAll(at('2026-10-10T15:00:00Z'));
    expect(run).not.toHaveBeenCalled();
  });
});
