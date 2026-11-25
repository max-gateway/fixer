import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PrismaService } from '../prisma/prisma.service.js';
import { REQUIRED_PERMISSION } from './permissions.js';

/** Roda depois do AuthGuard (que preenche `req.user`). Rotas sem @RequirePermission passam direto. */
@Injectable()
export class PermissionGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly prisma: PrismaService,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const key = this.reflector.getAllAndOverride<string | undefined>(REQUIRED_PERMISSION, [ctx.getHandler(), ctx.getClass()]);
    if (!key) return true;
    const user = ctx.switchToHttp().getRequest().user as { id?: string } | undefined;
    if (!user?.id) throw new ForbiddenException('Sem permissão');

    const granted = await this.prisma.rolePermission.count({
      where: { permission: { key }, role: { users: { some: { userId: user.id } } } },
    });
    if (granted === 0) throw new ForbiddenException(`Sem permissão: ${key}`);
    return true;
  }
}
