import { describe, expect, it } from 'vitest';
import { isUuid, orgIdsFromToken, pickActiveOrg } from './org';

const A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const jwt = (payload: object) => `x.${Buffer.from(JSON.stringify(payload)).toString('base64url')}.y`;

describe('orgIdsFromToken', () => {
  it('lê a lista de organizações do claim', () => {
    expect(orgIdsFromToken(jwt({ organization: [A, B] }))).toEqual([A, B]);
  });
  it('normaliza maiúsculas, ignora lixo e repetidos', () => {
    expect(orgIdsFromToken(jwt({ organization: [A.toUpperCase(), A, 'nao-uuid', 42, null] }))).toEqual([A]);
  });
  it('formato objeto: a chave UUID é a organização; o id interno do Keycloak não conta', () => {
    expect(orgIdsFromToken(jwt({ organization: { [A]: { id: B } } }))).toEqual([A]);
    expect(orgIdsFromToken(jwt({ organization: { oficina: { id: B } } }))).toEqual([B]);
  });
  it('respeita o nome do claim configurado', () => {
    expect(orgIdsFromToken(jwt({ orgs: [A] }), 'orgs')).toEqual([A]);
    expect(orgIdsFromToken(jwt({ orgs: [A] }))).toEqual([]);
  });
  it('token ausente, malformado ou sem claim vira lista vazia (nunca lança)', () => {
    expect(orgIdsFromToken(null)).toEqual([]);
    expect(orgIdsFromToken('')).toEqual([]);
    expect(orgIdsFromToken('sem-pontos')).toEqual([]);
    expect(orgIdsFromToken('a.%%%.c')).toEqual([]);
    expect(orgIdsFromToken(jwt({}))).toEqual([]);
  });
});

describe('pickActiveOrg', () => {
  it('uma oficina só: é ela, sem escolher (e o cookie é irrelevante)', () => {
    expect(pickActiveOrg([A])).toEqual({ active: A, needsChoice: false });
    expect(pickActiveOrg([A], B)).toEqual({ active: A, needsChoice: false });
  });
  it('token sem organizações (instalação legada): nada a enviar e nada a escolher', () => {
    expect(pickActiveOrg([])).toEqual({ active: null, needsChoice: false });
    expect(pickActiveOrg([], A)).toEqual({ active: null, needsChoice: false });
  });
  it('várias oficinas: usa a escolhida se ela ainda vale; senão exige escolher', () => {
    expect(pickActiveOrg([A, B], B)).toEqual({ active: B, needsChoice: false });
    expect(pickActiveOrg([A, B], B.toUpperCase())).toEqual({ active: B, needsChoice: false });
    expect(pickActiveOrg([A, B])).toEqual({ active: null, needsChoice: true });
    expect(pickActiveOrg([A, B], null)).toEqual({ active: null, needsChoice: true });
  });
  it('cookie com oficina que não está mais no token (ou adulterado) não vale', () => {
    expect(pickActiveOrg([A, B], 'cccccccc-cccc-4ccc-8ccc-cccccccccccc')).toEqual({ active: null, needsChoice: true });
    expect(pickActiveOrg([A, B], '../../etc')).toEqual({ active: null, needsChoice: true });
  });
});

describe('isUuid', () => {
  it('só aceita UUID', () => {
    expect(isUuid(A)).toBe(true);
    expect(isUuid('abc')).toBe(false);
    expect(isUuid(undefined)).toBe(false);
  });
});
