import { CanActivate, ExecutionContext, Injectable, SetMetadata } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { TenantContext } from '../tenancy/tenant-context.js';
import { PlanLimits } from './plan-limits.service.js';

export const REQUIRED_FEATURE = 'requiredFeature';

/** Exige que o plano da organização inclua a funcionalidade (`@RequireFeature('fiscal')`). Chave ausente no plano = liberada. */
export const RequireFeature = (key: string) => SetMetadata(REQUIRED_FEATURE, key);

@Injectable()
export class FeatureGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly limits: PlanLimits,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const key = this.reflector.getAllAndOverride<string | undefined>(REQUIRED_FEATURE, [ctx.getHandler(), ctx.getClass()]);
    if (!key || !TenantContext.current()) return true;
    await this.limits.assertFeature(key);
    return true;
  }
}
