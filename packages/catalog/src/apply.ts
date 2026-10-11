import type { Catalog } from './types.js';
import { validateCatalog } from './validate.js';

// Subconjunto do Prisma (client ou tx) que o catálogo usa. Tipado de forma frouxa de propósito:
// o pacote não depende do client gerado, e o teste usa um banco em memória.
interface Table {
  findUnique(args: any): Promise<any>;
  create(args: any): Promise<any>;
  update(args: any): Promise<any>;
  upsert(args: any): Promise<any>;
}
export interface CatalogDb {
  vehicleComponent: Table;
  serviceFiscalProfile: Table;
  serviceDefinition: Table & { updateMany(args: any): Promise<{ count: number }> };
  vehicleVariant: Table;
  serviceSuggestedPart: Table & { findFirst(args: any): Promise<any> };
  catalogState: Table;
}

const LEVEL_ORDER = { MAKE: 0, MODEL: 1, FAMILY: 2, VERSION: 3 } as const;

/**
 * Aplica o catálogo global (spec §7.2). Idempotente e aditivo: nunca remove linhas;
 * não toca em linhas LOCAL nem em perfis fiscais já verificados; definições que saíram do
 * catálogo ganham deprecatedAt. Chame dentro de uma transação.
 */
export async function applyCatalog(db: CatalogDb, catalog: Catalog): Promise<void> {
  const errors = validateCatalog(catalog);
  if (errors.length) throw new Error(`Catálogo inválido:\n- ${errors.join('\n- ')}`);

  // Componentes: pais antes dos filhos.
  const componentId = new Map<string, string>();
  const pending = [...catalog.components];
  while (pending.length) {
    const ready = pending.filter((c) => !c.parentCode || componentId.has(c.parentCode));
    for (const c of ready) {
      const data = { name: c.name, parentId: c.parentCode ? componentId.get(c.parentCode)! : null };
      const row = await db.vehicleComponent.upsert({ where: { code: c.code }, create: { code: c.code, ...data }, update: data });
      componentId.set(c.code, row.id);
      pending.splice(pending.indexOf(c), 1);
    }
  }

  // Perfis fiscais: um perfil já verificado por contador não é sobrescrito.
  const profileId = new Map<string, string>();
  for (const p of catalog.fiscalProfiles) {
    const data = {
      lc116Item: p.lc116Item,
      nbs: p.nbs ?? null,
      cnae: p.cnae ?? null,
      issWithheld: p.issWithheld,
      verified: p.verified,
    };
    const existing = await db.serviceFiscalProfile.findUnique({ where: { code: p.code } });
    if (!existing) {
      profileId.set(p.code, (await db.serviceFiscalProfile.create({ data: { code: p.code, ...data } })).id);
    } else {
      profileId.set(p.code, existing.id);
      if (!existing.verified) await db.serviceFiscalProfile.update({ where: { id: existing.id }, data });
    }
  }

  // Definições: linhas LOCAL com o mesmo código são respeitadas.
  const definitionId = new Map<string, string>();
  for (const d of catalog.definitions) {
    const data = {
      action: d.action,
      componentId: componentId.get(d.componentCode)!,
      nfseTextTemplate: d.nfseTextTemplate ?? null,
      fiscalProfileId: d.fiscalProfileCode ? profileId.get(d.fiscalProfileCode)! : null,
      catalogVersion: catalog.version,
      deprecatedAt: null,
    };
    const existing = await db.serviceDefinition.findUnique({ where: { code: d.code } });
    if (!existing) {
      const created = await db.serviceDefinition.create({ data: { code: d.code, origin: 'GLOBAL', ...data } });
      definitionId.set(d.code, created.id);
    } else {
      definitionId.set(d.code, existing.id);
      if (existing.origin === 'GLOBAL') await db.serviceDefinition.update({ where: { id: existing.id }, data });
    }
  }
  await db.serviceDefinition.updateMany({
    where: { origin: 'GLOBAL', deprecatedAt: null, code: { notIn: catalog.definitions.map((d) => d.code) } },
    data: { deprecatedAt: new Date() },
  });

  // Variantes: MAKE antes de MODEL etc.
  const variantId = new Map<string, string>();
  for (const v of [...catalog.variants].sort((a, b) => LEVEL_ORDER[a.level] - LEVEL_ORDER[b.level])) {
    const data = {
      level: v.level,
      parentId: v.parentKey ? variantId.get(v.parentKey)! : null,
      make: v.make,
      model: v.model ?? null,
      engine: v.engine ?? null,
      fuel: v.fuel ?? null,
      fipeCode: v.fipeCode ?? null,
    };
    const row = await db.vehicleVariant.upsert({ where: { key: v.key }, create: { key: v.key, origin: 'GLOBAL', ...data }, update: data });
    variantId.set(v.key, row.id);
  }

  // Peças sugeridas. (variantKey nulo não funciona em chave composta do Prisma, daí findFirst.)
  for (const p of catalog.suggestedParts) {
    const where = {
      serviceDefinitionId: definitionId.get(p.definitionCode)!,
      variantKey: p.variantKey ?? null,
      partCategory: p.partCategory,
    };
    const data = { quantity: p.quantity, optional: p.optional };
    const existing = await db.serviceSuggestedPart.findFirst({ where });
    if (existing) await db.serviceSuggestedPart.update({ where: { id: existing.id }, data });
    else await db.serviceSuggestedPart.create({ data: { ...where, ...data } });
  }

  await db.catalogState.upsert({
    where: { id: 1 },
    create: { id: 1, version: catalog.version, appliedAt: new Date() },
    update: { version: catalog.version, appliedAt: new Date() },
  });
}
