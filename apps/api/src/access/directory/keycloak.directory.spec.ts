import { describe, expect, it } from 'vitest';
import type { DirectoryConfig } from './directory.config.js';
import { KeycloakDirectory } from './keycloak.directory.js';
import { DirectoryError } from './member-directory.js';

const ORG = '11111111-1111-4111-8111-111111111111';

type Route = (req: { method: string; url: URL; body: string | undefined }) => { status: number; json?: unknown; text?: string } | undefined;

/** Keycloak falso: registra as chamadas e responde pela primeira rota que casar. */
function fakeKeycloak(routes: Route[]) {
  const calls: { method: string; path: string; body?: string }[] = [];
  const http = (async (input: string | URL, init: RequestInit = {}) => {
    const url = new URL(String(input));
    const method = init.method ?? 'GET';
    const body = typeof init.body === 'string' ? init.body : init.body ? String(init.body) : undefined;
    if (url.pathname.endsWith('/token')) return Response.json({ access_token: 'tk', expires_in: 300 });
    calls.push({ method, path: url.pathname.replace('/admin/realms/r', '') + url.search, body });
    for (const route of routes) {
      const r = route({ method, url, body });
      if (r) return r.json !== undefined ? Response.json(r.json, { status: r.status }) : new Response(r.text ?? null, { status: r.status });
    }
    return new Response('not found', { status: 404 });
  }) as typeof fetch;
  return { http, calls };
}

const config = (mode: 'organization' | 'realm' = 'organization') =>
  ({ baseUrl: 'http://kc', realm: 'r', clientId: 'c', clientSecret: 's', mode, emailLifespan: 3600, emailClientId: 'fixer-web', redirectUri: 'http://web' }) as DirectoryConfig;

const on = (method: string, path: RegExp, res: { status: number; json?: unknown; text?: string }): Route => (req) =>
  req.method === method && path.test(req.url.pathname) ? res : undefined;

const orgs = on('GET', /\/organizations$/, { status: 200, json: [{ id: 'kc-org', alias: ORG, name: 'Oficina' }] });

describe('KeycloakDirectory (organization)', () => {
  it('lista os membros da Organization cujo alias é a organização', async () => {
    const { http, calls } = fakeKeycloak([
      orgs,
      on('GET', /\/organizations\/kc-org\/members$/, {
        status: 200,
        json: [
          { id: 'u1', email: 'Ana@X.com', firstName: 'Ana', lastName: 'Souza', enabled: true, emailVerified: true, createdTimestamp: 1_700_000_000_000 },
          { id: 'u2', username: 'bia@x.com', enabled: false, requiredActions: ['UPDATE_PASSWORD'] },
        ],
      }),
    ]);
    const members = await new KeycloakDirectory(config(), http).listMembers(ORG);
    expect(members).toEqual([
      { id: 'u1', email: 'ana@x.com', name: 'Ana Souza', enabled: true, emailVerified: true, pendingActions: [], createdAt: new Date(1_700_000_000_000) },
      { id: 'u2', email: 'bia@x.com', name: 'bia@x.com', enabled: false, emailVerified: false, pendingActions: ['UPDATE_PASSWORD'], createdAt: null },
    ]);
    // O id da Organization é cacheado: a segunda listagem não procura de novo.
    const dir = new KeycloakDirectory(config(), http);
    await dir.listMembers(ORG);
    await dir.listMembers(ORG);
    expect(calls.filter((c) => c.path.startsWith('/organizations?')).length).toBe(2);
  });

  it('convite de pessoa nova: cria a conta, adiciona à organização e envia o e-mail', async () => {
    let created = false;
    const { http, calls } = fakeKeycloak([
      orgs,
      (req) => (req.method === 'GET' && req.url.pathname.endsWith('/users') ? { status: 200, json: created ? [{ id: 'new', email: 'caio@x.com', requiredActions: ['UPDATE_PASSWORD'] }] : [] } : undefined),
      (req) => (req.method === 'POST' && req.url.pathname.endsWith('/users') ? ((created = true), { status: 201 }) : undefined),
      on('POST', /\/organizations\/kc-org\/members$/, { status: 201 }),
      on('PUT', /\/users\/new\/execute-actions-email$/, { status: 204 }),
    ]);
    const res = await new KeycloakDirectory(config(), http).invite(ORG, { email: ' Caio@X.com ', name: 'Caio Lima Neto' });
    expect(res).toMatchObject({ created: true, emailSent: true, member: { id: 'new', email: 'caio@x.com' } });
    const post = calls.find((c) => c.method === 'POST' && c.path === '/users')!;
    expect(JSON.parse(post.body!)).toMatchObject({ username: 'caio@x.com', firstName: 'Caio', lastName: 'Lima Neto', requiredActions: ['UPDATE_PASSWORD'] });
    expect(calls.find((c) => c.path === '/organizations/kc-org/members')!.body).toBe('new');
    const mail = calls.find((c) => c.path.includes('execute-actions-email'))!;
    expect(JSON.parse(mail.body!)).toEqual(['UPDATE_PASSWORD', 'VERIFY_EMAIL']);
    expect(mail.path).toContain('client_id=fixer-web');
  });

  it('convite de quem já é membro e já entrou: idempotente e sem e-mail', async () => {
    const { http, calls } = fakeKeycloak([
      orgs,
      on('GET', /\/users$/, { status: 200, json: [{ id: 'u1', email: 'ana@x.com', emailVerified: true, requiredActions: [] }] }),
      on('POST', /\/organizations\/kc-org\/members$/, { status: 409 }),
    ]);
    const res = await new KeycloakDirectory(config(), http).invite(ORG, { email: 'ana@x.com' });
    expect(res).toMatchObject({ created: false, emailSent: false });
    expect(calls.some((c) => c.path.includes('execute-actions-email'))).toBe(false);
  });

  it('SMTP ausente não derruba o convite: emailSent=false', async () => {
    const { http } = fakeKeycloak([
      orgs,
      on('GET', /\/users$/, { status: 200, json: [{ id: 'u9', email: 'd@x.com', emailVerified: false }] }),
      on('POST', /\/organizations\/kc-org\/members$/, { status: 201 }),
      on('PUT', /execute-actions-email$/, { status: 500, text: 'Failed to send execute actions email' }),
    ]);
    expect(await new KeycloakDirectory(config(), http).invite(ORG, { email: 'd@x.com' })).toMatchObject({ emailSent: false });
  });

  it('organização ausente e realm sem Organizations viram erros de diretório claros', async () => {
    const none = fakeKeycloak([on('GET', /\/organizations$/, { status: 200, json: [] })]);
    await expect(new KeycloakDirectory(config(), none.http).listMembers(ORG)).rejects.toMatchObject({ code: 'org_not_found' });
    const off = fakeKeycloak([on('GET', /\/organizations$/, { status: 400, text: '{"errorMessage":"Organizations not enabled for this realm."}' })]);
    const err = await new KeycloakDirectory(config(), off.http).listMembers(ORG).catch((e) => e);
    expect(err).toBeInstanceOf(DirectoryError);
    expect(err.code).toBe('directory_misconfigured');
  });

  it('sem permissão no Keycloak: directory_misconfigured', async () => {
    const { http } = fakeKeycloak([on('GET', /\/organizations$/, { status: 403 })]);
    await expect(new KeycloakDirectory(config(), http).listMembers(ORG)).rejects.toMatchObject({ code: 'directory_misconfigured' });
  });
});

describe('KeycloakDirectory (realm)', () => {
  it('lista os usuários do realm sem o service account e remove desabilitando', async () => {
    const { http, calls } = fakeKeycloak([
      on('GET', /\/users$/, { status: 200, json: [{ id: 'u1', email: 'a@x.com' }, { id: 'sa', username: 'service-account-fixer-access' }] }),
      on('PUT', /\/users\/u1$/, { status: 204 }),
    ]);
    const dir = new KeycloakDirectory(config('realm'), http);
    expect((await dir.listMembers(ORG)).map((m) => m.id)).toEqual(['u1']);
    await dir.removeMember(ORG, 'u1');
    expect(calls.at(-1)).toMatchObject({ method: 'PUT', path: '/users/u1', body: '{"enabled":false}' });
  });

  it('convidar de novo quem foi removido reabilita a conta', async () => {
    const { http, calls } = fakeKeycloak([
      on('GET', /\/users$/, { status: 200, json: [{ id: 'u1', email: 'a@x.com', enabled: false, emailVerified: true }] }),
      on('PUT', /\/users\/u1$/, { status: 204 }),
    ]);
    const res = await new KeycloakDirectory(config('realm'), http).invite(ORG, { email: 'a@x.com' });
    expect(res.member.enabled).toBe(true);
    expect(calls.some((c) => c.method === 'PUT' && c.body === '{"enabled":true}')).toBe(true);
    expect(calls.some((c) => c.path.includes('/organizations'))).toBe(false);
  });
});
