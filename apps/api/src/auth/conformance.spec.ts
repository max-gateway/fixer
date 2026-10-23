import { AuthError, resolvePrincipal, type Principal } from '@max-gateway/auth';
import { captureOutcome, runConformance, type ResolvedVector } from '@max-gateway/auth/conformance';
import { memoryDirectory } from '@max-gateway/auth/testkit';
import { UnauthorizedException } from '@nestjs/common';
import { createLocalJWKSet } from 'jose';
import { describe, expect, it } from 'vitest';
import { AuthService } from './auth.service.js';

/**
 * Suíte de conformidade do `@max-gateway/auth` (docs/specs/catalog-platform.md §7.2): o mesmo conjunto de vetores que a plataforma e o Rocket
 * executam. Aqui ela roda sobre o caminho REAL de verificação do Fixer (`AuthService.verify`, com a audiência e os limites que o Fixer
 * configura) e sobre a resolução de identidade do pacote. O registro de tenants usado é o do vetor: o `FixerTenantDirectory` tem a sua
 * própria bateria (loja implícita, papéis derivados das permissões de negócio).
 */
function fixerSystem(r: ResolvedVector): Promise<ReturnType<typeof captureOutcome> extends Promise<infer O> ? O : never> {
  return captureOutcome(async (): Promise<Principal> => {
    const service = new AuthService(
      { issuer: r.config.issuer, audience: r.config.audience, jwksUrl: new URL('http://kc/certs') } as never,
      {} as never,
    );
    const hooks = service as unknown as { jwks: unknown; now: () => Date };
    hooks.jwks = createLocalJWKSet(r.jwks as never);
    hooks.now = () => new Date(r.now * 1000);

    const auth = String(r.headers.authorization ?? '');
    const token = auth.toLowerCase().startsWith('bearer ') ? auth.slice(7) : '';
    if (!token) throw new AuthError(401, 'unauthorized', 'token ausente');
    let payload;
    try {
      payload = await service.verify(token);
    } catch (e) {
      if (e instanceof UnauthorizedException) throw new AuthError(401, 'unauthorized', 'token inválido');
      throw e;
    }
    return resolvePrincipal(
      payload,
      r.headers,
      r.config.userTokens ? { directory: memoryDirectory(r.directory), roleScopes: r.roleScopes } : undefined,
    );
  });
}

describe('conformidade com o @max-gateway/auth (vetores compartilhados)', () => {
  it('o Fixer interpreta token, organização, loja e papéis como a plataforma', async () => {
    const failures = await runConformance(fixerSystem);
    expect(failures).toEqual([]);
  });
});
