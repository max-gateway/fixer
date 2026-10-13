import { Inject, Injectable, Optional, UnauthorizedException } from '@nestjs/common';
import { createRemoteJWKSet, jwtVerify, type JWTPayload } from 'jose';
import { PlanLimits } from '../control-plane/plan-limits.service.js';
import { ProvisioningService } from '../control-plane/provisioning.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { TenantContext } from '../tenancy/tenant-context.js';
import { AuthConfig } from './auth.config.js';
import type { AuthUser } from './auth.decorators.js';

@Injectable()
export class AuthService {
  private readonly jwks;

  constructor(
    private readonly config: AuthConfig,
    private readonly prisma: PrismaService,
    /** O dono cadastrado pelo control plane vira Admin no primeiro login. Ausente em testes unitários. */
    @Optional() @Inject(ProvisioningService) private readonly provisioning: ProvisioningService | null = null,
    /** Limite de usuários do plano. Ausente em testes unitários. */
    @Optional() @Inject(PlanLimits) private readonly limits: PlanLimits | null = null,
  ) {
    // jose faz cache das chaves e refaz o fetch quando aparece um kid novo.
    this.jwks = createRemoteJWKSet(config.jwksUrl);
  }

  /** Só valida assinatura, emissor e validade. Não toca no banco (usado antes de saber a organização). */
  async verify(token: string): Promise<JWTPayload> {
    try {
      const { payload } = await jwtVerify(token, this.jwks, { issuer: this.config.issuer });
      return payload;
    } catch {
      throw new UnauthorizedException('Token inválido');
    }
  }

  /** Valida o access token e devolve o usuário da organização atual (criado/atualizado a partir dos claims). */
  async authenticate(token: string): Promise<AuthUser> {
    return this.syncUser(await this.verify(token));
  }

  /** Para quem já validou o token (o middleware de tenancy): sincroniza o usuário na organização do contexto. */
  authenticatePayload(payload: JWTPayload): Promise<AuthUser> {
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

    // Keycloak é a fonte da verdade: nome/e-mail são sobrescritos a cada login. O usuário é POR ORGANIZAÇÃO
    // (a mesma pessoa em duas oficinas tem duas linhas, com papéis independentes).
    const orgId = TenantContext.require();
    await this.limits?.assertUserSlot(keycloakId);
    const user = await this.prisma.user.upsert({
      where: { orgId_keycloakId: { orgId, keycloakId } },
      create: { keycloakId, email, name },
      update: { email, name },
    });
    if (!user.active) throw new UnauthorizedException('Usuário desativado');
    await this.provisioning?.ensureOwnerAdmin({ id: user.id, email: user.email });
    return { id: user.id, keycloakId, name: user.name, email: user.email };
  }
}
