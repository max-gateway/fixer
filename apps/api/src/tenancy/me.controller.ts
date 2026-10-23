import { Controller, Get, Headers, UnauthorizedException } from '@nestjs/common';
import { Public } from '../auth/auth.decorators.js';
import { AuthService } from '../auth/auth.service.js';
import { SystemPrismaService } from '../prisma/system-prisma.service.js';
import { MembershipService } from './membership.service.js';

/**
 * Rotas do próprio usuário que NÃO dependem de uma organização escolhida. Ficam fora do `TenantMiddleware` (quem participa de
 * várias oficinas e ainda não escolheu receberia 400) e validam o token aqui mesmo.
 */
@Public()
@Controller('me')
export class MeController {
  constructor(
    private readonly auth: AuthService,
    private readonly system: SystemPrismaService,
    private readonly membership: MembershipService,
  ) {}

  /**
   * As organizações do usuário (e só elas) com o nome de cada uma, para o seletor de oficina da web. Usa o cliente de sistema
   * porque nenhuma organização está no contexto. A autoridade é a participação registrada pelo control plane: o claim `organization`
   * do token é só uma pista (o Keycloak 26.0 o omite ao acaso) e nunca concede nem lista nada.
   */
  @Get('organizations')
  async organizations(@Headers('authorization') authorization?: string) {
    const [scheme, token] = (authorization ?? '').split(' ');
    if (scheme?.toLowerCase() !== 'bearer' || !token) throw new UnauthorizedException('Token ausente');
    const payload = await this.auth.verify(token);

    const ids = [...new Set(await this.membership.orgsFor(payload.sub))];
    const profiles = ids.length ? await this.system.orgProfile.findMany({ where: { orgId: { in: ids } }, select: { orgId: true, slug: true, name: true } }) : [];
    const byId = new Map(profiles.map((p) => [p.orgId, p]));
    return {
      organizations: ids.map((id) => {
        const p = byId.get(id);
        return { id, name: p?.name ?? p?.slug ?? null, slug: p?.slug ?? null };
      }),
    };
  }
}
