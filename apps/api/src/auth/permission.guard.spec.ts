import { Reflector } from '@nestjs/core';
import { describe, expect, it, vi } from 'vitest';
import { PermissionGuard } from './permission.guard.js';
import { RequirePermission } from './permissions.js';

class Controller {
  @RequirePermission('fiscal.manage')
  protected() {}
  open() {}
}

function run(method: 'protected' | 'open', user: unknown, granted: number) {
  const prisma = { rolePermission: { count: vi.fn().mockResolvedValue(granted) } };
  const guard = new PermissionGuard(new Reflector(), prisma as never);
  const ctx = {
    getHandler: () => Controller.prototype[method],
    getClass: () => Controller,
    switchToHttp: () => ({ getRequest: () => ({ user }) }),
  };
  return { prisma, result: guard.canActivate(ctx as never) };
}

describe('PermissionGuard', () => {
  it('rota sem @RequirePermission passa sem consultar o banco', async () => {
    const { prisma, result } = run('open', { id: 'u1' }, 0);
    await expect(result).resolves.toBe(true);
    expect(prisma.rolePermission.count).not.toHaveBeenCalled();
  });

  it('com a permissão por algum papel do usuário, passa', async () => {
    const { prisma, result } = run('protected', { id: 'u1' }, 1);
    await expect(result).resolves.toBe(true);
    expect(prisma.rolePermission.count).toHaveBeenCalledWith({
      where: { permission: { key: 'fiscal.manage' }, role: { users: { some: { userId: 'u1' } } } },
    });
  });

  it('falha fechado: sem permissão ou sem usuário, 403', async () => {
    await expect(run('protected', { id: 'u1' }, 0).result).rejects.toMatchObject({ status: 403 });
    await expect(run('protected', undefined, 1).result).rejects.toMatchObject({ status: 403 });
  });
});
