import { mintToken, OTHER_PRIVATE_JWK, TEST_ISSUER, testKeys } from '@max-gateway/auth/testkit';
import { UnauthorizedException } from '@nestjs/common';
import { describe, expect, it } from 'vitest';
import { AuthService } from './auth.service.js';

const AUD = 'fixer-api';
const config = { issuer: TEST_ISSUER, audience: AUD, jwksUrl: new URL('http://kc/realms/r/certs') };

function service() {
  const s = new AuthService(config as never, {} as never);
  // A verificação usa o JWKS do Keycloak; nos testes, a chave de teste do pacote.
  (s as unknown as { jwks: unknown }).jwks = testKeys;
  return s;
}

describe('AuthService.verify (token validado pelo @max-gateway/auth)', () => {
  it('aceita token válido para a audiência da API, inclusive quando ela divide o token com outras (ex.: parts-search)', async () => {
    const payload = await service().verify(await mintToken({ sub: 'u1' }, { aud: [AUD, 'parts-search'] }));
    expect(payload.sub).toBe('u1');
  });

  it('recusa token sem audiência da API (hoje o Keycloak não a põe sozinho: precisa do audience mapper)', async () => {
    await expect(service().verify(await mintToken({ sub: 'u1' }, { aud: 'account' }))).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('recusa emissor errado', async () => {
    await expect(service().verify(await mintToken({}, { aud: AUD, iss: 'https://outro/realms/x' }))).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('recusa token que vive mais de 15 minutos', async () => {
    await expect(service().verify(await mintToken({}, { aud: AUD, ttl: 3600 }))).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('recusa token sem iat e token expirado', async () => {
    await expect(service().verify(await mintToken({}, { aud: AUD, iatClaim: null }))).rejects.toBeInstanceOf(UnauthorizedException);
    const old = Math.floor(Date.now() / 1000) - 7200;
    await expect(service().verify(await mintToken({}, { aud: AUD, iat: old, ttl: 300 }))).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('recusa assinatura de outra chave e lixo', async () => {
    await expect(service().verify(await mintToken({}, { aud: AUD, key: OTHER_PRIVATE_JWK }))).rejects.toBeInstanceOf(UnauthorizedException);
    await expect(service().verify('lixo')).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('a mensagem da recusa não revela o motivo', async () => {
    await expect(service().verify(await mintToken({}, { aud: 'account' }))).rejects.toThrow('Token inválido');
  });
});
