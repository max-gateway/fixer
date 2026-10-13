import { describe, expect, it } from 'vitest';
import { LearningService } from './learning.service.js';

/**
 * Banco em memória só com o que o LearningService usa. A árvore de variantes é fixa:
 * make > model > family > version. Linhas de serviço entram via `addLine`.
 */
function fakeDb() {
  const variants = [
    { id: 'make', level: 'MAKE', parentId: null },
    { id: 'model', level: 'MODEL', parentId: 'make' },
    { id: 'family', level: 'FAMILY', parentId: 'model' },
    { id: 'version', level: 'VERSION', parentId: 'family' },
    { id: 'family2', level: 'FAMILY', parentId: 'model' }, // irmã de family
  ];
  const lines: any[] = [];
  const observations: any[] = [];
  const estimates: any[] = [];
  const stats = { estimateWrites: 0, estimateDeletes: 0 };
  let seq = 0;

  const match = (row: any, where: any): boolean =>
    Object.entries(where ?? {}).every(([k, v]) => {
      if (v && typeof v === 'object' && 'in' in (v as any)) return (v as any).in.includes(row[k]);
      return row[k] === v;
    });

  const tx: any = {
    vehicleVariant: {
      findUnique: async ({ where }: any) => variants.find((v) => v.id === where.id) ?? null,
      findMany: async ({ where }: any) => variants.filter((v) => match(v, where)),
    },
    serviceOrderServiceLine: {
      findMany: async ({ where }: any) => lines.filter((l) => l.serviceOrderId === where.serviceOrderId),
    },
    serviceObservation: {
      findMany: async ({ where }: any) => observations.filter((o) => match(o, where)),
      findUnique: async ({ where }: any) =>
        observations.find((o) => (where.id ? o.id === where.id : o.serviceLineId === where.serviceLineId)) ?? null,
      create: async ({ data }: any) => {
        const row = { id: `obs${++seq}`, excluded: false, excludedReason: null, ...data };
        observations.push(row);
        return row;
      },
      update: async ({ where, data }: any) => Object.assign(observations.find((o) => o.id === where.id)!, data),
    },
    serviceEstimate: {
      findMany: async ({ where }: any) => estimates.filter((e) => match(e, where)),
      findUnique: async ({ where }: any) =>
        estimates.find(
          (e) =>
            e.serviceDefinitionId === where.orgId_serviceDefinitionId_variantId.serviceDefinitionId &&
            e.variantId === where.orgId_serviceDefinitionId_variantId.variantId,
        ) ?? null,
      upsert: async ({ where, create, update }: any) => {
        stats.estimateWrites++;
        const key = where.orgId_serviceDefinitionId_variantId;
        const existing = estimates.find((e) => e.serviceDefinitionId === key.serviceDefinitionId && e.variantId === key.variantId);
        if (existing) return Object.assign(existing, update);
        const row = { id: `est${++seq}`, ...create };
        estimates.push(row);
        return row;
      },
      delete: async ({ where }: any) => {
        stats.estimateDeletes++;
        const i = estimates.findIndex(
          (e) =>
            e.serviceDefinitionId === where.orgId_serviceDefinitionId_variantId.serviceDefinitionId &&
            e.variantId === where.orgId_serviceDefinitionId_variantId.variantId,
        );
        if (i >= 0) estimates.splice(i, 1);
      },
      deleteMany: async () => {
        estimates.length = 0;
      },
    },
  };

  let lineSeq = 0;
  const addLine = (o: Partial<any> = {}) => {
    const line = {
      id: `line${++lineSeq}`,
      serviceOrderId: 'order1',
      variantId: 'version',
      hoursActual: 4,
      hoursActualSource: 'EDITED',
      service: { definitionId: 'def1' },
      ...o,
    };
    lines.push(line);
    return line;
  };
  const snapshot = () =>
    JSON.stringify(
      estimates
        .map(({ id, computedAt, ...e }) => e)
        .sort((a, b) => (a.variantId + a.serviceDefinitionId).localeCompare(b.variantId + b.serviceDefinitionId)),
    );
  return { tx, lines, observations, estimates, stats, addLine, snapshot };
}

const service = new LearningService({} as never);
const estimateOf = (db: ReturnType<typeof fakeDb>, variantId: string) =>
  db.estimates.find((e) => e.variantId === variantId && e.serviceDefinitionId === 'def1');

describe('LearningService.recordForOrder', () => {
  it('cria a observação da linha com peso 1 para horas editadas', async () => {
    const db = fakeDb();
    const line = db.addLine({ hoursActual: 4.5 });
    await service.recordForOrder(db.tx, 'order1');
    expect(db.observations).toHaveLength(1);
    expect(db.observations[0]).toMatchObject({
      serviceLineId: line.id,
      serviceDefinitionId: 'def1',
      variantId: 'version',
      hoursActual: 4.5,
      weight: 1,
      excluded: false,
    });
  });

  it('usa peso 0.25 quando o valor sugerido foi aceito sem edição', async () => {
    const db = fakeDb();
    db.addLine({ hoursActualSource: 'ACCEPTED_DEFAULT' });
    await service.recordForOrder(db.tx, 'order1');
    expect(db.observations[0].weight).toBe(0.25);
  });

  it('ignora linhas sem definição, sem variante ou sem horas reais', async () => {
    const db = fakeDb();
    db.addLine({ service: { definitionId: null } });
    db.addLine({ variantId: null });
    db.addLine({ hoursActual: null });
    await service.recordForOrder(db.tx, 'order1');
    expect(db.observations).toEqual([]);
    expect(db.estimates).toEqual([]);
  });

  it('a observação conta para o nó e para todos os ancestrais, não para irmãos', async () => {
    const db = fakeDb();
    db.addLine();
    await service.recordForOrder(db.tx, 'order1');
    expect(db.estimates.map((e) => e.variantId).sort()).toEqual(['family', 'make', 'model', 'version']);
    expect(estimateOf(db, 'family2')).toBeUndefined();
    expect(estimateOf(db, 'make')).toMatchObject({ hoursMedian: 4, sampleCount: 1 });
  });

  it('é idempotente: processar a mesma OS de novo não duplica nem regrava nada', async () => {
    const db = fakeDb();
    db.addLine({ hoursActual: 4 });
    db.addLine({ hoursActual: 5 });
    await service.recordForOrder(db.tx, 'order1');
    const before = db.snapshot();
    const writes = db.stats.estimateWrites;
    await service.recordForOrder(db.tx, 'order1');
    await service.recordForOrder(db.tx, 'order1');
    expect(db.observations).toHaveLength(2);
    expect(db.snapshot()).toBe(before);
    expect(db.stats.estimateWrites).toBe(writes); // inputsDigest igual => nenhum upsert
  });

  it('exclui como outlier uma observação absurda quando já há estimativa sólida (n >= 5)', async () => {
    const db = fakeDb();
    for (const h of [4, 4.5, 5, 4, 4.5]) db.addLine({ serviceOrderId: 'o0', hoursActual: h });
    await service.recordForOrder(db.tx, 'o0');
    const absurd = db.addLine({ serviceOrderId: 'o1', hoursActual: 40 });
    await service.recordForOrder(db.tx, 'o1');
    const obs = db.observations.find((o) => o.serviceLineId === absurd.id)!;
    expect(obs).toMatchObject({ excluded: true });
    expect(obs.excludedReason).toMatch(/4×|4x|p75/i);
    expect(estimateOf(db, 'version')!.sampleCount).toBe(5);
  });

  it('não exclui horas altas quando ainda não há estimativa sólida', async () => {
    const db = fakeDb();
    const l = db.addLine({ hoursActual: 40 });
    await service.recordForOrder(db.tx, 'order1');
    expect(db.observations.find((o) => o.serviceLineId === l.id)!.excluded).toBe(false);
  });

  it('rejeita horas <= 0 como observação excluída', async () => {
    const db = fakeDb();
    db.addLine({ hoursActual: 0 });
    await service.recordForOrder(db.tx, 'order1');
    expect(db.observations[0]).toMatchObject({ excluded: true });
    expect(db.estimates).toEqual([]);
  });
});

describe('LearningService.estimateFor', () => {
  it('sem variante ou sem observações devolve NONE', async () => {
    const db = fakeDb();
    expect(await service.estimateFor(db.tx, 'def1', null)).toEqual({ source: 'NONE' });
    expect(await service.estimateFor(db.tx, 'def1', 'version')).toEqual({ source: 'NONE' });
  });

  it('1 serviço semelhante num ancestral → REFERENCE', async () => {
    const db = fakeDb();
    db.addLine({ variantId: 'family2', hoursActual: 6 });
    await service.recordForOrder(db.tx, 'order1');
    expect(await service.estimateFor(db.tx, 'def1', 'version')).toMatchObject({
      source: 'REFERENCE',
      level: 'MODEL',
      hours: 6,
      sampleCount: 1,
    });
  });

  it('3 observações num ancestral → LEARNED a partir dele', async () => {
    const db = fakeDb();
    for (const h of [4, 5, 6]) db.addLine({ variantId: 'family2', hoursActual: h });
    await service.recordForOrder(db.tx, 'order1');
    const r = await service.estimateFor(db.tx, 'def1', 'version');
    expect(r).toMatchObject({ source: 'LEARNED', level: 'MODEL', sampleCount: 3 });
  });
});

describe('LearningService.excludeObservation / rebuild', () => {
  it('excluir uma observação recalcula o nó e os ancestrais', async () => {
    const db = fakeDb();
    db.addLine({ hoursActual: 4 });
    const bad = db.addLine({ hoursActual: 30 });
    await service.recordForOrder(db.tx, 'order1');
    expect(estimateOf(db, 'make')!.sampleCount).toBe(2);
    const obs = db.observations.find((o) => o.serviceLineId === bad.id)!;
    await service.excludeObservation(db.tx, obs.id, 'digitação errada');
    expect(db.observations.find((o) => o.id === obs.id)).toMatchObject({ excluded: true, excludedReason: 'digitação errada' });
    expect(estimateOf(db, 'make')).toMatchObject({ sampleCount: 1, hoursMedian: 4 });
  });

  it('excluir a única observação remove a estimativa derivada', async () => {
    const db = fakeDb();
    db.addLine();
    await service.recordForOrder(db.tx, 'order1');
    await service.excludeObservation(db.tx, db.observations[0].id, 'teste');
    expect(db.estimates).toEqual([]);
  });

  it('rebuild a partir das observações produz as mesmas estimativas do caminho incremental', async () => {
    const db = fakeDb();
    for (const [v, h] of [['version', 4], ['family2', 5], ['family', 6], ['version', 4.5]] as const) {
      db.addLine({ variantId: v, hoursActual: h });
    }
    await service.recordForOrder(db.tx, 'order1');
    const incremental = db.snapshot();
    await service.rebuild(db.tx);
    expect(db.snapshot()).toBe(incremental);
  });
});
