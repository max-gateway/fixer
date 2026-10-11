import { CanActivate, createParamDecorator, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import type { Actor } from '../audit/audit.service.js';
import { TenantService } from './tenant.service.js';

/** Autentica a chave de API do tenant (`Authorization: Bearer dfe_…`) e monta o `Actor` da requisição. */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(private readonly tenants: TenantService) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx.switchToHttp().getRequest();
    const [scheme, token] = String(req.headers.authorization ?? '').split(' ');
    if (scheme?.toLowerCase() !== 'bearer' || !token) throw new UnauthorizedException('Chave de API ausente');
    const tenant = await this.tenants.authenticate(token);
    if (!tenant) throw new UnauthorizedException('Chave de API inválida');
    const user = String(req.headers['x-actor'] ?? '').slice(0, 128) || undefined;
    req.actor = { tenantId: tenant.id, tenantSlug: tenant.slug, user, ip: req.ip } satisfies Actor;
    return true;
  }
}

export const CurrentActor = createParamDecorator((_: unknown, ctx: ExecutionContext): Actor => ctx.switchToHttp().getRequest().actor);
