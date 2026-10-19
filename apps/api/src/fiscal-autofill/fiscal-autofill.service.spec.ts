import { TEST_ORG } from '../../test/setup.js';
import { HttpException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { decide, FiscalAutofillService } from './fiscal-autofill.service.js';

const CNPJ = '11222333000181';
const SAME_ROOT = '11222333000262';
const OTHER = '00000000000191';
const actor = { id: 'u1', ip: '127.0.0.1' };

type Row = Record<string, unknown>;

/** Prisma em memória com o que o serviço usa (singleton por tenant, como no banco). */
function fakeDb(init: { settings?: Row | null; provenance?: Row[]; profile?: Row | null } = {}) {
  const state = {
    settings: init.settings === undefined ? null : init.settings,
    provenance: new Map((init.provenance ?? []).map((p) => [p.field as string, { orgId: TEST_ORG, ...p }])),
    profile: init.profile === undefined ? null : init.profile,
    audit: [] as Row[],
  };
  const db = {
    tenantFiscalSettings: {
      findUnique: vi.fn(async () => (state.settings ? { ...state.settings } : null)),
      update: vi.fn(async ({ data }: { data: Row }) => (state.settings = { ...state.settings, ...data })),
    },
    fiscalFieldProvenance: {
      findMany: vi.fn(async () => [...state.provenance.values()]),
      upsert: vi.fn(async ({ where, create, update }: { where: { orgId_field: { field: string } }; create: Row; update: Row }) => {
        const k = where.orgId_field.field;
        const row = state.provenance.has(k) ? { ...state.provenance.get(k), ...update } : create;
        state.provenance.set(k, row as never);
        return row;
      }),
      deleteMany: vi.fn(async ({ where }: { where: { field: { in: string[] } } }) => {
        for (const f of where.field.in) state.provenance.delete(f);
      }),
    },
    tenantTaxProfile: {
      findFirst: vi.fn(async () => (state.profile ? { orgId: TEST_ORG, ...state.profile } : null)),
      update: vi.fn(async ({ data }: { data: Row }) => (state.profile = { ...state.profile, ...data })),
      updateMany: vi.fn(async ({ data }: { data: Row }) => {
        if (state.profile) state.profile = { ...state.profile, ...data };
      }),
      create: vi.fn(async ({ data }: { data: Row }) => (state.profile = { ...data })),
    },
    fiscalAuditLog: { create: vi.fn(async ({ data }: { data: Row }) => state.audit.push(data)) },
    $transaction: vi.fn(async (fn: (tx: unknown) => unknown) => fn(db)),
  };
  return { db, state };
}

const lookupResult = (over: { simples?: boolean | null; cnae?: string | null; uf?: string; ibge?: string | null; secondary?: string[] } = {}) => ({
  cnpj: CNPJ,
  razao_social: 'OFICINA DO ZE LTDA',
  endereco: { uf: over.uf ?? 'PE' },
  cnae_principal: over.cnae === null ? null : { codigo: over.cnae ?? '45.20-0-01', descricao: 'Serviços de manutenção e reparação mecânica de veículos automotores' },
  telefones: [],
  emails: [],
  inscricoes_estaduais: [],
  fiscal: { municipalityIbge: over.ibge === undefined ? '2611606' : over.ibge, simples: over.simples === undefined ? true : over.simples, secondaryCnaes: over.secondary ?? [] },
});

function make(init: Parameters<typeof fakeDb>[0] = {}, lookup: unknown = lookupResult()) {
  const { db, state } = fakeDb(init);
  const cnpjLookup = { lookup: vi.fn(async () => (lookup instanceof Error ? Promise.reject(lookup) : lookup)) };
  // O CredentialService real grava cnpj/razão social/UF; aqui o fake faz o mesmo no estado.
  const credentials = {
    updateSettings: vi.fn(async (input: Row) => {
      state.settings = { orgId: TEST_ORG, cnae: null, lc116Item: null, municipalityIbge: null, taxRegime: null, issRate: null, municipalServiceCode: null, ufCode: null, ...state.settings, ...input };
      return input;
    }),
  };
  const service = new FiscalAutofillService(db as never, cnpjLookup as never, credentials as never);
  return { service, state, db, cnpjLookup, credentials };
}

const field = (r: Awaited<ReturnType<FiscalAutofillService['run']>>, f: string) => r.fields.find((x) => x.field === f);

describe('FiscalAutofillService.run', () => {
  it('oficina nova do Simples: empresa, município, regime, CNAE e serviço 14.01, com a origem de cada um', async () => {
    const { service, state, credentials } = make();
    const r = await service.run({ cnpj: '11.222.333/0001-81' }, actor);

    expect(credentials.updateSettings).toHaveBeenCalledWith({ cnpj: CNPJ, legalName: 'OFICINA DO ZE LTDA', ufCode: 26 }, actor);
    expect(state.settings).toMatchObject({ municipalityIbge: '2611606', taxRegime: 'SIMPLES', cnae: '4520001', lc116Item: '14.01' });
    expect(r).toMatchObject({ cnpj: CNPJ, reset: 'NENHUM', needsRegime: false, simplesOptant: true });
    expect(field(r, 'lc116Item')).toMatchObject({ outcome: 'PREENCHIDO', source: 'TAX_RULES_DEFAULT', confidence: 'INFERIDO' });
    expect(state.provenance.get('taxRegime')).toMatchObject({ source: 'CNPJ_LOOKUP', confidence: 'OFICIAL' });
    expect(state.provenance.get('simplesOptant')).toMatchObject({ evidence: { optant: true } });
    expect(r.steps.map((s) => `${s.step}:${s.status}`)).toEqual(['CNPJ_LOOKUP:OK', 'SERVICO:OK', 'ICMS_VENDA:PULADO']);
    expect(state.audit[0]).toMatchObject({ action: 'autofill.run', userId: 'u1' });
  });

  it('não optante do Simples: regime fica vazio e a tela pergunta (pergunta guiada)', async () => {
    const { service, state } = make({}, lookupResult({ simples: false }));
    const r = await service.run({ cnpj: CNPJ }, actor);
    expect(state.settings!.taxRegime).toBeNull();
    expect(r).toMatchObject({ needsRegime: true, simplesOptant: false });
    expect(field(r, 'taxRegime')).toMatchObject({ outcome: 'SEM_DADO' });
  });

  it('Presumido com ICMS da venda vazio: usa a alíquota interna de PE, estimada, e derruba a validação do contador', async () => {
    const settings = { orgId: TEST_ORG, cnpj: CNPJ, ufCode: 26, taxRegime: 'PRESUMIDO', municipalityIbge: '2611606', cnae: '4520001', lc116Item: '14.01' };
    const { service, state } = make({ settings, provenance: [{ field: 'taxRegime', source: 'MANUAL' }], profile: { icmsSalePct: null, reviewedBy: 'Contador', reviewedAt: new Date() } }, lookupResult({ simples: false }));
    const r = await service.run({}, actor);
    expect(state.profile).toMatchObject({ icmsSalePct: '20.5', reviewedBy: null, reviewedAt: null });
    expect(field(r, 'icmsSalePct')).toMatchObject({ outcome: 'PREENCHIDO', value: '20.5', confidence: 'ESTIMADO' });
    expect(state.settings!.taxRegime).toBe('PRESUMIDO');
  });

  it('Presumido fora de PE: sem alíquota da UF, não inventa', async () => {
    const settings = { orgId: TEST_ORG, cnpj: CNPJ, ufCode: 35, taxRegime: 'PRESUMIDO' };
    const { service, state } = make({ settings, provenance: [{ field: 'taxRegime', source: 'MANUAL' }] }, lookupResult({ simples: false, uf: 'SP' }));
    const r = await service.run({}, actor);
    expect(state.profile).toBeNull();
    expect(r.steps.find((s) => s.step === 'ICMS_VENDA')).toMatchObject({ status: 'SEM_DADO' });
  });

  it('valor digitado diferente da fonte vira CONFLITO e fica como está (R1)', async () => {
    const settings = { orgId: TEST_ORG, cnpj: CNPJ, municipalityIbge: '2607901', taxRegime: null, cnae: null, lc116Item: null };
    const { service, state } = make({ settings, provenance: [{ field: 'municipalityIbge', source: 'MANUAL' }] });
    const r = await service.run({}, actor);
    expect(field(r, 'municipalityIbge')).toMatchObject({ outcome: 'CONFLITO', value: '2611606', previous: '2607901' });
    expect(state.settings!.municipalityIbge).toBe('2607901');
    expect(state.provenance.get('municipalityIbge')).toMatchObject({ source: 'MANUAL' });
  });

  it('valor automático anterior é atualizado quando a fonte muda', async () => {
    const settings = { orgId: TEST_ORG, cnpj: CNPJ, municipalityIbge: '2607901' };
    const { service, state } = make({ settings, provenance: [{ field: 'municipalityIbge', source: 'CNPJ_LOOKUP' }] });
    const r = await service.run({}, actor);
    expect(field(r, 'municipalityIbge')).toMatchObject({ outcome: 'PREENCHIDO', previous: '2607901' });
    expect(state.settings!.municipalityIbge).toBe('2611606');
  });

  it('saiu do Simples: regime automático é limpo; regime digitado vira aviso', async () => {
    const auto = make({ settings: { orgId: TEST_ORG, cnpj: CNPJ, taxRegime: 'SIMPLES' }, provenance: [{ field: 'taxRegime', source: 'CNPJ_LOOKUP' }] }, lookupResult({ simples: false }));
    const r1 = await auto.service.run({}, actor);
    expect(field(r1, 'taxRegime')).toMatchObject({ outcome: 'LIMPO', previous: 'SIMPLES' });
    expect(auto.state.settings!.taxRegime).toBeNull();
    expect(r1.needsRegime).toBe(true);

    const manual = make({ settings: { orgId: TEST_ORG, cnpj: CNPJ, taxRegime: 'SIMPLES' }, provenance: [{ field: 'taxRegime', source: 'MANUAL' }] }, lookupResult({ simples: false }));
    const r2 = await manual.service.run({}, actor);
    expect(field(r2, 'taxRegime')).toMatchObject({ outcome: 'CONFLITO' });
    expect(manual.state.settings!.taxRegime).toBe('SIMPLES');
  });

  it('CNAE sem serviço na tabela (comércio de peças): usa 14.01 como estimado', async () => {
    const { service } = make({}, lookupResult({ cnae: '4530703' }));
    const r = await service.run({ cnpj: CNPJ }, actor);
    expect(field(r, 'lc116Item')).toMatchObject({ outcome: 'PREENCHIDO', value: '14.01', confidence: 'ESTIMADO' });
    expect(r.steps.find((s) => s.step === 'SERVICO')).toMatchObject({ status: 'SEM_DADO' });
  });

  it('autopeças com oficina nas secundárias: serviço inferido da CNAE secundária', async () => {
    const { service, state } = make({}, lookupResult({ cnae: '4530703', secondary: ['4511101', '4520001', '4520002'] }));
    const r = await service.run({ cnpj: CNPJ }, actor);
    expect(field(r, 'lc116Item')).toMatchObject({ outcome: 'PREENCHIDO', value: '14.01', confidence: 'INFERIDO' });
    expect((state.provenance.get('lc116Item') as { reference?: string } | undefined)?.reference).toMatch(/^CNAE secundária 4520001/);
    expect(state.settings!.cnae).toBe('4530703');
  });

  it('consulta de CNPJ fora do ar: grava só o CNPJ e segue', async () => {
    const { service, state, credentials } = make({}, new HttpException('Serviço de consulta de CNPJ indisponível.', 502));
    const r = await service.run({ cnpj: CNPJ }, actor);
    expect(credentials.updateSettings).toHaveBeenCalledWith({ cnpj: CNPJ }, actor);
    expect(r.steps.map((s) => s.status)).toEqual(['FALHOU', 'PULADO', 'PULADO']);
    expect(state.settings!.taxRegime).toBeNull();
    expect(r.needsRegime).toBe(true);
  });

  it('certificado de outra empresa (outra raiz): zera município, ISS, regime e perfil de imposto', async () => {
    const settings = { orgId: TEST_ORG, cnpj: OTHER, municipalityIbge: '5300108', issRate: '5', municipalServiceCode: 'X1', taxRegime: 'REAL', cnae: '1', lc116Item: '1.01' };
    const { service, state, db } = make({ settings, provenance: [{ field: 'taxRegime', source: 'MANUAL' }], profile: { rbt12: '900000', reviewedBy: 'C' } });
    const r = await service.run({ cnpj: CNPJ }, actor);
    expect(r.reset).toBe('EMPRESA');
    expect(db.tenantTaxProfile.updateMany).toHaveBeenCalled();
    expect(state.profile).toMatchObject({ rbt12: null, reviewedBy: null });
    // Depois do reset, o valor manual antigo não bloqueia: o regime novo vem da consulta.
    expect(state.settings).toMatchObject({ taxRegime: 'SIMPLES', issRate: null, municipalServiceCode: null, municipalityIbge: '2611606' });
  });

  it('outro estabelecimento da mesma raiz: zera só o que é do local e mantém o regime', async () => {
    const settings = { orgId: TEST_ORG, cnpj: SAME_ROOT, municipalityIbge: '5300108', issRate: '5', taxRegime: 'PRESUMIDO' };
    const { service, state, db } = make({ settings, provenance: [{ field: 'taxRegime', source: 'MANUAL' }] }, lookupResult({ simples: false }));
    const r = await service.run({ cnpj: CNPJ }, actor);
    expect(r.reset).toBe('MUNICIPIO');
    expect(db.tenantTaxProfile.updateMany).not.toHaveBeenCalled();
    expect(state.settings).toMatchObject({ taxRegime: 'PRESUMIDO', issRate: null, municipalityIbge: '2611606' });
  });

  it('sem CNPJ salvo nem informado: erro claro', async () => {
    await expect(make().service.run({}, actor)).rejects.toThrow(/certificado ou cadastre o CNPJ/);
    await expect(make().service.run({ cnpj: '123' }, actor)).rejects.toThrow(/CNPJ inválido/);
  });
});

describe('FiscalAutofillService.provenance', () => {
  it('lista as origens e separa o fato "optante do Simples"', async () => {
    const { service } = make({ provenance: [{ field: 'taxRegime', source: 'CNPJ_LOOKUP', confidence: 'OFICIAL' }, { field: 'simplesOptant', source: 'CNPJ_LOOKUP', confidence: 'OFICIAL', evidence: { optant: false } }] });
    const r = await service.provenance();
    expect(r.simplesOptant).toBe(false);
    expect(r.fields.map((f) => f.field)).toEqual(['taxRegime']);
  });
});

describe('decide (R1)', () => {
  it('cobre vazio, igual, automático e manual', () => {
    expect(decide('issRate', null, null, undefined).outcome).toBe('SEM_DADO');
    expect(decide('issRate', '2.50', '2.5', undefined).outcome).toBe('IGUAL');
    expect(decide('issRate', null, '2', { source: 'MANUAL' }).outcome).toBe('PREENCHIDO');
    expect(decide('issRate', '3', '2', { source: 'NFSE_PARAMETROS' }).outcome).toBe('PREENCHIDO');
    expect(decide('issRate', '3', '2', { source: 'MANUAL' }).outcome).toBe('CONFLITO');
    // Valor anterior à proveniência: não se sabe de onde veio, então é tratado como digitado.
    expect(decide('issRate', '3', '2', undefined).outcome).toBe('CONFLITO');
  });
});
