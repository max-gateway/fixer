import { Injectable } from '@nestjs/common';
import { catalog } from '@fixer/catalog';
import type { Prisma } from '@fixer/db';
import { resolveVariantChain, type VariantResolution } from '@fixer/domain';

type Tx = Prisma.TransactionClient;

export interface ResolvedVariant {
  variantId: string | null;
  resolution: VariantResolution;
}

/**
 * Normaliza o veículo na hierarquia MAKE > MODEL > FAMILY > VERSION a partir do JSON
 * cru do plate-lookup (já salvo; nenhuma consulta paga nova). Spec: docs/specs/service-catalog.md §4.4.
 */
@Injectable()
export class VehicleVariantsService {
  async resolveForPlate(tx: Tx, plate: string): Promise<ResolvedVariant> {
    const lookup = await tx.plateLookup.findUnique({ where: { plate }, select: { rawResponse: true } });
    if (!lookup) return { variantId: null, resolution: 'NONE' };

    const { chain, resolution } = resolveVariantChain(lookup.rawResponse as never, {
      multiWordModels: catalog.multiWordModels,
    });
    if (!chain.length) return { variantId: null, resolution };

    // upsert com update vazio: cria o que falta (LOCAL) e nunca altera um nó existente,
    // inclusive os GLOBAL do catálogo; resiste a duas OS criando o mesmo nó em paralelo.
    const idByKey = new Map<string, string>();
    for (const node of chain) {
      const row = await tx.vehicleVariant.upsert({
        where: { key: node.key },
        create: {
          key: node.key,
          level: node.level,
          parentId: node.parentKey ? idByKey.get(node.parentKey)! : null,
          make: node.make,
          model: node.model ?? null,
          engine: node.engine ?? null,
          fuel: node.fuel ?? null,
          fipeCode: node.fipeCode ?? null,
          origin: 'LOCAL',
        },
        update: {},
      });
      idByKey.set(node.key, row.id);
    }
    return { variantId: idByKey.get(chain[chain.length - 1].key)!, resolution };
  }

  /** Resolve e grava no veículo. Sem lookup salvo, mantém o que já estava (não apaga variante resolvida). */
  async attachToVehicle(tx: Tx, vehicleId: string, plate: string): Promise<ResolvedVariant | null> {
    const resolved = await this.resolveForPlate(tx, plate);
    if (!resolved.variantId) return null;
    await tx.vehicle.update({
      where: { id: vehicleId },
      data: { variantId: resolved.variantId, variantResolution: resolved.resolution },
    });
    return resolved;
  }
}
