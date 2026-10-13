import { HttpException, type ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { describe, expect, it, vi } from 'vitest';
import { IS_PUBLIC } from '../auth/auth.decorators.js';
import { TenantContext } from '../tenancy/tenant-context.js';
import { LicenseGuard } from './license.guard.js';
import type { AccessMode } from './license.service.js';

const ORG = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

function run(mode: AccessMode, method: string, opts: { isPublic?: boolean; org?: boolean } = {}) {
  const reflector = { getAllAndOverride: vi.fn((key: string) => (key === IS_PUBLIC ? Boolean(opts.isPublic) : undefined)) } as unknown as Reflector;
  const guard = new LicenseGuard(reflector, { mode: async () => mode } as never);
  const ctx = { getHandler: () => null, getClass: () => null, switchToHttp: () => ({ getRequest: () => ({ method }) }) } as unknown as ExecutionContext;
  const call = () => guard.canActivate(ctx);
  return opts.org === false ? call() : TenantContext.run(ORG, call);
}

const status = async (p: Promise<boolean>) => p.then(() => 200, (e: HttpException) => e.getStatus());

describe('LicenseGuard', () => {
  it('full: tudo liberado', async () => {
    expect(await run('full', 'POST')).toBe(true);
  });
  it('readonly: leitura passa, escrita responde 402', async () => {
    expect(await run('readonly', 'GET')).toBe(true);
    expect(await run('readonly', 'HEAD')).toBe(true);
    for (const m of ['POST', 'PUT', 'PATCH', 'DELETE']) expect(await status(run('readonly', m)), m).toBe(402);
  });
  it('none: tudo responde 402, inclusive leitura', async () => {
    expect(await status(run('none', 'GET'))).toBe(402);
    expect(await status(run('none', 'POST'))).toBe(402);
  });
  it('a mensagem de cada caso é distinta (o front mostra o aviso certo)', async () => {
    const body = (p: Promise<boolean>) => p.catch((e: HttpException) => e.getResponse() as { error: string });
    expect(await body(run('readonly', 'POST'))).toMatchObject({ error: 'subscription_readonly' });
    expect(await body(run('none', 'GET'))).toMatchObject({ error: 'subscription_inactive' });
  });
  it('rota pública e requisição sem organização não são checadas', async () => {
    expect(await run('none', 'POST', { isPublic: true })).toBe(true);
    TenantContext.useFallbackForTests(undefined);
    try {
      expect(await run('none', 'POST', { org: false })).toBe(true);
    } finally {
      TenantContext.useFallbackForTests('11111111-1111-4111-8111-111111111111');
    }
  });
});
