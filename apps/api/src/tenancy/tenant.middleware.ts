import { Inject, Injectable, NestMiddleware, NotFoundException, Optional } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';
import { AuthConfig } from '../auth/auth.config.js';
import { AuthService } from '../auth/auth.service.js';
import { MembershipService } from './membership.service.js';
import { resolveOrg } from './resolve-org.js';
import { TenantContext } from './tenant-context.js';
import { TenantDirectory } from './tenant-directory.service.js';

/**
 * Abre o contexto da organização para a requisição inteira (guards, interceptors, handlers e tudo que eles chamam).
 * Token ausente ou inválido não é recusado aqui: segue sem organização e o AuthGuard responde 401 nas rotas protegidas.
 */
@Injectable()
export class TenantMiddleware implements NestMiddleware {
  constructor(
    private readonly auth: AuthService,
    private readonly config: AuthConfig,
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
    const header = req.headers['x-org-id'];
    const orgId = resolveOrg(
      payload,
      Array.isArray(header) ? header[0] : header,
      { claim: this.config.orgsClaim, defaultOrgId: this.config.defaultOrgId },
      (await this.membership?.orgsFor(payload.sub)) ?? [],
    );
    req.jwt = payload;
    TenantContext.run(orgId, () => next());
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
