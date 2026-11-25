import { describe, expect, it } from 'vitest';
import type { FiscalCredentialView, FiscalStatus } from '@/lib/fiscal-import';
import { firstOpen, journeySteps, progress, type JourneyInput } from './model';

const NOW = new Date('2026-10-30T12:00:00Z').getTime();
const DAY = 86_400_000;

const cred = (over: Partial<FiscalCredentialView> = {}): FiscalCredentialView => ({
  environment: 'PRODUCTION',
  subject: 'OFICINA EXEMPLO LTDA',
  certCnpj: '12345678000190',
  notBefore: new Date(NOW - 100 * DAY).toISOString(),
  notAfter: new Date(NOW + 200 * DAY).toISOString(),
  enabled: true,
  autoManifest: true,
  autoExport: true,
  updatedAt: new Date(NOW).toISOString(),
  syncState: null,
  ...over,
});

const status = (over: Partial<FiscalStatus> = {}): FiscalStatus => ({
  keyAvailable: true,
  settings: { cnpj: '12345678000190', legalName: 'OFICINA EXEMPLO LTDA', ufCode: 35 },
  credential: cred(),
  ...over,
});

const input = (over: Partial<JourneyInput> = {}): JourneyInput => ({
  status: status(),
  fiscal: { municipalityIbge: '3550308', taxRegime: 'SIMPLES', issRate: '2', municipalServiceCode: null, hourlyRate: null, lc116Item: '14.01', cnae: '4520001' },
  provenance: { fields: [], simplesOptant: true },
  tax: null,
  now: NOW,
  ...over,
});

const states = (i: JourneyInput) => Object.fromEntries(journeySteps(i).map((s) => [s.id, s.state]));

describe('journeySteps', () => {
  it('oficina nova: só o certificado está aberto; o resto depende dele', () => {
    const i = input({ status: status({ settings: null, credential: null }), fiscal: null });
    expect(states(i)).toEqual({ certificado: 'todo', empresa: 'locked', impostos: 'locked', automacao: 'locked', pronto: 'locked' });
    expect(firstOpen(journeySteps(i))).toBe('certificado');
    expect(progress(journeySteps(i))).toBe(0);
  });

  it('tudo configurado abre no piloto automático', () => {
    const steps = journeySteps(input());
    expect(steps.every((s) => s.state === 'done')).toBe(true);
    expect(firstOpen(steps)).toBe('pronto');
    expect(progress(steps)).toBe(1);
  });

  it('sem regime, a etapa de impostos pede ação e é a que abre', () => {
    const i = input({ fiscal: { ...input().fiscal!, taxRegime: null } });
    expect(states(i).impostos).toBe('todo');
    expect(states(i).pronto).toBe('locked');
    expect(firstOpen(journeySteps(i))).toBe('impostos');
  });

  it('busca de notas desligada pede ação; parte das automações ligada já conta como feita', () => {
    expect(states(input({ status: status({ credential: cred({ enabled: false }) }) })).automacao).toBe('todo');
    const partial = journeySteps(input({ status: status({ credential: cred({ autoExport: false }) }) }));
    expect(partial.find((s) => s.id === 'automacao')).toMatchObject({ state: 'partial', summary: '2 de 3 ligadas' });
    expect(partial.find((s) => s.id === 'pronto')?.state).toBe('done');
  });

  it('certificado vencido volta a pedir ação; perto de vencer só avisa', () => {
    expect(states(input({ status: status({ credential: cred({ notAfter: new Date(NOW - DAY).toISOString() }) }) })).certificado).toBe('todo');
    const soon = journeySteps(input({ status: status({ credential: cred({ notAfter: new Date(NOW + 10 * DAY).toISOString() }) }) }));
    expect(soon[0]).toMatchObject({ state: 'partial', summary: 'Vence em 10 dias' });
  });

  it('imposto estimado fica como parcial', () => {
    const tax = { profile: null, readiness: { regime: 'SIMPLES' as const, regimeInformed: true, supported: true, steps: [], requiredTables: [], ready: false, summary: '' } };
    expect(states(input({ tax })).impostos).toBe('partial');
  });

  it('sem a chave de criptografia no servidor, o certificado fica bloqueado', () => {
    expect(states(input({ status: status({ keyAvailable: false, credential: null, settings: null }) })).certificado).toBe('locked');
  });
});
