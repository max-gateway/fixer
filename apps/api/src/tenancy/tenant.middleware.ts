import { resolvePrincipal, type RoleScopeMap } from '@max-gateway/auth';
import { ForbiddenException, Inject, Injectable, NestMiddleware, NotFoundException } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';
import { authErrorToHttp } from '../auth/auth-error-http.js';
import { AuthService } from '../auth/auth.service.js';
import { FixerTenantDirectory } from './fixer-tenant-directory.js';
import { TenantContext } from './tenant-context.js';
import { TenantDirectory } from './tenant-directory.service.js';

/** Token de injeção do mapa papel → escopos da plataforma (`PLATFORM_ROLE_SCOPES` do `@max-gateway/auth`). */
export const ROLE_SCOPES = Symbol('ROLE_SCOPES');

/**
 * Abre o contexto da organização para a requisição inteira (guards, interceptors, handlers e tudo que eles chamam).
 * Quem interpreta a identidade é o `@max-gateway/auth` (`resolvePrincipal`): a organização vem do registro de participação, nunca do
 * claim do token, e `X-Org-Id` só escolhe entre as concedidas (fora delas: 404 idêntico ao inexistente).
 * Token ausente ou inválido não é recusado aqui: segue sem organização e o AuthGuard responde 401 nas rotas protegidas.
 */
@Injectable()
export class TenantMiddleware implements NestMiddleware {
  constructor(
    private readonly auth: AuthService,
    private readonly directory: FixerTenantDirectory,
    @Inject(ROLE_SCOPES) private readonly roleScopes: RoleScopeMap,
  ) {}

  async use(req: Request & { jwt?: unknown; principal?: unknown }, _res: Response, next: NextFunction): Promise<void> {
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
      principal = await resolvePrincipal(payload, req.headers, { directory: this.directory, roleScopes: this.roleScopes });
    } catch (err) {
      throw authErrorToHttp(err);
    }
    if (!principal.tenantId) throw new ForbiddenException('Token sem organização');
    req.jwt = payload;
    req.principal = principal;
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
