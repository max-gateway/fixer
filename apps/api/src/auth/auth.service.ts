import { Injectable, UnauthorizedException } from '@nestjs/common';
import { createRemoteJWKSet, jwtVerify, type JWTPayload } from 'jose';
import { PrismaService } from '../prisma/prisma.service.js';
import { AuthConfig } from './auth.config.js';
import type { AuthUser } from './auth.decorators.js';

@Injectable()
export class AuthService {
  private readonly jwks;

  constructor(
    private readonly config: AuthConfig,
    private readonly prisma: PrismaService,
  ) {
    // jose faz cache das chaves e refaz o fetch quando aparece um kid novo.
    this.jwks = createRemoteJWKSet(config.jwksUrl);
  }

  /** Valida o access token e devolve o usuário local (criado/atualizado a partir dos claims). */
  async authenticate(token: string): Promise<AuthUser> {
    let payload: JWTPayload;
    try {
      ({ payload } = await jwtVerify(token, this.jwks, { issuer: this.config.issuer }));
    } catch {
      throw new UnauthorizedException('Token inválido');
    }
    return this.syncUser(payload);
  }

  private async syncUser(payload: JWTPayload): Promise<AuthUser> {
    const keycloakId = payload.sub;
    const email = typeof payload.email === 'string' ? payload.email : undefined;
    if (!keycloakId || !email) {
      throw new UnauthorizedException('Token sem sub/email (verifique os scopes do client)');
    }
    const name =
      typeof payload.name === 'string' && payload.name
        ? payload.name
        : typeof payload.preferred_username === 'string'
          ? payload.preferred_username
          : email;

    // Keycloak é a fonte da verdade: nome/e-mail são sobrescritos a cada login.
    const user = await this.prisma.user.upsert({
      where: { keycloakId },
      create: { keycloakId, email, name },
      update: { email, name },
    });
    if (!user.active) throw new UnauthorizedException('Usuário desativado');
    return { id: user.id, keycloakId, name: user.name, email: user.email };
  }
}
