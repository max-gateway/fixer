import { describe, expect, it, vi } from 'vitest';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { FiscalSettingsService } from './fiscal-settings.service.js';
import { PartFiscalSchema, UpdateSettingsSchema } from './schema.js';

const goodPart = {
  id: 'p1',
  name: 'Kit embreagem',
  ncm: '87089300',
  cest: '0107500',
  originCode: 0,
  unit: 'UN',
  defaultCfop: '5102',
  csosn: '102',
  cst: null,
  fiscalVerified: false,
};

function setup(over: { part?: object | null; settings?: object | null; order?: object | null; profile?: object | null } = {}) {
  const prisma = {
    part: {
      findUnique: vi.fn().mockResolvedValue(over.part === undefined ? goodPart : over.part),
      update: vi.fn().mockImplementation(async ({ data }: { data: object }) => ({ ...goodPart, ...data })),
    },
    tenantFiscalSettings: {
      findUnique: vi.fn().mockResolvedValue(over.settings === undefined ? { taxRegime: 'SIMPLES' } : over.settings),
      upsert: vi.fn().mockImplementation(async ({ update }: { update: object }) => ({ id: 1, ...update })),
    },
    serviceFiscalProfile: {
      findUnique: vi.fn().mockResolvedValue(over.profile === undefined ? { id: 'sf1', lc116Item: '14.01', nbs: '1.2001.31.00', verified: false } : over.profile),
      update: vi.fn().mockImplementation(async ({ data }: { data: object }) => ({ id: 'sf1', ...data })),
    },
    serviceOrder: { findUnique: vi.fn().mockResolvedValue(over.order === undefined ? null : over.order) },
  };
  return { prisma, service: new FiscalSettingsService(prisma as never) };
}

describe('schemas', () => {
  it('UpdateSettingsSchema valida IBGE, alíquota e regime', () => {
    expect(UpdateSettingsSchema.safeParse({ municipalityIbge: '3550308', taxRegime: 'SIMPLES', issRate: 2.5 }).success).toBe(true);
    expect(UpdateSettingsSchema.safeParse({ municipalityIbge: '123' }).success).toBe(false);
    expect(UpdateSettingsSchema.safeParse({ issRate: 9 }).success).toBe(false);
    expect(UpdateSettingsSchema.safeParse({ taxRegime: 'MEI' }).success).toBe(false);
  });

  it('PartFiscalSchema normaliza pontuação de NCM e CEST (8708.93.00 → 87089300)', () => {
    const r = PartFiscalSchema.parse({ ncm: '8708.93.00', cest: '01.075.00', defaultCfop: '5.102' });
    expect(r).toMatchObject({ ncm: '87089300', cest: '0107500', defaultCfop: '5102' });
  });
});

describe('FiscalSettingsService.updateSettings', () => {
  it('grava só os campos informados e nunca toca em cnpj/legalName/ufCode (do fluxo de credenciais)', async () => {
    const { prisma, service } = setup();
    await service.updateSettings({ taxRegime: 'SIMPLES', issRate: 2.5 });
    const call = prisma.tenantFiscalSettings.upsert.mock.calls[0][0];
    expect(call.where).toEqual({ id: 1 });
    expect(call.update).toEqual({ taxRegime: 'SIMPLES', issRate: 2.5 });
    expect(Object.keys(call.create)).not.toContain('cnpj');
    expect(Object.keys(call.update)).not.toContain('cnpj');
  });
});

describe('FiscalSettingsService.updatePartFiscal', () => {
  it('alterar um dado fiscal derruba a confirmação do contador', async () => {
    const { prisma, service } = setup({ part: { ...goodPart, fiscalVerified: true } });
    await service.updatePartFiscal('p1', { ncm: '87089400' });
    expect(prisma.part.update).toHaveBeenCalledWith({ where: { id: 'p1' }, data: { ncm: '87089400', fiscalVerified: false } });
  });

  it('reenviar o mesmo valor não derruba a confirmação', async () => {
    const { prisma, service } = setup({ part: { ...goodPart, fiscalVerified: true } });
    await service.updatePartFiscal('p1', { ncm: '87089300' });
    expect(prisma.part.update.mock.calls[0][0].data).toEqual({ ncm: '87089300' });
  });

  it('peça inexistente: 404', async () => {
    const { service } = setup({ part: null });
    await expect(service.updatePartFiscal('x', { ncm: '87089300' })).rejects.toThrow(NotFoundException);
  });
});

describe('FiscalSettingsService.verifyPart', () => {
  it('confirma uma peça completa', async () => {
    const { prisma, service } = setup();
    await service.verifyPart('p1', true);
    expect(prisma.part.update).toHaveBeenCalledWith({ where: { id: 'p1' }, data: { fiscalVerified: true } });
  });

  it('recusa confirmar peça com dados faltando, listando o que falta', async () => {
    const { service, prisma } = setup({ part: { ...goodPart, ncm: null, csosn: null } });
    await expect(service.verifyPart('p1', true)).rejects.toThrow(BadRequestException);
    await expect(service.verifyPart('p1', true)).rejects.toThrow(/NCM/);
    expect(prisma.part.update).not.toHaveBeenCalled();
  });

  it('recusa confirmar sem regime tributário configurado', async () => {
    const { service } = setup({ settings: null });
    await expect(service.verifyPart('p1', true)).rejects.toThrow(/regime/i);
  });

  it('desconfirmar é sempre permitido', async () => {
    const { prisma, service } = setup({ part: { ...goodPart, ncm: null, fiscalVerified: true } });
    await service.verifyPart('p1', false);
    expect(prisma.part.update).toHaveBeenCalledWith({ where: { id: 'p1' }, data: { fiscalVerified: false } });
  });
});

describe('FiscalSettingsService.verifyServiceProfile', () => {
  it('confirma um perfil com item LC 116 e NBS válidos', async () => {
    const { prisma, service } = setup();
    await service.verifyServiceProfile('sf1', true);
    expect(prisma.serviceFiscalProfile.update).toHaveBeenCalledWith({ where: { id: 'sf1' }, data: { verified: true } });
  });

  it('recusa perfil sem NBS', async () => {
    const { service } = setup({ profile: { id: 'sf1', lc116Item: '14.01', nbs: null, verified: false } });
    await expect(service.verifyServiceProfile('sf1', true)).rejects.toThrow(BadRequestException);
  });
});

describe('FiscalSettingsService.orderReadiness', () => {
  const order = (over: object = {}) => ({
    id: 'o1',
    partLines: [{ partName: 'Kit embreagem', part: { ...goodPart, fiscalVerified: true } }],
    serviceLines: [
      {
        serviceName: 'Troca de embreagem',
        service: { fiscalProfile: null, definition: { fiscalProfile: { lc116Item: '14.01', nbs: '1.2001.31.00', verified: true } } },
      },
    ],
    ...over,
  });
  const fullSettings = { taxRegime: 'SIMPLES', municipalityIbge: '3550308', issRate: 2.5, municipalServiceCode: '14.01', hourlyRate: null };

  it('OS com peças e serviços completos está pronta para emitir NF-e e NFS-e', async () => {
    const { service } = setup({ order: order(), settings: fullSettings });
    expect(await service.orderReadiness('o1')).toEqual({
      ready: true,
      nfe: { required: true, ready: true, items: [] },
      nfse: { required: true, ready: true, settingsIssues: [], items: [] },
    });
  });

  it('lista por item o que falta e marca como não pronta', async () => {
    const { service } = setup({
      order: order({ partLines: [{ partName: 'Disco', part: { ...goodPart, ncm: null, fiscalVerified: false } }] }),
      settings: { ...fullSettings, municipalityIbge: null },
    });
    const r = await service.orderReadiness('o1');
    expect(r.ready).toBe(false);
    expect(r.nfe.items[0]).toMatchObject({ name: 'Disco' });
    expect(r.nfe.items[0].issues.map((i) => i.field)).toEqual(expect.arrayContaining(['ncm', 'fiscalVerified']));
    expect(r.nfse.settingsIssues.map((i) => i.field)).toEqual(['municipalityIbge']);
  });

  it('o perfil do próprio serviço prevalece sobre o da definição', async () => {
    const own = { lc116Item: '14.01', nbs: null, verified: true };
    const { service } = setup({
      order: order({
        serviceLines: [{ serviceName: 'X', service: { fiscalProfile: own, definition: { fiscalProfile: { lc116Item: '14.01', nbs: '1.2001.31.00', verified: true } } } }],
      }),
      settings: fullSettings,
    });
    const r = await service.orderReadiness('o1');
    expect(r.nfse.items[0].issues.map((i) => i.field)).toEqual(['nbs']);
  });

  it('serviço avulso sem perfil fiscal aparece como pendente', async () => {
    const { service } = setup({
      order: order({ serviceLines: [{ serviceName: 'Taxa', service: { fiscalProfile: null, definition: null } }] }),
      settings: fullSettings,
    });
    expect((await service.orderReadiness('o1')).nfse.items[0].issues[0].field).toBe('fiscalProfile');
  });

  it('OS só com serviços não exige NF-e (e vice-versa)', async () => {
    const { service } = setup({ order: order({ partLines: [] }), settings: fullSettings });
    const r = await service.orderReadiness('o1');
    expect(r.nfe).toEqual({ required: false, ready: true, items: [] });
    expect(r.ready).toBe(true);
  });

  it('OS inexistente: 404', async () => {
    const { service } = setup({ order: null });
    await expect(service.orderReadiness('x')).rejects.toThrow(NotFoundException);
  });
});
