import { describe, expect, it } from 'vitest';
import { validateEnv } from './env.js';

const ok = {
  DATABASE_URL: 'postgresql://u:p@localhost:5432/fixer',
  KEYCLOAK_AUTH_SERVER_URL: 'http://localhost:8180',
  KEYCLOAK_REALM: 'fixer-dev',
};

describe('validateEnv', () => {
  it('aplica defaults', () => {
    const env = validateEnv(ok);
    expect(env.PORT).toBe(3000);
    expect(env.PLATE_LOOKUP_SERVICE_URL).toBe('http://localhost:8081');
  });

  it('lista tudo o que falta', () => {
    expect(() => validateEnv({})).toThrow(/DATABASE_URL[\s\S]*KEYCLOAK_AUTH_SERVER_URL[\s\S]*KEYCLOAK_REALM/);
  });

  it('rejeita URL malformada', () => {
    expect(() => validateEnv({ ...ok, PLATE_LOOKUP_SERVICE_URL: 'localhost' })).toThrow(/PLATE_LOOKUP_SERVICE_URL/);
  });
});
