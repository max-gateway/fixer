import { describe, expect, it } from 'vitest';
import { catalog } from '../index.js';
import { validateCatalog } from './validate.js';

describe('integridade do catálogo embarcado', () => {
  it('passa na validação', () => {
    expect(validateCatalog(catalog)).toEqual([]);
  });

  it('o código da definição é ACTION:COMPONENTE', () => {
    for (const d of catalog.definitions) expect(d.code).toBe(`${d.action}:${d.componentCode}`);
  });

  it('traz SUBSTITUIR:EMBREAGEM_KIT com perfil fiscal LC 116 14.01 não verificado', () => {
    const def = catalog.definitions.find((d) => d.code === 'SUBSTITUIR:EMBREAGEM_KIT');
    expect(def).toBeDefined();
    const profile = catalog.fiscalProfiles.find((p) => p.code === def!.fiscalProfileCode);
    expect(profile).toMatchObject({ lc116Item: '14.01', nbs: '1.2001.31.00', verified: false });
  });

  it('não traz nenhuma estimativa de horas (sem seed)', () => {
    expect(JSON.stringify(catalog)).not.toMatch(/hours|horas/i);
  });

  it('a embreagem tem disco, platô e rolamento como peças obrigatórias', () => {
    const required = catalog.suggestedParts
      .filter((p) => p.definitionCode === 'SUBSTITUIR:EMBREAGEM_KIT' && !p.optional)
      .map((p) => p.partCategory)
      .sort();
    expect(required).toEqual(['DISCO_EMBREAGEM', 'PLATO_EMBREAGEM', 'ROLAMENTO_EMBREAGEM']);
  });
});

describe('validateCatalog', () => {
  const base = () => structuredClone(catalog);

  it('detecta componente pai inexistente', () => {
    const c = base();
    c.components.push({ code: 'X', name: 'X', parentCode: 'NAO_EXISTE' });
    expect(validateCatalog(c).join('\n')).toMatch(/NAO_EXISTE/);
  });

  it('detecta ciclo na árvore de componentes', () => {
    const c = base();
    c.components.push({ code: 'A', name: 'A', parentCode: 'B' }, { code: 'B', name: 'B', parentCode: 'A' });
    expect(validateCatalog(c).join('\n')).toMatch(/ciclo/i);
  });

  it('detecta código de definição que não bate com ação:componente', () => {
    const c = base();
    c.definitions[0].code = 'ERRADO';
    expect(validateCatalog(c).join('\n')).toMatch(/ERRADO/);
  });

  it('detecta perfil fiscal inexistente e peça sugerida órfã', () => {
    const c = base();
    c.definitions[0].fiscalProfileCode = 'SEM_PERFIL';
    c.suggestedParts.push({ definitionCode: 'NADA', partCategory: 'Z', quantity: 1, optional: false });
    const errors = validateCatalog(c).join('\n');
    expect(errors).toMatch(/SEM_PERFIL/);
    expect(errors).toMatch(/NADA/);
  });

  it('detecta duplicidade de códigos', () => {
    const c = base();
    c.components.push({ ...c.components[0] });
    expect(validateCatalog(c).join('\n')).toMatch(/duplicad/i);
  });

  it('detecta variante MODEL cujo pai MAKE não existe', () => {
    const c = base();
    c.variants.push({ level: 'MODEL', key: 'zzz/modelo', parentKey: 'zzz', make: 'zzz', model: 'modelo' });
    expect(validateCatalog(c).join('\n')).toMatch(/zzz/);
  });
});
