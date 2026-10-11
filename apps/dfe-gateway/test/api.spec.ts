import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { makePfx } from './make-pfx.js';
import { boot, CNPJ, OTHER_CNPJ } from './harness.js';

type Ctx = Awaited<ReturnType<typeof boot>>;
let h: Ctx;
let a: string; // chave do tenant "fixer-a" (dono)
let b: string; // chave do tenant "rocket" (outro)

beforeAll(async () => {
  h = await boot();
  a = (await h.makeTenant('fixer-a')).key;
  b = (await h.makeTenant('rocket', 'ROCKET')).key;
});
afterAll(async () => h.app.close());

const pfxBody = (over: Record<string, unknown> = {}, cnpj = CNPJ) => {
  const { pfx, password } = makePfx({ cnpj });
  return { pfxBase64: pfx.toString('base64'), password, environment: 'HOMOLOGATION', ...over };
};

describe('autenticação', () => {
  it('rejeita sem chave, com chave malformada e com chave inventada', async () => {
    expect((await h.call(null, 'GET', `/v1/companies/${CNPJ}`)).status).toBe(401);
    expect((await h.call('lixo', 'GET', `/v1/companies/${CNPJ}`)).status).toBe(401);
    expect((await h.call('dfe_aaaaaaaaaaaa.' + 'x'.repeat(43), 'GET', `/v1/companies/${CNPJ}`)).status).toBe(401);
  });

  it('chave revogada e tenant suspenso deixam de valer', async () => {
    const { tenant, key } = await h.makeTenant('temp');
    expect((await h.call(key, 'PUT', `/v1/companies/${OTHER_CNPJ}`, {})).status).toBe(200);
    await h.app.get((await import('../src/db/database.service.js')).Database).query(`UPDATE tenants SET status='SUSPENDED' WHERE id=$1`, [tenant.id]);
    expect((await h.call(key, 'GET', `/v1/companies/${OTHER_CNPJ}`)).status).toBe(401);
  });

  it('devolve erro como problem+json com Request-Id', async () => {
    const r = await h.call(a, 'GET', '/v1/companies/123');
    expect(r.status).toBe(400);
    expect(r.headers.get('content-type')).toContain('application/problem+json');
    expect(r.body).toMatchObject({ status: 400, title: 'CNPJ inválido' });
  });
});

describe('um dono por CNPJ e isolamento entre tenants', () => {
  it('cria a empresa e mostra o estado', async () => {
    const r = await h.call(a, 'PUT', `/v1/companies/${CNPJ}`, { legalName: 'OFICINA A', ufCode: 26 });
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ cnpj: CNPJ, legalName: 'OFICINA A', credential: null });
    expect(r.body!.subscriptions).toEqual([expect.objectContaining({ tenant: 'fixer-a', transport: 'PULL' })]);
  });

  it('aceita o CNPJ mascarado e é idempotente para o dono', async () => {
    expect((await h.call(a, 'PUT', '/v1/companies/11.222.333%2F0001-81', {})).status).toBe(200);
  });

  it('outro tenant não consegue registrar o mesmo CNPJ (409) nem enxergá-lo (404)', async () => {
    expect((await h.call(b, 'PUT', `/v1/companies/${CNPJ}`, {})).status).toBe(409);
    const routes: [string, string, unknown?][] = [
      ['GET', ''],
      ['GET', '/documents'],
      ['GET', '/documents/' + 'A'.repeat(43) + '1'],
      ['GET', '/subscription'],
      ['PUT', '/subscription', { transport: 'PULL' }],
      ['POST', '/subscription/ack', { nsu: '0' }],
      ['POST', '/credential/inspect', { pfxBase64: 'AA==', password: 'x' }],
      ['PUT', '/credential', {}],
      ['PATCH', '/credential', { enabled: true }],
      ['DELETE', '/credential'],
      ['POST', '/sync/resume-from', { nsu: '0' }],
      ['POST', '/manifestations', { accessKeys: ['A'.repeat(43) + '1'] }],
      ['GET', '/manifestations'],
    ];
    for (const [method, path, body] of routes) {
      const r = await h.call(b, method, `/v1/companies/${CNPJ}${path}`, body);
      expect(r.status, `${method} ${path}`).toBe(404);
    }
  });
});

describe('certificado', () => {
  it('inspect lê titular e CNPJ sem gravar nada', async () => {
    const r = await h.call(a, 'POST', `/v1/companies/${CNPJ}/credential/inspect`, pfxBody());
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ certCnpj: CNPJ });
    expect((await h.call(a, 'GET', `/v1/companies/${CNPJ}`)).body!.credential).toBeNull();
  });

  it('inspect sem empresa (cadastro guiado) lê o CNPJ do certificado e exige chave de API', async () => {
    expect((await h.call(null, 'POST', '/v1/credential/inspect', pfxBody())).status).toBe(401);
    const r = await h.call(b, 'POST', '/v1/credential/inspect', pfxBody({}, OTHER_CNPJ));
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ certCnpj: OTHER_CNPJ });
  });

  it('recusa certificado de outra raiz de CNPJ, senha errada e arquivo inválido', async () => {
    expect((await h.call(a, 'PUT', `/v1/companies/${CNPJ}/credential`, pfxBody({}, OTHER_CNPJ))).body!.title).toMatch(/mesma raiz/);
    expect((await h.call(a, 'PUT', `/v1/companies/${CNPJ}/credential`, pfxBody({ password: 'errada' }))).status).toBe(400);
    expect((await h.call(a, 'PUT', `/v1/companies/${CNPJ}/credential`, { pfxBase64: Buffer.from('nope').toString('base64'), password: 'x' })).status).toBe(400);
  });

  it('recusa certificado vencido ou perto de vencer', async () => {
    const expired = makePfx({ cnpj: CNPJ, notAfter: new Date(Date.now() - 1000), notBefore: new Date(Date.now() - 86_400_000 * 5) });
    const r = await h.call(a, 'PUT', `/v1/companies/${CNPJ}/credential`, { pfxBase64: expired.pfx.toString('base64'), password: expired.password });
    expect(r.status).toBe(400);
    const soon = makePfx({ cnpj: CNPJ, notAfter: new Date(Date.now() + 86_400_000 * 2) });
    expect((await h.call(a, 'PUT', `/v1/companies/${CNPJ}/credential`, { pfxBase64: soon.pfx.toString('base64'), password: soon.password })).body!.title).toMatch(/7 dias/);
  });

  it('grava cifrado, nunca devolve o .pfx/senha e começa desligado', async () => {
    const body = pfxBody();
    const up = await h.call(a, 'PUT', `/v1/companies/${CNPJ}/credential`, body);
    expect(up.status).toBe(200);
    expect(JSON.stringify(up.body)).not.toContain(body.pfxBase64);
    expect(JSON.stringify(up.body)).not.toContain(body.password);

    const st = await h.call(a, 'GET', `/v1/companies/${CNPJ}`);
    expect(st.body!.credential).toMatchObject({ enabled: false, auto_manifest: false, environment: 'HOMOLOGATION', status: 'ACTIVE' });
    expect(JSON.stringify(st.body)).not.toMatch(/pfx|ciphertext|password/i);

    // No banco, nenhum byte do .pfx em claro.
    const { Database } = await import('../src/db/database.service.js');
    const { rows } = await h.app.get(Database).query<{ pfx_ciphertext: Buffer }>('SELECT pfx_ciphertext FROM credentials');
    expect(rows[0]!.pfx_ciphertext.includes(Buffer.from(body.pfxBase64, 'base64').subarray(0, 32))).toBe(false);
  });

  it('ciência automática exige o aceite do dever de manifestação', async () => {
    expect((await h.call(a, 'PATCH', `/v1/companies/${CNPJ}/credential`, { autoManifest: true })).status).toBe(400);
    const ok = await h.call(a, 'PATCH', `/v1/companies/${CNPJ}/credential`, { enabled: true, autoManifest: true, acknowledgeManifestDuty: true });
    expect(ok.body).toEqual({ enabled: true, autoManifest: true });
  });

  it('reenvio (renovação) preserva as flags; remover mantém o NSU', async () => {
    expect((await h.call(a, 'PUT', `/v1/companies/${CNPJ}/credential`, pfxBody())).status).toBe(200);
    expect((await h.call(a, 'GET', `/v1/companies/${CNPJ}`)).body!.credential).toMatchObject({ enabled: true, auto_manifest: true });
    expect((await h.call(a, 'POST', `/v1/companies/${CNPJ}/sync/resume-from`, { nsu: '221' })).body).toEqual({ lastNsu: '221' });
    expect((await h.call(a, 'DELETE', `/v1/companies/${CNPJ}/credential`)).status).toBe(204);
    const st = await h.call(a, 'GET', `/v1/companies/${CNPJ}`);
    expect(st.body!.credential).toBeNull();
    expect(st.body!.sync.last_nsu).toBe('221');
    expect((await h.call(a, 'DELETE', `/v1/companies/${CNPJ}/credential`)).status).toBe(404);
  });
});

describe('auditoria', () => {
  it('registra as ações e é imutável', async () => {
    const { Database } = await import('../src/db/database.service.js');
    const db = h.app.get(Database);
    const { rows } = await db.query<{ action: string }>('SELECT action FROM audit_log ORDER BY id');
    expect(rows.map((r) => r.action)).toEqual(expect.arrayContaining(['company.create', 'credential.upload', 'credential.flags', 'credential.delete', 'sync.resume_from']));
    await expect(db.query('DELETE FROM audit_log')).rejects.toThrow(/imutável/);
    await expect(db.query(`UPDATE audit_log SET action = 'x'`)).rejects.toThrow(/imutável/);
  });

  it('não grava segredo nenhum no detalhe', async () => {
    const { Database } = await import('../src/db/database.service.js');
    const { rows } = await h.app.get(Database).query<{ detail: object }>('SELECT detail FROM audit_log');
    expect(JSON.stringify(rows)).not.toMatch(/password|pfxBase64|senha-de-teste/);
  });
});
