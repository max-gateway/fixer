import { createHash } from 'node:crypto';
import { Injectable, NotFoundException } from '@nestjs/common';
import type { Prisma } from '@fixer/db';
import { computeEstimate, pickEstimate, type NodeEstimate, type PickedEstimate } from '@fixer/domain';
import { PrismaService } from '../prisma/prisma.service.js';

type Tx = Prisma.TransactionClient;

/** Observação aceita sem edição vale menos: não é medição (spec §6.3). */
const ACCEPTED_DEFAULT_WEIGHT = 0.25;
/** Só rejeitamos por "absurdo" quando a estimativa existente é sólida (spec §6.5). */
const SANITY_MIN_SAMPLES = 5;
const SANITY_FACTOR = 4;

/**
 * Aprendizado de horas por serviço × veículo (docs/specs/service-catalog.md §5–§6).
 * A observação (ServiceObservation, única por linha) é a fonte da verdade; a estimativa
 * (ServiceEstimate) é recalculada a partir delas, nunca incrementada, e só é gravada quando
 * o conjunto de entradas muda (inputsDigest). É isso que torna tudo idempotente.
 */
@Injectable()
export class LearningService {
  constructor(private readonly prisma: PrismaService) {}

  /** Estimativa para exibir no orçamento: nó mais específico com amostra suficiente, com fallback. */
  estimate(definitionId: string, variantId: string | null): Promise<PickedEstimate> {
    return this.prisma.$transaction((tx) => this.estimateFor(tx, definitionId, variantId));
  }

  async estimateFor(tx: Tx, definitionId: string, variantId: string | null): Promise<PickedEstimate> {
    if (!variantId) return { source: 'NONE' };
    const chain = await this.ancestors(tx, variantId);
    const rows = await tx.serviceEstimate.findMany({
      where: { serviceDefinitionId: definitionId, variantId: { in: chain.map((c) => c.id) } },
    });
    const byVariant = new Map(rows.map((r) => [r.variantId, r]));
    const nodes: NodeEstimate[] = [];
    for (const c of chain) {
      const r = byVariant.get(c.id);
      if (r) {
        nodes.push({
          variantId: c.id,
          level: c.level,
          sampleCount: r.sampleCount,
          median: Number(r.hoursMedian),
          p25: Number(r.hoursP25),
          p75: Number(r.hoursP75),
        });
      }
    }
    return pickEstimate(nodes);
  }

  /**
   * Registra as observações das linhas de serviço da OS (chamado ao concluir) e recalcula as
   * estimativas afetadas. Reprocessar a mesma OS não muda nada.
   */
  async recordForOrder(tx: Tx, serviceOrderId: string): Promise<void> {
    const lines = await tx.serviceOrderServiceLine.findMany({
      where: { serviceOrderId },
      include: { service: { select: { definitionId: true } } },
    });
    const pairs = new Map<string, { definitionId: string; variantId: string }>();

    for (const line of lines) {
      const definitionId = line.service?.definitionId;
      if (!definitionId || !line.variantId || line.hoursActual == null) continue;
      const hours = Number(line.hoursActual);
      const weight = line.hoursActualSource === 'ACCEPTED_DEFAULT' ? ACCEPTED_DEFAULT_WEIGHT : 1;

      const existing = await tx.serviceObservation.findUnique({ where: { serviceLineId: line.id } });
      if (existing) {
        // A decisão de excluir é tomada uma única vez, na criação; reprocessar não a reverte.
        await tx.serviceObservation.update({ where: { id: existing.id }, data: { hoursActual: hours, weight } });
      } else {
        const exclusion = await this.sanityExclusion(tx, definitionId, line.variantId, hours);
        await tx.serviceObservation.create({
          data: {
            serviceLineId: line.id,
            serviceDefinitionId: definitionId,
            variantId: line.variantId,
            hoursActual: hours,
            weight,
            observedAt: new Date(),
            excluded: exclusion !== null,
            excludedReason: exclusion,
          },
        });
      }
      pairs.set(`${definitionId}|${line.variantId}`, { definitionId, variantId: line.variantId });
    }

    for (const p of pairs.values()) await this.recompute(tx, p.definitionId, p.variantId);
  }

  async excludeObservation(tx: Tx, observationId: string, reason: string): Promise<void> {
    const obs = await tx.serviceObservation.findUnique({ where: { id: observationId } });
    if (!obs) throw new NotFoundException('Observação não encontrada');
    await tx.serviceObservation.update({ where: { id: observationId }, data: { excluded: true, excludedReason: reason } });
    await this.recompute(tx, obs.serviceDefinitionId, obs.variantId);
  }

  /** Reconstrói todas as estimativas só a partir das observações (recuperação e prova de consistência). */
  async rebuild(tx: Tx): Promise<void> {
    const all = await tx.serviceObservation.findMany({ where: {} });
    await tx.serviceEstimate.deleteMany({});
    const pairs = new Map(all.map((o) => [`${o.serviceDefinitionId}|${o.variantId}`, o]));
    for (const o of pairs.values()) await this.recompute(tx, o.serviceDefinitionId, o.variantId);
  }

  /** Recalcula o nó da observação e todos os ancestrais (cada observação conta para a cadeia inteira). */
  async recompute(tx: Tx, definitionId: string, variantId: string): Promise<void> {
    for (const node of await this.ancestors(tx, variantId)) {
      const subtree = await this.subtreeIds(tx, node.id);
      const rows = await tx.serviceObservation.findMany({
        where: { serviceDefinitionId: definitionId, variantId: { in: subtree }, excluded: false },
      });
      const computed = computeEstimate(rows.map((r) => ({ id: r.id, hours: Number(r.hoursActual), weight: Number(r.weight) })));
      const key = { serviceDefinitionId_variantId: { serviceDefinitionId: definitionId, variantId: node.id } };
      const existing = await tx.serviceEstimate.findUnique({ where: key });

      if (!computed) {
        if (existing) await tx.serviceEstimate.delete({ where: key });
        continue;
      }
      const inputsDigest = createHash('sha256').update(computed.inputsKey).digest('hex');
      if (existing?.inputsDigest === inputsDigest) continue; // nada mudou: não regrava

      const data = {
        hoursMedian: computed.median,
        hoursP25: computed.p25,
        hoursP75: computed.p75,
        sampleCount: computed.sampleCount,
        computedAt: new Date(),
        inputsDigest,
      };
      await tx.serviceEstimate.upsert({
        where: key,
        create: { serviceDefinitionId: definitionId, variantId: node.id, ...data },
        update: data,
      });
    }
  }

  private async sanityExclusion(tx: Tx, definitionId: string, variantId: string, hours: number): Promise<string | null> {
    if (!(hours > 0)) return 'horas inválidas (<= 0)';
    const current = await this.estimateFor(tx, definitionId, variantId);
    if (current.source === 'LEARNED' && current.sampleCount >= SANITY_MIN_SAMPLES && hours > SANITY_FACTOR * current.p75) {
      return `acima de ${SANITY_FACTOR}× o p75 (${current.p75} h)`;
    }
    return null;
  }

  /** [o próprio nó, pai, ..., raiz]. */
  private async ancestors(tx: Tx, variantId: string): Promise<Array<{ id: string; level: string }>> {
    const chain: Array<{ id: string; level: string }> = [];
    let current: string | null = variantId;
    while (current && chain.length < 8) {
      const row: { id: string; level: string; parentId: string | null } | null = await tx.vehicleVariant.findUnique({
        where: { id: current },
        select: { id: true, level: true, parentId: true },
      });
      if (!row) break;
      chain.push({ id: row.id, level: row.level });
      current = row.parentId;
    }
    return chain;
  }

  /** O nó e todos os descendentes. */
  private async subtreeIds(tx: Tx, rootId: string): Promise<string[]> {
    const ids = [rootId];
    let frontier = [rootId];
    while (frontier.length && ids.length < 5000) {
      const children = await tx.vehicleVariant.findMany({ where: { parentId: { in: frontier } }, select: { id: true } });
      frontier = children.map((c) => c.id).filter((id) => !ids.includes(id));
      ids.push(...frontier);
    }
    return ids;
  }
}
