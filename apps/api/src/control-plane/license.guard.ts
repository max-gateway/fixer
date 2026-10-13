import { CanActivate, ExecutionContext, HttpException, HttpStatus, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { IS_PUBLIC } from '../auth/auth.decorators.js';
import { TenantContext } from '../tenancy/tenant-context.js';
import { LicenseService } from './license.service.js';

const SAFE = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * Aplica o estado da assinatura da organização:
 *  - `readonly` (inadimplência/trial expirado): só leitura e exportação, escrita responde 402;
 *  - `none` (retenção encerrada ou sem assinatura): tudo responde 402.
 * Rotas públicas (portal do cliente final, saúde) não passam por aqui.
 */
@Injectable()
export class LicenseGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly license: LicenseService,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    if (this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, [ctx.getHandler(), ctx.getClass()])) return true;
    if (!TenantContext.current()) return true; // sem organização não há licença a checar (o AuthGuard já respondeu)
    const mode = await this.license.mode();
    if (mode === 'full') return true;
    const method = String(ctx.switchToHttp().getRequest().method ?? 'GET').toUpperCase();
    if (mode === 'readonly' && SAFE.has(method)) return true;
    throw new HttpException(
      mode === 'readonly'
        ? { statusCode: 402, error: 'subscription_readonly', message: 'Assinatura sem pagamento: a conta está somente para leitura' }
        : { statusCode: 402, error: 'subscription_inactive', message: 'Assinatura inativa' },
      HttpStatus.PAYMENT_REQUIRED,
    );
  }
}
