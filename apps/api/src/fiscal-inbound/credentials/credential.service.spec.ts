import { TEST_ORG } from '../../../test/setup.js';
import { randomBytes } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { makePfx } from '../../../test/fiscal/make-pfx.js';
import { EnvKeyProvider } from '../crypto/key-provider.js';
import { CredentialService, FlagsSchema, SettingsSchema, UploadCredentialSchema } from './credential.service.js';

const actor = { id: 'u1', ip: '10.0.0.1' };
const TENANT_CNPJ = '12ABC34501DE35';

const keys = () =>
  EnvKeyProvider.fromEnv({
    FISCAL_ENC_KEYS: JSON.stringify({ k1: randomBytes(32).toString('base64') }),
    FISCAL_ACTIVE_KEY_ID: 'k1',
  });

/** Prisma em memória só com o que o serviço usa; guarda a credencial e o estado para inspeção. */
function setup(opts: { settings?: { cnpj: string | null } | null; keyProvider?: ReturnType<typeof keys> } = {}) {
  const db: { credential: Record<string, any> | null; settings: any; syncUpserts: any[]; audits: any[]; wiped: string[] } = {
    credential: null,
    settings: opts.settings === undefined ? { cnpj: TENANT_CNPJ, legalName: 'OFICINA', ufCode: 35 } : opts.settings,
    syncUpserts: [],
    audits: [],
    wiped: [],
  };
  const deleteCredential = vi.fn(async () => {
    const count = db.credential ? 1 : 0;
    db.credential = null;
    return { count };
  });
  const wipe = (model: string) => ({ deleteMany: vi.fn(async () => void db.wiped.push(model)) });
  const tx = {
    fiscalCredential: {
      upsert: vi.fn(async ({ create }: any) => {
        db.credential = { ...db.credential, ...create };
        return db.credential;
      }),
      deleteMany: deleteCredential,
    },
    fiscalSyncState: { upsert: vi.fn(async (args: any) => db.syncUpserts.push(args)) },
    pricingRule: wipe('pricingRule'),
    tenantTaxProfile: wipe('tenantTaxProfile'),
    taxTableReview: wipe('taxTableReview'),
    fiscalFieldProvenance: wipe('fiscalFieldProvenance'),
    tenantFiscalSettings: wipe('tenantFiscalSettings'),
  };
  const prisma = {
    $transaction: (fn: (t: typeof tx) => unknown) => fn(tx),
    tenantFiscalSettings: {
      findUnique: vi.fn(async () => db.settings),
      upsert: vi.fn(async ({ create }: any) => (db.settings = create)),
    },
    fiscalCredential: {
      findUnique: vi.fn(async () => db.credential),
      count: vi.fn(async () => (db.credential ? 1 : 0)),
      update: vi.fn(async ({ data }: any) => Object.assign(db.credential!, data)),
      deleteMany: deleteCredential,
    },
    fiscalAuditLog: { create: vi.fn(async ({ data }: any) => db.audits.push(data)) },
  };
  const service = new CredentialService(prisma as never, opts.keyProvider ?? keys());
  return { service, db, prisma, tx };
}

const upload = (service: CredentialService, pfx: Buffer, password: string, environment: 'PRODUCTION' | 'HOMOLOGATION' = 'PRODUCTION') =>
  service.upload(UploadCredentialSchema.parse({ pfxBase64: pfx.toString('base64'), password, environment }), actor);

describe('CredentialService.upload', () => {
  it('grava só ciphertext e registra auditoria sem segredo', async () => {
    const { pfx, password } = makePfx({ cnpj: TENANT_CNPJ });
    const { service, db } = setup();
    const result = await upload(service, pfx, password);

    expect(result).toMatchObject({ certCnpj: TENANT_CNPJ, subject: expect.stringContaining('OFICINA TESTE') });
    const stored = db.credential!;
    expect(stored.keyId).toBe('k1');
    expect(stored.pfxCiphertext.includes(pfx)).toBe(false);
    expect(stored.pfxPassCiphertext.includes(Buffer.from(password))).toBe(false);
    expect(JSON.stringify(db.audits)).not.toContain(password);
    expect(JSON.stringify(db.audits)).not.toContain(pfx.toString('base64').slice(0, 40));
    expect(db.audits[0]).toMatchObject({ action: 'credential.upload', userId: 'u1', ip: '10.0.0.1' });
    expect(JSON.stringify(result)).not.toContain(password);
  });

  it('renovar o certificado não zera o NSU: o estado só é criado, nunca sobrescrito', async () => {
    const { pfx, password } = makePfx({ cnpj: TENANT_CNPJ });
    const { service, db } = setup();
    await upload(service, pfx, password);
    expect(db.syncUpserts[0]).toMatchObject({ where: { orgId: TEST_ORG }, create: { orgId: TEST_ORG }, update: {} });
  });

  it('o que foi gravado volta intacto por openMaterial (ida e volta completa)', async () => {
    const { pfx, password } = makePfx({ cnpj: TENANT_CNPJ });
    const { service } = setup();
    await upload(service, pfx, password, 'HOMOLOGATION');
    const material = await service.openMaterial();
    expect(material).toMatchObject({ certCnpj: TENANT_CNPJ, environment: 'HOMOLOGATION' });
    expect(material.keyPem).toContain('PRIVATE KEY');
  });

  it('aceita certificado de outro estabelecimento da mesma raiz (matriz → filial)', async () => {
    const { pfx, password } = makePfx({ cnpj: '11222333000181' });
    const { service } = setup({ settings: { cnpj: '11222333000262' } });
    await expect(upload(service, pfx, password)).resolves.toMatchObject({ certCnpj: '11222333000181' });
  });

  it.each([
    ['chave de criptografia ausente', () => setup({ keyProvider: EnvKeyProvider.fromEnv({}) as never }), /não configurada/, 503],
    ['CNPJ da empresa não cadastrado', () => setup({ settings: null }), /Cadastre o CNPJ/, 400],
    ['CNPJ da empresa sem valor', () => setup({ settings: { cnpj: null } }), /Cadastre o CNPJ/, 400],
  ])('recusa: %s', async (_name, build, message, status) => {
    const { pfx, password } = makePfx({ cnpj: TENANT_CNPJ });
    const { service, db } = build();
    await expect(upload(service, pfx, password)).rejects.toMatchObject({ message: expect.stringMatching(message), status });
    expect(db.credential).toBeNull();
  });

  it('recusa raiz de CNPJ diferente da empresa', async () => {
    const { pfx, password } = makePfx({ cnpj: '11222333000181' });
    const { service, db } = setup();
    await expect(upload(service, pfx, password)).rejects.toThrow(/mesma raiz/);
    expect(db.credential).toBeNull();
  });

  it('recusa vencido, perto de vencer e ainda não válido', async () => {
    const day = 86_400_000;
    const { service } = setup();
    const cases: [Date, Date, RegExp][] = [
      [new Date(Date.now() - 400 * day), new Date(Date.now() - day), /vencido/],
      [new Date(Date.now() - day), new Date(Date.now() + 3 * day), /menos de 7 dias/],
      [new Date(Date.now() + day), new Date(Date.now() + 400 * day), /ainda não é válido/],
    ];
    for (const [notBefore, notAfter, message] of cases) {
      const { pfx, password } = makePfx({ cnpj: TENANT_CNPJ, notBefore, notAfter });
      await expect(upload(service, pfx, password)).rejects.toThrow(message);
    }
  });

  it('senha errada e arquivo inválido viram 400 sem vazar a senha', async () => {
    const { pfx } = makePfx({ cnpj: TENANT_CNPJ });
    const { service } = setup();
    const err = await upload(service, pfx, 'minha-senha-errada').catch((e) => e);
    expect(err.status).toBe(400);
    expect(err.message).toMatch(/Senha/);
    expect(err.message).not.toContain('minha-senha-errada');
    await expect(upload(service, Buffer.from('lixo'), 'x')).rejects.toThrow(/\.pfx/);
  });

  it('recusa certificado sem extensão de CNPJ (não é e-CNPJ)', async () => {
    const { pfx, password } = makePfx();
    const { service } = setup();
    await expect(upload(service, pfx, password)).rejects.toThrow(/e-CNPJ/);
  });

  it('recusa arquivo vazio ou grande demais', async () => {
    const { service } = setup();
    expect(() => UploadCredentialSchema.parse({ pfxBase64: '', password: 'x' })).toThrow(/base64/);
    // Texto que não decodifica para nenhum byte chega ao serviço como arquivo vazio.
    await expect(service.upload({ pfxBase64: '!!!', password: 'x', environment: 'PRODUCTION' }, actor)).rejects.toThrow(/inválido/);
    await expect(upload(service, Buffer.alloc(300 * 1024), 'x')).rejects.toThrow(/grande demais/);
  });
});

describe('CredentialService.status', () => {
  it('nunca expõe ciphertext, chave ou senha', async () => {
    const { pfx, password } = makePfx({ cnpj: TENANT_CNPJ });
    const { service, prisma } = setup();
    await upload(service, pfx, password);
    await service.status();
    const select = (prisma.fiscalCredential.findUnique.mock.calls.at(-1) as unknown as [{ select: object }])[0].select;
    expect(Object.keys(select)).not.toEqual(expect.arrayContaining(['pfxCiphertext']));
    expect(Object.keys(select)).not.toContain('pfxPassCiphertext');
    expect(Object.keys(select)).not.toContain('keyId');
  });

  it('serializa BigInt do NSU como string (JSON não aceita BigInt)', async () => {
    const { service, db } = setup();
    db.credential = { syncState: { lastNsu: 123456789012345n, maxNsu: 5n, nextPollAt: new Date() }, enabled: true };
    const s = await service.status();
    expect(s.credential?.syncState).toMatchObject({ lastNsu: '123456789012345', maxNsu: '5' });
    expect(() => JSON.stringify(s)).not.toThrow();
  });
});

describe('CredentialService.updateSettings', () => {
  it('trocar a raiz do CNPJ com certificado enviado exige remover antes', async () => {
    const { service, db } = setup();
    db.credential = { id: 1 };
    await expect(service.updateSettings(SettingsSchema.parse({ cnpj: '11222333000181' }), actor)).rejects.toMatchObject({ status: 409 });
  });

  it('mesma raiz (outra filial) ou sem certificado passa', async () => {
    const { service, db } = setup();
    db.credential = { id: 1 };
    await expect(service.updateSettings(SettingsSchema.parse({ cnpj: '12.abc.345/0001-17'.replace('0001-17', '01de-35') }), actor)).resolves.toBeTruthy();
    db.credential = null;
    await expect(service.updateSettings(SettingsSchema.parse({ cnpj: '11222333000181' }), actor)).resolves.toBeTruthy();
  });

  it('valida o CNPJ e normaliza a máscara', () => {
    expect(SettingsSchema.parse({ cnpj: '11.222.333/0001-81' }).cnpj).toBe('11222333000181');
    expect(() => SettingsSchema.parse({ cnpj: '11.222.333/0001-82' })).toThrow(/CNPJ inválido/);
    expect(() => SettingsSchema.parse({ cnpj: '11222333000181', ufCode: 99 })).toThrow();
  });
});

describe('CredentialService.updateFlags / remove', () => {
  it('autoExport grava quem ligou (autor dos movimentos automáticos) e limpa ao desligar', async () => {
    const { service, db } = setup();
    db.credential = { id: 1, environment: 'PRODUCTION' };
    await service.updateFlags(FlagsSchema.parse({ autoExport: true }), actor);
    expect(db.credential).toMatchObject({ autoExport: true, autoExportById: 'u1' });
    await service.updateFlags(FlagsSchema.parse({ autoExport: false }), actor);
    expect(db.credential).toMatchObject({ autoExport: false, autoExportById: null });
  });

  it('sem certificado não há o que ligar nem remover', async () => {
    const { service } = setup();
    await expect(service.updateFlags(FlagsSchema.parse({ enabled: true }), actor)).rejects.toMatchObject({ status: 404 });
    await expect(service.remove(actor)).rejects.toMatchObject({ status: 404 });
  });

  it('remover audita e zera a configuração fiscal e de precificação', async () => {
    const { service, db } = setup();
    db.credential = { id: 1 };
    await service.remove(actor);
    expect(db.credential).toBeNull();
    expect(db.wiped.sort()).toEqual(['fiscalFieldProvenance', 'pricingRule', 'taxTableReview', 'tenantFiscalSettings', 'tenantTaxProfile']);
    expect(db.audits.at(-1)).toMatchObject({ action: 'credential.delete' });
  });

  it('sem certificado, remover não apaga configuração nenhuma', async () => {
    const { service, db } = setup();
    await expect(service.remove(actor)).rejects.toMatchObject({ status: 404 });
    expect(db.wiped).toEqual([]);
  });

  it('flags vazias são recusadas', () => {
    expect(() => FlagsSchema.parse({})).toThrow(/Nada para atualizar/);
  });

  it('ligar a ciência automática exige o aceite da obrigação de manifestação conclusiva', () => {
    expect(() => FlagsSchema.parse({ autoManifest: true })).toThrow(/acknowledgeManifestDuty/);
    expect(() => FlagsSchema.parse({ autoManifest: true, acknowledgeManifestDuty: false })).toThrow(/acknowledgeManifestDuty/);
    expect(FlagsSchema.parse({ autoManifest: true, acknowledgeManifestDuty: true })).toMatchObject({ autoManifest: true });
    // desligar não exige aceite
    expect(FlagsSchema.parse({ autoManifest: false })).toEqual({ autoManifest: false });
  });

  it('o aceite é auditado, mas não vira coluna', async () => {
    const { service, db, prisma } = setup();
    db.credential = { id: 1, environment: 'PRODUCTION' };
    await service.updateFlags(FlagsSchema.parse({ autoManifest: true, acknowledgeManifestDuty: true }), actor);
    const written = (prisma.fiscalCredential.update.mock.calls.at(-1) as unknown as [{ data: Record<string, unknown> }])[0].data;
    expect(written).toEqual({ autoManifest: true });
    expect(db.audits.at(-1)).toMatchObject({ action: 'flags.update', detail: { autoManifest: true, acknowledgeManifestDuty: true } });
  });
});
