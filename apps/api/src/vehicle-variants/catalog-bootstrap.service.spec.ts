import { describe, expect, it, vi } from 'vitest';
import { CATALOG_VERSION } from '@fixer/catalog';
import { CatalogBootstrapService } from './catalog-bootstrap.service.js';

function setup(applied: { version: string } | null) {
  const tx = { marker: 'tx' };
  const prisma = {
    catalogState: { findUnique: vi.fn().mockResolvedValue(applied) },
    $transaction: vi.fn(async (fn: (t: unknown) => unknown) => fn(tx)),
  };
  const apply = vi.fn().mockResolvedValue(undefined);
  return { prisma, tx, apply, service: new CatalogBootstrapService(prisma as never, apply) };
}

describe('CatalogBootstrapService.onApplicationBootstrap', () => {
  it('aplica o catálogo numa transação quando o banco nunca recebeu nenhum', async () => {
    const { service, apply, tx, prisma } = setup(null);
    await service.onApplicationBootstrap();
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(apply).toHaveBeenCalledWith(tx, expect.objectContaining({ version: CATALOG_VERSION }));
  });

  it('reaplica quando a versão embarcada é diferente da aplicada (upgrade)', async () => {
    const { service, apply } = setup({ version: '0.0.1' });
    await service.onApplicationBootstrap();
    expect(apply).toHaveBeenCalledTimes(1);
  });

  it('não faz nada quando a versão já está aplicada', async () => {
    const { service, apply, prisma } = setup({ version: CATALOG_VERSION });
    await service.onApplicationBootstrap();
    expect(apply).not.toHaveBeenCalled();
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('uma falha ao aplicar não derruba a API: registra e segue', async () => {
    const { service, apply } = setup(null);
    apply.mockRejectedValue(new Error('boom'));
    await expect(service.onApplicationBootstrap()).resolves.toBeUndefined();
  });
});
