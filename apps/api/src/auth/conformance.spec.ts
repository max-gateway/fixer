import { AuthError, resolvePrincipal, type Headers } from '@max-gateway/auth';
import { captureOutcome, runConformance } from '@max-gateway/auth/conformance';
import { memoryDirectory, testKeys } from '@max-gateway/auth/testkit';
import { UnauthorizedException } from '@nestjs/common';
import { describe, expect, it } from 'vitest';
import { AuthService } from './auth.service.js';

/**
 * Suíte de conformidade da plataforma (spec §7.2): o Fixer interpreta token e cabeçalhos exatamente como a plataforma de catálogo e o Rocket.
 * Verificação = `AuthService.verify` (config do Fixer) e resolução = o mesmo `resolvePrincipal` que o `TenantMiddleware` usa.
 * Divergência quebra o build.
 */
describe('conformidade @max-gateway/auth no Fixer', () => {
  it('passa em todos os vetores', async () => {
    const failures = await runConformance((r) =>
      captureOutcome(async () => {
        const service = new AuthService({ issuer: r.config.issuer, audience: r.config.audience, maxTokenLifetimeSec: r.config.maxTokenLifetimeSec, jwksUrl: new URL('http://idp.test/certs') } as never, {} as never);
        service.jwks = testKeys;
        service.now = () => new Date(r.now * 1000);
        const raw = r.headers.authorization;
        const token = String(Array.isArray(raw) ? raw[0] : (raw ?? '')).split(' ')[1];
        if (!token) throw new AuthError(401, 'unauthorized', 'token ausente');
        let payload;
        try {
          payload = await service.verify(token);
        } catch (e) {
          if (e instanceof UnauthorizedException) throw new AuthError(401, 'unauthorized', 'token inválido');
          throw e;
        }
        return resolvePrincipal(payload, r.headers as Headers, r.config.userTokens ? { directory: memoryDirectory(r.directory), roleScopes: r.roleScopes } : undefined);
      }),
    );
    expect(failures).toEqual([]);
  });
});
