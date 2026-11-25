import { describe, expect, it } from 'vitest';
import { catalog } from '../index.js';
import { applyCatalog, type CatalogDb } from './apply.js';

/** Banco em memória: tabelas indexadas por uma chave natural, com ids sequenciais. */
function fakeDb() {
  let seq = 0;
  const tables: Record<string, Map<string, any>> = {};
  const calls: string[] = [];
  const table = (name: string) => (tables[name] ??= new Map());
  const keyOf = (name: string, row: any) =>
    name === 'serviceSuggestedPart' ? `${row.serviceDefinitionId}|${row.variantKey ?? ''}|${row.partCategory}` : (row.code ?? row.key ?? String(row.id));

  const model = (name: string, naturalKey: string | null) => ({
    findUnique: async ({ where }: any) => {
      calls.push(`${name}.findUnique`);
      const v = Object.values(where)[0] as string;
      return [...table(name).values()].find((r) => r[naturalKey ?? 'id'] === v || r.id === v) ?? null;
    },
    findFirst: async ({ where }: any) => {
      calls.push(`${name}.findFirst`);
      return [...table(name).values()].find((r) => Object.entries(where).every(([k, v]) => (r[k] ?? null) === v)) ?? null;
    },
    findMany: async () => [...table(name).values()],
    create: async ({ data }: any) => {
      calls.push(`${name}.create`);
      const row = { id: `id${++seq}`, ...data };
      table(name).set(keyOf(name, row), row);
      return row;
    },
    update: async ({ where, data }: any) => {
      calls.push(`${name}.update`);
      const row = [...table(name).values()].find((r) => r.id === where.id || r[naturalKey!] === Object.values(where)[0])!;
      Object.assign(row, data);
      return row;
    },
    updateMany: async ({ where, data }: any) => {
      calls.push(`${name}.updateMany`);
      let count = 0;
      for (const r of table(name).values()) {
        if (Object.entries(where).every(([k, v]) => (typeof v === 'object' && v && 'notIn' in (v as any) ? !(v as any).notIn.includes(r[k]) : r[k] === v))) {
          Object.assign(r, data);
          count++;
        }
      }
      return { count };
    },
    upsert: async ({ where, create, update }: any) => {
      const v = Object.values(where)[0] as string;
      const existing = [...table(name).values()].find((r) => r[naturalKey!] === v);
      calls.push(`${name}.upsert`);
      if (existing) return Object.assign(existing, update);
      const row = { id: `id${++seq}`, ...create };
      table(name).set(keyOf(name, row), row);
      return row;
    },
  });

  const db = {
    vehicleComponent: model('vehicleComponent', 'code'),
    serviceFiscalProfile: model('serviceFiscalProfile', 'code'),
    serviceDefinition: model('serviceDefinition', 'code'),
    vehicleVariant: model('vehicleVariant', 'key'),
    serviceSuggestedPart: model('serviceSuggestedPart', null),
    catalogState: model('catalogState', 'id'),
  } as unknown as CatalogDb;

  const snapshot = () =>
    // appliedAt muda a cada execução por definição; o resto do estado deve ser idêntico.
    JSON.stringify(Object.fromEntries(Object.entries(tables).map(([k, m]) => [k, [...m.values()].map(({ id, ...r }) => r)])), (k, v) =>
      k === 'appliedAt' ? 'DATE' : v,
    );
  return { db, tables, calls, snapshot, table };
}

describe('applyCatalog', () => {
  it('cria componentes (pais antes dos filhos), perfil, definições, variantes e peças sugeridas', async () => {
    const { db, table } = fakeDb();
    await applyCatalog(db, catalog);
    expect(table('vehicleComponent').size).toBe(catalog.components.length);
    const kit = table('vehicleComponent').get('EMBREAGEM_KIT');
    const embreagem = table('vehicleComponent').get('EMBREAGEM');
    expect(kit.parentId).toBe(embreagem.id);
    const def = table('serviceDefinition').get('SUBSTITUIR:EMBREAGEM_KIT');
    expect(def).toMatchObject({ action: 'SUBSTITUIR', origin: 'GLOBAL', catalogVersion: catalog.version });
    expect(def.componentId).toBe(kit.id);
    expect(table('serviceFiscalProfile').get('LC116_14_01').verified).toBe(false);
    expect(table('vehicleVariant').size).toBe(catalog.variants.length);
    expect(table('serviceSuggestedPart').size).toBe(catalog.suggestedParts.length);
    expect(table('catalogState').size).toBe(1);
  });

  it('é idempotente: aplicar 2x deixa o estado idêntico', async () => {
    const { db, snapshot } = fakeDb();
    await applyCatalog(db, catalog);
    const first = snapshot();
    await applyCatalog(db, catalog);
    expect(snapshot()).toBe(first);
  });

  it('nunca remove nada', async () => {
    const { db, calls } = fakeDb();
    await applyCatalog(db, catalog);
    await applyCatalog(db, catalog);
    expect(calls.filter((c) => /delete/i.test(c))).toEqual([]);
  });

  it('não sobrescreve um perfil fiscal já verificado pelo contador', async () => {
    const { db, table } = fakeDb();
    await applyCatalog(db, catalog);
    Object.assign(table('serviceFiscalProfile').get('LC116_14_01'), { verified: true, nbs: '1.2001.99.99' });
    await applyCatalog(db, catalog);
    expect(table('serviceFiscalProfile').get('LC116_14_01')).toMatchObject({ verified: true, nbs: '1.2001.99.99' });
  });

  it('não toca em definições LOCAL com o mesmo código', async () => {
    const { db, table } = fakeDb();
    await applyCatalog(db, catalog);
    Object.assign(table('serviceDefinition').get('SUBSTITUIR:EMBREAGEM_KIT'), { origin: 'LOCAL', nfseTextTemplate: 'meu texto' });
    await applyCatalog(db, catalog);
    expect(table('serviceDefinition').get('SUBSTITUIR:EMBREAGEM_KIT')).toMatchObject({ origin: 'LOCAL', nfseTextTemplate: 'meu texto' });
  });

  it('marca como deprecated (sem apagar) definições GLOBAL que saíram do catálogo', async () => {
    const { db, table } = fakeDb();
    await applyCatalog(db, catalog);
    table('serviceDefinition').set('REMOVER:ANTIGO', {
      id: 'old', code: 'REMOVER:ANTIGO', origin: 'GLOBAL', deprecatedAt: null,
    });
    table('serviceDefinition').set('LOCAL:X', { id: 'loc', code: 'LOCAL:X', origin: 'LOCAL', deprecatedAt: null });
    await applyCatalog(db, catalog);
    expect(table('serviceDefinition').get('REMOVER:ANTIGO').deprecatedAt).toBeInstanceOf(Date);
    expect(table('serviceDefinition').get('LOCAL:X').deprecatedAt).toBeNull();
    expect(table('serviceDefinition').get('SUBSTITUIR:EMBREAGEM_KIT').deprecatedAt ?? null).toBeNull();
  });

  it('rejeita um catálogo inválido sem escrever nada', async () => {
    const { db, calls } = fakeDb();
    const bad = structuredClone(catalog);
    bad.definitions[0].fiscalProfileCode = 'SEM_PERFIL';
    await expect(applyCatalog(db, bad)).rejects.toThrow(/SEM_PERFIL/);
    expect(calls).toEqual([]);
  });
});
