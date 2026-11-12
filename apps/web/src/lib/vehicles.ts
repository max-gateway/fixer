// Escolha do veículo na busca de peças: o diretório de veículos do catálogo (os mesmos ids que a busca aceita) e a placa, como a API do Fixer os devolve.

import type { VehicleFilter } from './part-search';

/** Um veículo do diretório. Nome e motor são os mais frequentes nas aplicações das peças; anos, do menor ao maior. */
export type DirectoryVehicle = {
  vehicleId: string;
  make: string;
  model: string;
  name: string;
  engine?: string;
  yearFrom?: number;
  yearTo?: number;
  /** Peças do catálogo que servem nele. */
  partCount: number;
};

export type VehicleOption = { name: string; vehicles: number; parts: number };

/** Cascata: montadoras sempre; modelos com a montadora; anos e veículos com montadora e modelo. */
export type VehicleFacets = { makes: VehicleOption[]; models?: VehicleOption[]; years?: number[]; vehicles?: DirectoryVehicle[] };

/** O que a placa diz do carro e os veículos do catálogo que casam. `candidates` vazio: a placa existe, o catálogo não tem o modelo. */
export type PlateResolution = {
  plate: string;
  vehicle: { label: string; make?: string; model?: string; engine?: string; year?: number } | null;
  candidates: DirectoryVehicle[];
};

/** Veículo de uma ordem de serviço em aberto: atalho para "peças para o carro que está no elevador". */
export type ShopVehicle = { plate: string; label: string; orderNumber: number };

/** Placa antiga (ABC1234) ou Mercosul (ABC1D23), sem hífen e em maiúsculas. */
export const PLATE_RE = /^[A-Z]{3}[0-9][A-Z0-9][0-9]{2}$/;
export const normalizePlate = (raw: string) => raw.replace(/[^a-zA-Z0-9]/g, '').toUpperCase().slice(0, 7);

/** "2013–2016", "2015", "2013→" ou nada. */
export function yearsOf(v: Pick<DirectoryVehicle, 'yearFrom' | 'yearTo'>): string {
  const { yearFrom: from, yearTo: to } = v;
  if (from && to) return from === to ? String(from) : `${from}–${to}`;
  if (from) return `${from}→`;
  return '';
}

/**
 * O nome do diretório às vezes começa direto pelo modelo ("Strada Working 1.4"): aí o rótulo ganha a montadora na frente. Quando começa por outra
 * coisa, é a montadora abreviada ("VW Gol 1.6") e fica como veio.
 */
export function vehicleName(v: Pick<DirectoryVehicle, 'make' | 'model' | 'name'>): string {
  const fold = (s: string) => s.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase();
  return fold(v.name).startsWith(fold(v.model)) ? `${v.make} ${v.name}` : v.name;
}

/** O veículo como filtro da busca: o ano escolhido (se houver) entra no rótulo, porque é o que a pessoa reconhece ("Strada 1.4 · 2016"). */
export function toFilter(v: DirectoryVehicle, year?: number): VehicleFilter {
  return { id: v.vehicleId, label: [vehicleName(v), year ?? yearsOf(v)].filter(Boolean).join(' · ') };
}

export const RECENT_VEHICLES_MAX = 6;

/** Coloca o veículo no topo dos recentes, sem repetir (pelo id) e respeitando o limite. */
export function pushRecentVehicle(list: VehicleFilter[], v: VehicleFilter, max = RECENT_VEHICLES_MAX): VehicleFilter[] {
  return [v, ...list.filter((r) => r.id !== v.id)].slice(0, max);
}

const OPEN = new Set(['QUOTE', 'APPROVED', 'IN_PROGRESS', 'AWAITING_PART', 'COMPLETED']);

/** Veículos das ordens ainda não entregues, da mais nova à mais antiga, uma vez por placa. */
export function shopVehicles(orders: { number: number; status: string; vehicle: { plate: string; brand: string; model: string } }[], max = 6): ShopVehicle[] {
  const seen = new Set<string>();
  const out: ShopVehicle[] = [];
  for (const o of orders) {
    if (!OPEN.has(o.status) || seen.has(o.vehicle.plate)) continue;
    seen.add(o.vehicle.plate);
    out.push({ plate: o.vehicle.plate, label: [o.vehicle.brand, o.vehicle.model].filter(Boolean).join(' '), orderNumber: o.number });
    if (out.length === max) break;
  }
  return out;
}
