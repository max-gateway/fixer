import { describe, expect, it } from 'vitest';
import { buildEndSessionUrl, publicBase, safePath } from './logout';

describe('safePath', () => {
  it('aceita só caminho interno', () => {
    expect(safePath('/notas')).toBe('/notas');
    expect(safePath('//evil.com')).toBe('/');
    expect(safePath('https://evil.com')).toBe('/');
    expect(safePath(undefined)).toBe('/');
  });
});

describe('publicBase', () => {
  it('prefere AUTH_URL e tira a barra final', () => {
    expect(publicBase('https://fixer.maxgateway.com.br/', 'http://0.0.0.0:3001')).toBe('https://fixer.maxgateway.com.br');
    expect(publicBase(undefined, 'http://localhost:3001')).toBe('http://localhost:3001');
  });
});

describe('buildEndSessionUrl', () => {
  const base = { issuer: 'https://id.x/realms/r', clientId: 'fixer-web', base: 'https://fixer.x' };
  it('monta o logout com retorno ao /login e id_token_hint', () => {
    const u = new URL(buildEndSessionUrl({ ...base, idToken: 'tok' }));
    expect(u.origin + u.pathname).toBe('https://id.x/realms/r/protocol/openid-connect/logout');
    expect(u.searchParams.get('post_logout_redirect_uri')).toBe('https://fixer.x/login');
    expect(u.searchParams.get('id_token_hint')).toBe('tok');
    expect(u.searchParams.get('client_id')).toBe('fixer-web');
  });
  it('sem id token omite o hint', () => {
    expect(new URL(buildEndSessionUrl(base)).searchParams.has('id_token_hint')).toBe(false);
  });
});
