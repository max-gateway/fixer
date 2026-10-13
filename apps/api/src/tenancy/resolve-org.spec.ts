import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { describe, expect, it } from 'vitest';
import { orgsFromClaim, resolveOrg } from './resolve-org.js';

const A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const cfg = { claim: 'orgs' };

describe('orgsFromClaim', () => {
  it('lê lista de UUIDs, ignora lixo e normaliza para minúsculas', () => {
    expect(orgsFromClaim([A.toUpperCase(), 'nao-uuid', 42, B])).toEqual([A, B]);
  });
  it('lê o formato objeto do Keycloak: a chave UUID é a organização; o id interno do Keycloak não conta', () => {
    expect(orgsFromClaim({ [A]: { id: B } })).toEqual([A]); // B aqui seria o id interno do Keycloak, não uma organização
    expect(orgsFromClaim({ oficina: { id: B } })).toEqual([B]); // alias que não é UUID: cai para o id
  });
  it('ausente ou de tipo errado vira lista vazia', () => {
    expect(orgsFromClaim(undefined)).toEqual([]);
    expect(orgsFromClaim('x')).toEqual([]);
  });
});

describe('resolveOrg', () => {
  it('usa a única organização do token', () => {
    expect(resolveOrg({ orgs: [A] }, undefined, cfg)).toBe(A);
  });
  it('várias organizações exigem o cabeçalho X-Org-Id', () => {
    expect(() => resolveOrg({ orgs: [A, B] }, undefined, cfg)).toThrow(BadRequestException);
    expect(resolveOrg({ orgs: [A, B] }, B, cfg)).toBe(B);
    expect(resolveOrg({ orgs: [A, B] }, ` ${B.toUpperCase()} `, cfg)).toBe(B);
  });
  it('o cabeçalho NUNCA concede acesso a organização fora do token', () => {
    expect(() => resolveOrg({ orgs: [A] }, B, cfg)).toThrow(ForbiddenException);
    expect(() => resolveOrg({ orgs: [A] }, B, { ...cfg, defaultOrgId: B })).toThrow(ForbiddenException);
  });
  it('token sem organização é recusado, a menos que a instalação legada defina DEFAULT_ORG_ID', () => {
    expect(() => resolveOrg({}, undefined, cfg)).toThrow(ForbiddenException);
    expect(resolveOrg({}, undefined, { ...cfg, defaultOrgId: A.toUpperCase() })).toBe(A);
    expect(resolveOrg({}, B, { ...cfg, defaultOrgId: A })).toBe(A); // legado: o cabeçalho é ignorado
  });
  it('participação conhecida pelo Fixer vale mesmo sem claim no token (o Keycloak 26.0 o omite ao acaso)', () => {
    expect(resolveOrg({}, undefined, cfg, [A])).toBe(A);
    expect(resolveOrg({}, B, cfg, [A, B])).toBe(B);
    expect(() => resolveOrg({}, undefined, cfg, [A, B])).toThrow(BadRequestException);
  });
  it('claim e participação se somam, sem repetir', () => {
    expect(resolveOrg({ orgs: [A] }, undefined, cfg, [A.toUpperCase()])).toBe(A);
    expect(resolveOrg({ orgs: [A] }, B, cfg, [B])).toBe(B); // B só consta na participação
    expect(() => resolveOrg({ orgs: [A] }, 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', cfg, [B])).toThrow(ForbiddenException);
  });
  it('respeita o nome do claim configurado', () => {
    expect(resolveOrg({ tenant_orgs: [A] }, undefined, { claim: 'tenant_orgs' })).toBe(A);
  });
});
