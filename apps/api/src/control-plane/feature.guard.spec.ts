import { HttpException, type ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { describe, expect, it, vi } from 'vitest';
import { TenantContext } from '../tenancy/tenant-context.js';
import { FeatureGuard, REQUIRED_FEATURE } from './feature.guard.js';

const ORG = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const ctx = { getHandler: () => null, getClass: () => null } as unknown as ExecutionContext;

const guardFor = (feature: string | undefined, assert: () => Promise<void>) => {
  const reflector = { getAllAndOverride: vi.fn((k: string) => (k === REQUIRED_FEATURE ? feature : undefined)) } as unknown as Reflector;
  return new FeatureGuard(reflector, { assertFeature: vi.fn(assert) } as never);
};

describe('FeatureGuard', () => {
  it('rota sem @RequireFeature passa sem consultar o plano', async () => {
    const assert = vi.fn(async () => undefined);
    const guard = guardFor(undefined, assert);
    expect(await TenantContext.run(ORG, () => guard.canActivate(ctx))).toBe(true);
    expect(assert).not.toHaveBeenCalled();
  });

  it('consulta o plano pela chave da rota e propaga o 402 de quem não tem a funcionalidade', async () => {
    const guard = guardFor('fiscal', async () => {
      throw new HttpException({ error: 'feature_not_in_plan' }, 402);
    });
    await expect(TenantContext.run(ORG, () => guard.canActivate(ctx))).rejects.toMatchObject({ status: 402 });
    expect(await TenantContext.run(ORG, () => guardFor('fiscal', async () => undefined).canActivate(ctx))).toBe(true);
  });

  it('sem organização no contexto (rota pública) não consulta nada', async () => {
    const assert = vi.fn(async () => undefined);
    TenantContext.useFallbackForTests(undefined);
    try {
      expect(await guardFor('fiscal', assert).canActivate(ctx)).toBe(true);
    } finally {
      TenantContext.useFallbackForTests('11111111-1111-4111-8111-111111111111');
    }
    expect(assert).not.toHaveBeenCalled();
  });
});
