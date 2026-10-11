import { describe, expect, it, vi } from 'vitest';
import type { FiscalConfig } from '../fiscal.config.js';
import { testConfig } from '../../../test/fiscal/config.js';
import { SyncScheduler } from './sync.scheduler.js';

const config: FiscalConfig = testConfig();

function setup(opts: { lease?: boolean; outcomes?: ('MORE' | 'IDLE')[]; renew?: boolean[]; keys?: boolean; config?: Partial<FiscalConfig> } = {}) {
  const outcomes = [...(opts.outcomes ?? ['IDLE'])];
  const renews = [...(opts.renew ?? [])];
  const prisma = {
    $queryRaw: vi.fn().mockResolvedValue(opts.lease === false ? [] : [{ id: 1 }]),
    fiscalSyncState: {
      updateMany: vi.fn(async ({ data }: { data: { leaseUntil: Date | null } }) =>
        // renovar devolve o roteiro; liberar (leaseUntil null) sempre conta 1
        data.leaseUntil === null ? { count: 1 } : { count: renews.shift() === false ? 0 : 1 },
      ),
    },
  };
  const runner = { runOnce: vi.fn(async () => ({ outcome: outcomes.shift() ?? 'IDLE', cStat: 138 })) };
  const keys = { available: opts.keys ?? true };
  const scheduler = new SyncScheduler(prisma as never, runner as never, keys as never, { ...config, ...opts.config });
  return { scheduler, prisma, runner };
}

describe('SyncScheduler.tick', () => {
  it('sem conquistar o lease não consulta a SEFAZ (outra réplica está rodando)', async () => {
    const { scheduler, runner, prisma } = setup({ lease: false });
    await scheduler.tick();
    expect(runner.runOnce).not.toHaveBeenCalled();
    expect(prisma.fiscalSyncState.updateMany).not.toHaveBeenCalled(); // nem libera o que não é seu
  });

  it('com o lease roda uma vez e libera quando a fila esgota', async () => {
    const { scheduler, runner, prisma } = setup({ outcomes: ['IDLE'] });
    await scheduler.tick();
    expect(runner.runOnce).toHaveBeenCalledTimes(1);
    const calls = prisma.fiscalSyncState.updateMany.mock.calls as unknown as [{ data: { leaseUntil: Date | null; leaseOwner?: null } }][];
    expect(calls.at(-1)![0].data).toEqual({ leaseUntil: null, leaseOwner: null });
  });

  it('enquanto há mais documentos, pagina sem soltar o lease e renova a cada lote', async () => {
    const { scheduler, runner, prisma } = setup({ outcomes: ['MORE', 'MORE', 'IDLE'] });
    await scheduler.tick();
    expect(runner.runOnce).toHaveBeenCalledTimes(3);
    const renewals = (prisma.fiscalSyncState.updateMany.mock.calls as unknown as [{ data: { leaseUntil: Date | null } }][]).filter(
      (c) => c[0].data.leaseUntil !== null,
    );
    expect(renewals).toHaveLength(2);
  });

  it('perdeu o lease durante a paginação: para sem gravar mais nada', async () => {
    const { scheduler, runner } = setup({ outcomes: ['MORE', 'MORE', 'MORE'], renew: [false] });
    await scheduler.tick();
    expect(runner.runOnce).toHaveBeenCalledTimes(1);
  });

  it('erro no runner ainda libera o lease', async () => {
    const { scheduler, runner, prisma } = setup();
    runner.runOnce.mockRejectedValueOnce(new Error('bug'));
    await expect(scheduler.tick()).rejects.toThrow('bug');
    const calls = prisma.fiscalSyncState.updateMany.mock.calls as unknown as [{ data: { leaseUntil: Date | null } }][];
    expect(calls.at(-1)![0].data.leaseUntil).toBeNull();
  });

  it('o lease é um UPDATE atômico condicionado a enabled, nextPollAt e lease vencido', async () => {
    const { scheduler, prisma } = setup();
    await scheduler.tick();
    const sql = (prisma.$queryRaw.mock.calls[0]![0] as string[]).join('?');
    expect(sql).toMatch(/UPDATE "FiscalSyncState"/);
    expect(sql).toMatch(/c\."enabled" = true/);
    expect(sql).toMatch(/s\."nextPollAt" <= now\(\)/);
    expect(sql).toMatch(/"leaseUntil" IS NULL OR s\."leaseUntil" < now\(\)/);
    expect(sql).toMatch(/RETURNING/);
  });
});

describe('SyncScheduler.onModuleInit', () => {
  it('não inicia o loop sem chave mestra nem com FISCAL_SYNC_ENABLED=false', async () => {
    for (const s of [setup({ keys: false }), setup({ config: { syncEnabled: false } })]) {
      s.scheduler.onModuleInit();
      await new Promise((r) => setTimeout(r, 40));
      expect(s.prisma.$queryRaw).not.toHaveBeenCalled();
      await s.scheduler.onApplicationShutdown();
    }
  });

  it('inicia o loop e para limpo no shutdown', async () => {
    const { scheduler, prisma } = setup();
    scheduler.onModuleInit();
    await new Promise((r) => setTimeout(r, 40));
    expect(prisma.$queryRaw).toHaveBeenCalled();
    await scheduler.onApplicationShutdown();
    const calls = prisma.$queryRaw.mock.calls.length;
    await new Promise((r) => setTimeout(r, 40));
    expect(prisma.$queryRaw.mock.calls.length).toBe(calls);
  });
});
