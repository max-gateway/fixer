import { describe, expect, it } from 'vitest';
import {
  activeFilters,
  formatLocation,
  isSearchable,
  groupApplications,
  groupCrossPairs,
  highlight,
  parseState,
  pushRecent,
  queryKind,
  searchUrl,
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
  it('ida e volta preserva filtros, veículo e peça aberta', () => {
    const s: SearchState = { q: 'bieleta', page: 3, brands: ['FIAT', 'NAKATA'], categories: ['c1'], vehicle: { id: 'v1', label: 'Fiat Strada' }, sku: 'abc' };
    expect(parseState(toPageParams(s))).toEqual(s);
  });
  it('página inválida volta para 1', () => {
    expect(parseState(new URLSearchParams('q=a&p=-4')).page).toBe(1);
    expect(parseState(new URLSearchParams('p=abc')).page).toBe(1);
  });
  it('estado vazio não gera parâmetros', () => {
    expect(toPageParams({ q: '', page: 1, brands: [], categories: [] }).toString()).toBe('');
  });
});

describe('searchUrl', () => {
  const base: SearchState = { q: 'bieleta', page: 2, brands: ['FIAT'], categories: ['c1', 'c2'] };
  it('usa a busca com filtros repetidos', () => {
    const url = searchUrl(base);
    expect(url).toContain('/api/catalog/parts/search?');
    expect(url).toContain('brandKey=FIAT');
    expect(url).toContain('categoryId=c1&categoryId=c2');
    expect(url).toContain('page=2');
  });
  it('veículo sem texto usa a lista por veículo', () => {
    const url = searchUrl({ ...base, q: '', vehicle: { make: 'Fiat', model: 'Strada', label: 'Fiat Strada' } });
    expect(url).toContain('/api/catalog/vehicle-parts?');
    expect(url).toContain('make=Fiat');
    expect(url).not.toContain('brandKey');
  });
  it('veículo com texto filtra a busca pelo id', () => {
    expect(searchUrl({ ...base, vehicle: { id: 'v1', label: 'x' } })).toContain('vehicleId=v1');
  });
});

describe('activeFilters', () => {
  it('troca a chave pelo nome da faceta', () => {
    const f = activeFilters({ q: 'a', page: 1, brands: ['FIAT'], categories: ['c1'] }, { brands: [{ key: 'FIAT', name: 'Fiat', count: 1 }], categories: [] });
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

describe('modo Minha oficina', () => {
  const base: SearchState = { q: '', page: 1, brands: [], categories: [], mine: true };

  it('é pesquisável sem texto e vai para a lista da oficina', () => {
    expect(isSearchable(base)).toBe(true);
    const url = searchUrl({ ...base, q: ' biel ', inStock: true });
    expect(url.startsWith('/api/catalog/workshop/parts?')).toBe(true);
    expect(url).toContain('q=biel');
    expect(url).toContain('inStock=true');
  });

  it('o estado sobrevive à URL e "com saldo" só vale no modo oficina', () => {
    const s = { ...base, inStock: true };
    expect(parseState(toPageParams(s))).toEqual(s);
    expect(parseState(new URLSearchParams('est=1')).inStock).toBeUndefined();
  });

  it('"com saldo" aparece como chip removível', () => {
    expect(activeFilters({ ...base, inStock: true }).map((f) => f.label)).toEqual(['Com saldo']);
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
