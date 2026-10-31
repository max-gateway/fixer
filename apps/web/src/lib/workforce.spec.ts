import { describe, expect, it } from 'vitest';
import {
  currentPositions,
  DEFAULT_FILTERS,
  displayName,
  filtersToParams,
  formatDate,
  headline,
  isValidCpf,
  maskCpf,
  tenure,
  type Engagement,
  type PersonDetail,
} from './workforce';

const engagement = (over: Partial<Engagement> = {}): Engagement => ({
  id: 'e1',
  kind: 'clt',
  status: 'active',
  unitId: null,
  unitName: null,
  admittedOn: '2024-03-10',
  terminatedOn: null,
  positions: [],
  ...over,
});

const person = (engagements: Engagement[]): PersonDetail => ({
  id: 'p1',
  cpf: '***',
  name: 'Ana Souza',
  socialName: null,
  birthDate: null,
  email: null,
  phone: null,
  hasLogin: false,
  status: 'active',
  version: 1,
  createdAt: '2024-03-10T00:00:00.000Z',
  anonymized: false,
  engagements,
});

describe('CPF', () => {
  it('aplica a máscara enquanto digita', () => {
    expect(maskCpf('529')).toBe('529');
    expect(maskCpf('5299')).toBe('529.9');
    expect(maskCpf('529982')).toBe('529.982');
    expect(maskCpf('5299822')).toBe('529.982.2');
    expect(maskCpf('52998224725')).toBe('529.982.247-25');
    expect(maskCpf('529.982.247-25999')).toBe('529.982.247-25');
  });

  it('confere os dígitos verificadores', () => {
    expect(isValidCpf('529.982.247-25')).toBe(true);
    expect(isValidCpf('52998224725')).toBe(true);
    expect(isValidCpf('529.982.247-24')).toBe(false);
    expect(isValidCpf('111.111.111-11')).toBe(false);
    expect(isValidCpf('123')).toBe(false);
  });
});

describe('datas', () => {
  it('formata data civil sem mexer no fuso', () => {
    expect(formatDate('2024-03-10')).toBe('10/03/2024');
    expect(formatDate(null)).toBe('—');
  });

  it('calcula o tempo de casa em meses fechados', () => {
    expect(tenure('2024-03-10', '2024-03-25')).toBe('menos de 1 mês');
    expect(tenure('2024-03-10', '2024-04-09')).toBe('menos de 1 mês');
    expect(tenure('2024-03-10', '2024-04-10')).toBe('1 mês');
    expect(tenure('2023-01-15', '2024-04-20')).toBe('1 ano e 3 meses');
    expect(tenure('2022-01-01', '2024-01-01')).toBe('2 anos');
  });
});

describe('vínculos', () => {
  const positions = [
    { positionKey: 'aux', positionName: 'Auxiliar', validFrom: '2024-03-10', validTo: '2025-01-31' },
    { positionKey: 'mec', positionName: 'Mecânico', validFrom: '2025-02-01', validTo: null },
  ];

  it('a função em vigor é a que cobre hoje', () => {
    const e = engagement({ positions });
    expect(currentPositions(e, '2024-06-01').map((p) => p.positionKey)).toEqual(['aux']);
    expect(currentPositions(e, '2025-06-01').map((p) => p.positionKey)).toEqual(['mec']);
    expect(currentPositions(e, '2024-01-01')).toEqual([]);
  });

  it('o cabeçalho usa o vínculo ativo; sem vínculo ativo não há cabeçalho', () => {
    const active = engagement({ positions });
    expect(headline(person([active]), '2025-06-01')?.position).toBe('Mecânico');
    expect(headline(person([engagement({ status: 'terminated', terminatedOn: '2025-01-01' })]), '2025-06-01')).toBeNull();
    expect(headline(person([]), '2025-06-01')).toBeNull();
  });
});

describe('listagem', () => {
  it('monta a querystring só com o que foi preenchido', () => {
    expect(filtersToParams(DEFAULT_FILTERS).toString()).toBe('status=active&limit=50');
    expect(filtersToParams({ q: '  ana ', status: '' }, 20).toString()).toBe('search=ana&limit=20');
  });

  it('prefere o nome social', () => {
    expect(displayName({ name: 'Ana Souza', socialName: 'Aninha' })).toBe('Aninha');
    expect(displayName({ name: 'Ana Souza', socialName: '  ' })).toBe('Ana Souza');
  });
});
