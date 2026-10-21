import { AuthError, resolvePrincipal, type TenantDirectory as PlatformDirectory } from '@max-gateway/auth';
import { ForbiddenException, HttpException, Inject, Injectable, NestMiddleware, NotFoundException, Optional } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';
import { AuthService } from '../auth/auth.service.js';
import { MembershipService } from './membership.service.js';
import { TenantContext } from './tenant-context.js';
import { TenantDirectory } from './tenant-directory.service.js';

/** Sem registro de participação (só testes) ninguém pertence a organização nenhuma: fecha por padrão. */
const NO_DIRECTORY: PlatformDirectory = { membershipsOf: async () => [], storesOf: async () => [], catalogsOf: async () => [] };

/**
 * Abre o contexto da organização para a requisição inteira (guards, interceptors, handlers e tudo que eles chamam).
 * Token ausente ou inválido não é recusado aqui: segue sem organização e o AuthGuard responde 401 nas rotas protegidas.
 *
 * Interpretar o token é do `@max-gateway/auth` (mesma regra da plataforma e do Rocket, provada pela suíte de conformidade):
 * pertencimento e papel vêm do registro de participação do Fixer; `X-Org-Id` só escolhe entre as organizações do usuário
 * (fora delas: 404 idêntico ao inexistente); várias organizações sem `X-Org-Id`: 400.
 */
@Injectable()
export class TenantMiddleware {
  constructor(
    private readonly auth: AuthService,
    /** Participação conhecida pelo Fixer (autoridade); ausente só em testes. */
    @Optional() @Inject(MembershipService) private readonly membership: MembershipService | null = null,
  ) {}

  async use(req: Request & { jwt?: unknown }, _res: Response, next: NextFunction): Promise<void> {
    const [scheme, token] = (req.headers.authorization ?? '').split(' ');
    if (scheme?.toLowerCase() !== 'bearer' || !token) return next();
    let payload;
    try {
      payload = await this.auth.verify(token);
    } catch {
      return next(); // o AuthGuard devolve o 401
    }
    let principal;
    try {
      principal = await resolvePrincipal(payload, req.headers, { directory: this.membership ?? NO_DIRECTORY, roleScopes: {} });
    } catch (e) {
      if (e instanceof AuthError) throw new HttpException(e.message, e.status);
      throw e;
    }
    // Esta API atende pessoas: token de serviço (mg_tenant) ou de cliente sem organização não abre contexto de oficina.
    if (!principal.userId || !principal.tenantId) throw new ForbiddenException('Token sem usuário e organização');
    req.jwt = payload;
    TenantContext.run(principal.tenantId, () => next());
  }
}

/** Rotas públicas do portal: a organização vem do dono do token da URL (a credencial do cliente final). */
@Injectable()
export class PortalTenantMiddleware implements NestMiddleware {
  constructor(private readonly directory: TenantDirectory) {}

  async use(req: Request, _res: Response, next: NextFunction): Promise<void> {
    const token = /^\/portal\/([^/?#]+)/.exec(req.originalUrl)?.[1];
    const orgId = token ? await this.directory.orgForPortalToken(decodeURIComponent(token)) : null;
    if (!orgId) throw new NotFoundException('Link inválido ou expirado');
    TenantContext.run(orgId, () => next());
  }
}
