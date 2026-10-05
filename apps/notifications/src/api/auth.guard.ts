import { CanActivate, createParamDecorator, ExecutionContext, Inject, Injectable, UnauthorizedException } from '@nestjs/common';
import { createRemoteJWKSet, jwtVerify } from 'jose';
import { CONFIG, type AppConfig } from '../config/config.js';

export interface Me {
  /** E-mail em minúsculas: é a chave da caixa de entrada (o evento traz o e-mail do responsável). */
  email: string;
  name: string;
}

/**
 * Valida o access token do Keycloak do tenant (mesmo issuer da API) — sem consultar a API nem o
 * banco dela. O serviço só precisa saber QUEM é; a autorização é: equipe autenticada do tenant
 * (cada tenant tem o próprio realm, Postgres e Redis).
 */
@Injectable()
export class AuthGuard implements CanActivate {
  private readonly jwks;

  constructor(@Inject(CONFIG) private readonly cfg: AppConfig) {
    this.jwks = createRemoteJWKSet(new URL(cfg.auth.jwksUrl));
  }

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx.switchToHttp().getRequest();
    const [scheme, token] = String(req.headers.authorization ?? '').split(' ');
    if (scheme?.toLowerCase() !== 'bearer' || !token) throw new UnauthorizedException('Token ausente');
    try {
      const { payload } = await jwtVerify(token, this.jwks, { issuer: this.cfg.auth.issuer });
      if (typeof payload.email !== 'string' || !payload.email) throw new Error('sem email');
      req.me = {
        email: payload.email.trim().toLowerCase(),
        name: typeof payload.name === 'string' ? payload.name : payload.email,
      } satisfies Me;
      return true;
    } catch {
      throw new UnauthorizedException('Token inválido');
    }
  }
}

export const CurrentMe = createParamDecorator((_: unknown, ctx: ExecutionContext): Me => ctx.switchToHttp().getRequest().me);
