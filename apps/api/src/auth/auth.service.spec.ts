import { describe, expect, it, vi } from 'vitest';
import { UnauthorizedException } from '@nestjs/common';
import { AuthService } from './auth.service.js';

function setup(user: Record<string, unknown> = {}) {
  const upsert = vi.fn().mockResolvedValue({
    id: 'u1',
    name: 'Ana',
    email: 'ana@x.com',
    active: true,
    ...user,
  });
  const config = { issuer: 'http://kc/realms/r', jwksUrl: new URL('http://kc/realms/r/certs') };
  const service = new AuthService(config as never, { user: { upsert } } as never);
  // syncUser é o que importa aqui; a verificação de assinatura é do jose.
  const sync = (payload: Record<string, unknown>) => (service as any).syncUser(payload);
  return { upsert, sync };
}

describe('AuthService.syncUser', () => {
  it('faz upsert por keycloakId com nome e e-mail do token', async () => {
    const { upsert, sync } = setup();
    const user = await sync({ sub: 'kc-1', email: 'ana@x.com', name: 'Ana' });
    expect(upsert).toHaveBeenCalledWith({
      where: { keycloakId: 'kc-1' },
      create: { keycloakId: 'kc-1', email: 'ana@x.com', name: 'Ana' },
      update: { email: 'ana@x.com', name: 'Ana' },
    });
    expect(user).toMatchObject({ id: 'u1', keycloakId: 'kc-1' });
  });

  it('usa preferred_username e depois e-mail quando não há name', async () => {
    const { upsert, sync } = setup();
    await sync({ sub: 'k', email: 'a@x.com', preferred_username: 'ana' });
    expect(upsert.mock.calls[0][0].create.name).toBe('ana');
    await sync({ sub: 'k', email: 'a@x.com' });
    expect(upsert.mock.calls[1][0].create.name).toBe('a@x.com');
  });

  it('rejeita token sem sub ou e-mail', async () => {
    const { sync } = setup();
    await expect(sync({ sub: 'k' })).rejects.toBeInstanceOf(UnauthorizedException);
    await expect(sync({ email: 'a@x.com' })).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('rejeita usuário desativado', async () => {
    const { sync } = setup({ active: false });
    await expect(sync({ sub: 'k', email: 'a@x.com' })).rejects.toBeInstanceOf(UnauthorizedException);
  });
});
