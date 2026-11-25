import { catalog } from '@fixer/catalog';
import { resolveVariantChain } from '@fixer/domain';
import type { PlateLookupResult } from '../plate-lookup/schema.js';

/** O que a placa diz do veículo, para a tela confirmar ("VW/GOL 1.6 · 2015") antes de a pessoa escolher a versão. */
export interface PlateVehicle {
  label: string;
  make?: string;
  model?: string;
  engine?: string;
  year?: number;
}

/**
 * A placa (Puxa Placa) descrita como o diretório de veículos do catálogo entende: montadora e modelo normalizados pela mesma regra das variantes da
 * oficina (`resolveVariantChain`), motor em litros pela cilindrada e o ano-modelo.
 */
export function plateVehicle(result: PlateLookupResult): PlateVehicle | null {
  const dados = result.basico?.dados;
  if (!dados?.marca?.trim()) return null;
  const { chain } = resolveVariantChain(result as never, { multiWordModels: catalog.multiWordModels });
  const node = chain.at(-1);
  const year = dados.anoModelo ?? dados.ano ?? undefined;
  return {
    label: (dados.marcamodelo ?? [dados.marca, dados.modelo].filter(Boolean).join(' ')).trim(),
    ...(node?.make ? { make: node.make.replace(/-/g, ' ') } : {}),
    ...(node?.model ? { model: node.model.replace(/-/g, ' ') } : {}),
    ...(node?.engine ? { engine: node.engine } : {}),
    ...(typeof year === 'number' ? { year } : {}),
  };
}

/**
 * Consultas ao diretório, da mais específica à mais solta; vale a primeira que tiver candidato. A montadora da placa nem sempre é a do catálogo
 * ("VW" × "Volkswagen") e o motor nem sempre está nas aplicações, então cada um cai antes do modelo, que é o que de fato identifica o carro.
 */
export function plateQueries(v: PlateVehicle): string[] {
  if (!v.model) return v.make ? [v.make] : [];
  const year = v.year ? String(v.year) : undefined;
  const join = (...parts: (string | undefined)[]) => parts.filter(Boolean).join(' ');
  const candidates = [
    join(v.make, v.model, v.engine, year),
    join(v.make, v.model, year),
    join(v.model, v.engine, year),
    join(v.model, year),
    join(v.make, v.model),
    v.model,
  ];
  return [...new Set(candidates)].filter((q) => q.trim().length >= 2);
}
