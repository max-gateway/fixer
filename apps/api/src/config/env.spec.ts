import { describe, expect, it } from 'vitest';
import { validateEnv } from './env.js';

const ok = {
  DATABASE_URL: 'postgresql://u:p@localhost:5432/fixer',
  KEYCLOAK_AUTH_SERVER_URL: 'http://localhost:8180',
  KEYCLOAK_REALM: 'fixer-dev',
  AUTH_AUDIENCE: 'fixer-api',
};

describe('validateEnv', () => {
  it('aplica defaults', () => {
    const env = validateEnv(ok);
    expect(env.PORT).toBe(3000);
    expect(env.PLATE_LOOKUP_SERVICE_URL).toBe('http://localhost:8081');
  });

  it('lista tudo o que falta', () => {
    expect(() => validateEnv({})).toThrow(/DATABASE_URL[\s\S]*KEYCLOAK_AUTH_SERVER_URL[\s\S]*KEYCLOAK_REALM[\s\S]*AUTH_AUDIENCE/);
  });

  it('exige a audiência da API: sem ela o token de qualquer outro client seria aceito', () => {
    const { AUTH_AUDIENCE: _omitted, ...semAudiencia } = ok;
    expect(() => validateEnv(semAudiencia)).toThrow(/AUTH_AUDIENCE/);
  });

  it('a organização padrão de instalação legada e o claim configurável deixaram de existir', () => {
    const env = validateEnv({ ...ok, DEFAULT_ORG_ID: '11111111-1111-4111-8111-111111111111', AUTH_ORGS_CLAIM: 'x' });
    expect(env).not.toHaveProperty('DEFAULT_ORG_ID');
    expect(env).not.toHaveProperty('AUTH_ORGS_CLAIM');
  });

  it('lista de catálogos: separada por vírgula, vazia por padrão', () => {
    expect(validateEnv(ok).PARTS_SEARCH_CATALOGS).toEqual([]);
    expect(validateEnv({ ...ok, PARTS_SEARCH_CATALOGS: ' rocket-autopecas , outro ,, ' }).PARTS_SEARCH_CATALOGS).toEqual(['rocket-autopecas', 'outro']);
  });

  it('rejeita URL malformada', () => {
    expect(() => validateEnv({ ...ok, PLATE_LOOKUP_SERVICE_URL: 'localhost' })).toThrow(/PLATE_LOOKUP_SERVICE_URL/);
  });
});
