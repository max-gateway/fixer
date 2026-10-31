import { describe, expect, it } from 'vitest';
import {
  activeFilters,
  EMPTY_STATE,
  formatLocation,
  groupApplications,
  groupCrossPairs,
  highlight,
  parseState,
  pushRecent,
  queryKind,
  searchUrl,
  sourceOf,
  toPageParams,
  yearRange,
  type Application,
  type SearchState,
} from './part-search';

const app = (over: Partial<Application>): Application => ({ vehicleId: 'v', make: 'Fiat', model: 'Strada', vehicleName: 'Fiat Strada', ...over });

describe('queryKind', () => {
  it.each([
    ['', 'empty'],
    ['7891234567890', 'gtin'],
    ['12345678', 'gtin'],
    ['BE-123', 'code'],
    ['bieleta dianteira', 'text'],
    ['bieleta 123', 'text'],
    ['ab', 'text'],
  ])('%s → %s', (q, kind) => expect(queryKind(q)).toBe(kind));
});

describe('estado na URL', () => {
  it('ida e volta preserva filtros, veículo, disponibilidade e peça aberta', () => {
    const s: SearchState = { q: 'bieleta', page: 3, brands: ['FIAT', 'NAKATA'], categories: ['c1'], vehicle: { id: 'v1', label: 'Fiat Strada · 2016' }, sku: 'abc', avail: 'stock' };
    expect(parseState(toPageParams(s))).toEqual(s);
    expect(parseState(toPageParams({ ...s, avail: 'mine' })).avail).toBe('mine');
  });
  it('página inválida volta para 1; disponibilidade desconhecida é o catálogo inteiro', () => {
    expect(parseState(new URLSearchParams('q=a&p=-4')).page).toBe(1);
    expect(parseState(new URLSearchParams('p=abc')).page).toBe(1);
    expect(parseState(new URLSearchParams('ver=tudo')).avail).toBe('all');
  });
  it('estado vazio não gera parâmetros', () => {
    expect(toPageParams(EMPTY_STATE).toString()).toBe('');
  });
  it('veículo sem rótulo na URL ainda abre (rótulo genérico)', () => {
    expect(parseState(new URLSearchParams('vid=v9')).vehicle).toEqual({ id: 'v9', label: 'Veículo escolhido' });
  });
});

describe('de onde vem a lista (sourceOf) e a rota (searchUrl)', () => {
  const base: SearchState = { ...EMPTY_STATE, q: 'bieleta', page: 2, brands: ['FIAT'], categories: ['c1', 'c2'] };

  it('sem texto, abre no estoque da oficina; uma letra só não é busca', () => {
    expect(sourceOf(EMPTY_STATE)).toBe('workshop');
    expect(sourceOf({ ...EMPTY_STATE, q: 'b' })).toBe('workshop');
    expect(searchUrl(EMPTY_STATE)).toBe('/api/catalog/workshop/parts?page=1&limit=24');
  });

  it('texto no catálogo inteiro: busca com filtros repetidos', () => {
    expect(sourceOf(base)).toBe('catalog');
    const url = searchUrl(base);
    expect(url).toContain('/api/catalog/parts/search?');
    expect(url).toContain('brandKey=FIAT');
    expect(url).toContain('categoryId=c1&categoryId=c2');
    expect(url).toContain('page=2');
  });

  it('"Na oficina" e "Com saldo" vão para a lista da oficina com o texto', () => {
    const mine = searchUrl({ ...base, q: ' biel ', avail: 'mine' });
    expect(mine.startsWith('/api/catalog/workshop/parts?')).toBe(true);
    expect(mine).toContain('q=biel');
    expect(mine).not.toContain('inStock');
    expect(searchUrl({ ...base, avail: 'stock' })).toContain('inStock=true');
  });

  it('veículo sem texto usa a lista do veículo; com texto, filtra a busca pelo id', () => {
    const v = { id: 'v1', label: 'Fiat Strada' };
    expect(sourceOf({ ...base, q: '', vehicle: v })).toBe('vehicle');
    const url = searchUrl({ ...base, q: '', vehicle: v });
    expect(url).toContain('/api/catalog/vehicle-parts?');
    expect(url).toContain('vehicleId=v1');
    expect(url).not.toContain('brandKey');
    expect(searchUrl({ ...base, vehicle: v })).toContain('vehicleId=v1');
  });

  it('o veículo vale sobre a disponibilidade (a oficina não sabe em que veículo cada peça serve)', () => {
    expect(sourceOf({ ...base, avail: 'stock', vehicle: { id: 'v1', label: 'x' } })).toBe('catalog');
  });
});

describe('activeFilters', () => {
  it('troca a chave pelo nome da faceta', () => {
    const f = activeFilters({ ...EMPTY_STATE, q: 'a', brands: ['FIAT'], categories: ['c1'] }, { brands: [{ key: 'FIAT', name: 'Fiat', count: 1 }], categories: [] });
    expect(f.map((x) => x.label)).toEqual(['Fiat', 'c1']);
  });
});

describe('groupCrossPairs', () => {
  it('agrupa por marca, separa no primeiro ":" e tira a própria peça', () => {
    const g = groupCrossPairs(['NAKATA:N-123', 'COFAP:CF:9', 'NAKATA:N-124', 'NAKATA:N-123', 'FIAT:BE123'], { partNumber: 'BE-123', brand: 'Fiat' });
    expect(g).toEqual([
      { brand: 'NAKATA', codes: ['N-123', 'N-124'] },
      { brand: 'COFAP', codes: ['CF:9'] },
    ]);
  });
  it('ignora pares vazios', () => {
    expect(groupCrossPairs(['X:', ''])).toEqual([]);
  });
});

describe('yearRange', () => {
  it.each([
    [2010, 2015, '2010–2015'],
    [2010, 2010, '2010'],
    [2010, undefined, '2010→'],
    [undefined, 2008, 'até 2008'],
    [undefined, undefined, 'todos os anos'],
  ])('%s %s', (a, b, out) => expect(yearRange(a, b)).toBe(out));
});

describe('groupApplications', () => {
  const apps = [
    app({ vehicleId: '1', model: 'Strada', yearFrom: 2012, yearTo: 2020, engine: '1.4' }),
    app({ vehicleId: '2', model: 'Palio', yearFrom: 2008, yearTo: 2012 }),
    app({ vehicleId: '3', make: 'Volkswagen', model: 'Gol', vehicleName: 'VW Gol', yearFrom: 2015, yearTo: 2018 }),
  ];
  it('agrupa por montadora (maior primeiro) e modelo', () => {
    const g = groupApplications(apps);
    expect(g.map((m) => [m.make, m.count])).toEqual([
      ['Fiat', 2],
      ['Volkswagen', 1],
    ]);
    expect(g[0]!.models.map((m) => m.model)).toEqual(['Palio', 'Strada']);
    expect(g[0]!.models[1]).toMatchObject({ yearFrom: 2012, yearTo: 2020 });
  });
  it('filtra por texto sem acento e por ano dentro da faixa', () => {
    expect(groupApplications(apps, 'gol')).toHaveLength(1);
    expect(groupApplications(apps, 'strada 1.4')[0]!.count).toBe(1);
    expect(groupApplications(apps, '2016').map((m) => m.make)).toEqual(['Fiat', 'Volkswagen']);
    expect(groupApplications(apps, '1999')).toEqual([]);
  });
});

describe('highlight', () => {
  it('marca os termos ignorando acento e caixa', () => {
    expect(highlight('Bieleta Estabilizadora', 'estabilizadora biel')).toEqual([
      { text: 'Biel', hit: true },
      { text: 'eta ', hit: false },
      { text: 'Estabilizadora', hit: true },
    ]);
    expect(highlight('Suspensão', 'suspensao')).toEqual([{ text: 'Suspensão', hit: true }]);
  });
  it('sem termo útil devolve o texto inteiro', () => {
    expect(highlight('Bieleta', 'a')).toEqual([{ text: 'Bieleta', hit: false }]);
  });
});

describe('pushRecent', () => {
  it('põe no topo, sem repetir e limitado', () => {
    expect(pushRecent(['b', 'Bieleta', 'c'], 'bieleta')).toEqual(['bieleta', 'b', 'c']);
    expect(pushRecent(['a', 'b'], 'cc', 2)).toEqual(['cc', 'a']);
    expect(pushRecent(['a'], ' x ')).toEqual(['a']);
  });
});

describe('formatLocation', () => {
  it('descreve a primeira posição e conta as demais', () => {
    expect(formatLocation([{ depot: 'Matriz', path: 'B', shelf: '3', box: '7' }, { depot: 'Filial' }])).toBe('Matriz · Corredor B · Prateleira 3 · Caixa 7 (+1)');
  });
  it('sem posição, nada', () => {
    expect(formatLocation([])).toBeNull();
    expect(formatLocation(undefined)).toBeNull();
  });
});
