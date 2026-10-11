import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Database } from '../src/db/database.service.js';
import { boot, CNPJ } from './harness.js';
import { makePfx } from './make-pfx.js';

type Ctx = Awaited<ReturnType<typeof boot>>;
let h: Ctx;
let a: string;
let b: string;
let db: Database;
const path = `/v1/companies/${CNPJ}/registration`;

beforeAll(async () => {
  h = await boot();
  a = (await h.makeTenant('fixer-a')).key;
  b = (await h.makeTenant('rocket', 'ROCKET')).key;
  db = h.app.get(Database);
});
afterAll(async () => h.app.close());

const cred = (over: { notAfter?: Date } = {}) => {
  const { pfx, password } = makePfx({ cnpj: CNPJ, ...over });
  return { pfxBase64: pfx.toString('base64'), password, environment: 'HOMOLOGATION' as const };
};
const version = async () => (await db.query<{ version: number }>('SELECT version FROM credentials')).rows[0]?.version;
const audits = async (action: string) => (await db.query('SELECT 1 FROM audit_log WHERE action = $1', [action])).rowCount;

describe('PUT /registration (cadastro único e idempotente)', () => {
  const same = cred();

  it('cria empresa + certificado + flags + retomada em UMA chamada', async () => {
    const r = await h.call(a, 'PUT', path, { legalName: 'OFICINA', ufCode: 26, credential: same, enabled: true, autoManifest: true, acknowledgeManifestDuty: true, resumeFromNsu: '221' });
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({
      cnpj: CNPJ,
      legalName: 'OFICINA',
      ufCode: 26,
      changed: { credential: true, resumed: true },
      credential: { enabled: true, auto_manifest: true, status: 'ACTIVE', environment: 'HOMOLOGATION' },
      sync: { last_nsu: '221' },
    });
    expect(JSON.stringify(r.body)).not.toMatch(/pfx|ciphertext|senha-de-teste/i);
    expect(await version()).toBe(1);
  });

  it('repetir a mesma chamada não muda nada (mesmo certificado, sem nova auditoria, NSU intacto)', async () => {
    const before = await audits('company.register');
    const r = await h.call(a, 'PUT', path, { legalName: 'OFICINA', credential: same, resumeFromNsu: '5' });
    expect(r.body!.changed).toEqual({ credential: false, resumed: false });
    expect(r.body!.sync.last_nsu).toBe('221'); // a retomada só vale com o NSU zerado
    expect(await version()).toBe(1);
    expect(await audits('company.register')).toBe(before);
  });

  it('sem certificado só atualiza empresa/flags e NÃO mexe no certificado (reconciliador do produto)', async () => {
    const r = await h.call(a, 'PUT', path, { legalName: 'OFICINA LTDA', autoManifest: false });
    expect(r.body).toMatchObject({ legalName: 'OFICINA LTDA', changed: { credential: false }, credential: { auto_manifest: false, enabled: true } });
    expect(await version()).toBe(1);
  });

  it('certificado renovado (outra validade) é instalado e preserva flags e NSU', async () => {
    const renewed = cred({ notAfter: new Date(Date.now() + 400 * 86_400_000) });
    const r = await h.call(a, 'PUT', path, { credential: renewed });
    expect(r.body!.changed.credential).toBe(true);
    expect(r.body).toMatchObject({ credential: { enabled: true }, sync: { last_nsu: '221' } });
    expect(await version()).toBe(2);
  });

  it('certificado removido volta a ser instalado no próximo cadastro', async () => {
    await h.call(a, 'DELETE', `/v1/companies/${CNPJ}/credential`);
    expect((await h.call(a, 'GET', `/v1/companies/${CNPJ}`)).body!.credential).toBeNull();
    const r = await h.call(a, 'PUT', path, { credential: cred({ notAfter: new Date(Date.now() + 400 * 86_400_000) }) });
    expect(r.body).toMatchObject({ changed: { credential: true }, credential: { enabled: false }, sync: { last_nsu: '221' } });
  });
});

describe('regras centralizadas', () => {
  it('ciência automática exige o aceite do dever de manifestação', async () => {
    const r = await h.call(a, 'PUT', path, { autoManifest: true });
    expect(r.status).toBe(400);
    expect(JSON.stringify(r.body)).toMatch(/acknowledgeManifestDuty/);
  });

  it('não liga a sincronização sem certificado', async () => {
    await h.call(a, 'DELETE', `/v1/companies/${CNPJ}/credential`);
    const r = await h.call(a, 'PUT', path, { enabled: true });
    expect(r.status).toBe(400);
    expect(r.body!.title).toMatch(/certificado/i);
  });

  it('certificado inválido ou de outra raiz é recusado e nada é gravado', async () => {
    const wrong = makePfx({ cnpj: '11444777000161' });
    const bad = await h.call(a, 'PUT', path, { credential: { pfxBase64: wrong.pfx.toString('base64'), password: wrong.password } });
    expect(bad.status).toBe(400);
    expect(bad.body!.title).toMatch(/mesma raiz/);
    const pass = await h.call(a, 'PUT', path, { credential: { ...cred(), password: 'errada' } });
    expect(pass.status).toBe(400);
    expect((await h.call(a, 'GET', `/v1/companies/${CNPJ}`)).body!.credential).toBeNull();
  });

  it('um dono por CNPJ: outro tenant recebe 409 e não vê nada', async () => {
    const r = await h.call(b, 'PUT', path, { credential: cred() });
    expect(r.status).toBe(409);
    expect((await h.call(b, 'GET', `/v1/companies/${CNPJ}`)).status).toBe(404);
  });

  it('exige chave de API e valida o CNPJ do caminho', async () => {
    expect((await h.call(null, 'PUT', path, {})).status).toBe(401);
    expect((await h.call(a, 'PUT', '/v1/companies/123/registration', {})).status).toBe(400);
  });
});
