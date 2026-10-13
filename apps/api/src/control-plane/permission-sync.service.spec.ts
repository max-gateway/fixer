import { describe, expect, it, vi } from 'vitest';
import { TenantContext } from '../tenancy/tenant-context.js';
import { PermissionSyncService } from './permission-sync.service.js';

const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';

describe('PermissionSyncService', () => {
  it('ressincroniza o Admin de cada organização dentro do contexto dela', async () => {
    const seen: string[] = [];
    const provisioning = { ensureAdminRole: vi.fn(async () => void seen.push(TenantContext.require())) };
    const directory = { orgsWithAdminRole: async () => [A, B] };
    await new PermissionSyncService(directory as never, provisioning as never).onApplicationBootstrap();
    expect(seen).toEqual([A, B]);
  });

  it('uma organização com falha não impede as outras nem derruba o boot', async () => {
    const provisioning = {
      ensureAdminRole: vi.fn(async () => {
        if (TenantContext.require() === A) throw new Error('boom');
      }),
    };
    const directory = { orgsWithAdminRole: async () => [A, B] };
    await expect(new PermissionSyncService(directory as never, provisioning as never).onApplicationBootstrap()).resolves.toBeUndefined();
    expect(provisioning.ensureAdminRole).toHaveBeenCalledTimes(2);
  });

  it('falha ao listar organizações é engolida', async () => {
    const directory = { orgsWithAdminRole: async () => Promise.reject(new Error('db down')) };
    await expect(new PermissionSyncService(directory as never, {} as never).onApplicationBootstrap()).resolves.toBeUndefined();
  });
});
