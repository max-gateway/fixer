import { describe, expect, it } from 'vitest';
import { normalizePlate, PLATE_RE, pushRecentVehicle, shopVehicles, toFilter, vehicleName, yearsOf } from './vehicles';

const gol = { vehicleId: 'v-gol', make: 'Volkswagen', model: 'Gol', name: 'Gol 1.6 MSI Flex', engine: '1.6', yearFrom: 2013, yearTo: 2016, partCount: 120 };

describe('veículo do diretório', () => {
  it('o rótulo traz a montadora (sem repetir a abreviada) e o ano escolhido (ou a faixa)', () => {
    expect(vehicleName(gol)).toBe('Volkswagen Gol 1.6 MSI Flex');
    expect(vehicleName({ make: 'Citroën', model: 'C3', name: 'CITROEN C3' })).toBe('CITROEN C3');
    expect(vehicleName({ make: 'Volkswagen', model: 'Gol', name: 'VW Gol 1.6' })).toBe('VW Gol 1.6');
    expect(toFilter(gol, 2015)).toEqual({ id: 'v-gol', label: 'Volkswagen Gol 1.6 MSI Flex · 2015' });
    expect(toFilter(gol)).toEqual({ id: 'v-gol', label: 'Volkswagen Gol 1.6 MSI Flex · 2013–2016' });
    expect(toFilter({ ...gol, yearFrom: undefined, yearTo: undefined }).label).toBe('Volkswagen Gol 1.6 MSI Flex');
  });

  it('faixa de anos', () => {
    expect(yearsOf({ yearFrom: 2015, yearTo: 2015 })).toBe('2015');
    expect(yearsOf({ yearFrom: 2015 })).toBe('2015→');
    expect(yearsOf({})).toBe('');
  });
});

describe('placa', () => {
  it('normaliza e aceita os dois formatos', () => {
    expect(normalizePlate('abc-1d23 ')).toBe('ABC1D23');
    expect(PLATE_RE.test('ABC1D23')).toBe(true);
    expect(PLATE_RE.test('ABC1234')).toBe(true);
    expect(PLATE_RE.test('AB12345')).toBe(false);
  });
});

describe('recentes e veículos da oficina', () => {
  it('recente vai para o topo, sem repetir o id, com limite', () => {
    const list = [1, 2, 3, 4, 5, 6].map((i) => ({ id: `v${i}`, label: `V${i}` }));
    expect(pushRecentVehicle(list, { id: 'v3', label: 'V3 novo' }).map((v) => v.id)).toEqual(['v3', 'v1', 'v2', 'v4', 'v5', 'v6']);
    expect(pushRecentVehicle(list, { id: 'v9', label: 'V9' })).toHaveLength(6);
  });

  it('só ordens em aberto, uma vez por placa, na ordem da lista', () => {
    const order = (number: number, status: string, plate: string) => ({ number, status, vehicle: { plate, brand: 'Fiat', model: 'Strada' } });
    expect(shopVehicles([order(9, 'IN_PROGRESS', 'AAA1A11'), order(8, 'DELIVERED', 'BBB2B22'), order(7, 'QUOTE', 'AAA1A11'), order(6, 'CANCELLED', 'CCC3C33'), order(5, 'AWAITING_PART', 'DDD4D44')])).toEqual([
      { plate: 'AAA1A11', label: 'Fiat Strada', orderNumber: 9 },
      { plate: 'DDD4D44', label: 'Fiat Strada', orderNumber: 5 },
    ]);
  });
});
