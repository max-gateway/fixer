import type { Catalog } from './types.js';

const LEVEL_ORDER = { MAKE: 0, MODEL: 1, FAMILY: 2, VERSION: 3 } as const;

function duplicates(codes: string[]): string[] {
  const seen = new Set<string>();
  const dup = new Set<string>();
  for (const c of codes) (seen.has(c) ? dup : seen).add(c);
  return [...dup];
}

/** Devolve a lista de problemas encontrados; vazia = catálogo consistente. */
export function validateCatalog(c: Catalog): string[] {
  const errors: string[] = [];

  const groups: Array<[string, string[]]> = [
    ['componente', c.components.map((x) => x.code)],
    ['perfil fiscal', c.fiscalProfiles.map((x) => x.code)],
    ['definição', c.definitions.map((x) => x.code)],
    ['variante', c.variants.map((x) => x.key)],
  ];
  for (const [label, codes] of groups) {
    for (const d of duplicates(codes)) errors.push(`${label} duplicado: ${d}`);
  }

  const componentByCode = new Map(c.components.map((x) => [x.code, x]));
  for (const comp of c.components) {
    if (comp.parentCode && !componentByCode.has(comp.parentCode)) {
      errors.push(`componente ${comp.code}: pai inexistente (${comp.parentCode})`);
    }
  }
  for (const comp of c.components) {
    const visited = new Set<string>();
    let cur: string | undefined = comp.code;
    while (cur) {
      if (visited.has(cur)) {
        errors.push(`ciclo na árvore de componentes envolvendo ${comp.code}`);
        break;
      }
      visited.add(cur);
      cur = componentByCode.get(cur)?.parentCode;
    }
  }

  const profiles = new Set(c.fiscalProfiles.map((x) => x.code));
  const definitionCodes = new Set(c.definitions.map((x) => x.code));
  for (const d of c.definitions) {
    if (d.code !== `${d.action}:${d.componentCode}`) {
      errors.push(`definição ${d.code}: o código deve ser ${d.action}:${d.componentCode}`);
    }
    if (!componentByCode.has(d.componentCode)) {
      errors.push(`definição ${d.code}: componente inexistente (${d.componentCode})`);
    }
    if (d.fiscalProfileCode && !profiles.has(d.fiscalProfileCode)) {
      errors.push(`definição ${d.code}: perfil fiscal inexistente (${d.fiscalProfileCode})`);
    }
  }
  for (const p of c.suggestedParts) {
    if (!definitionCodes.has(p.definitionCode)) {
      errors.push(`peça sugerida ${p.partCategory}: definição inexistente (${p.definitionCode})`);
    }
  }

  const variantByKey = new Map(c.variants.map((v) => [v.key, v]));
  for (const v of c.variants) {
    if (v.level === 'MAKE') continue;
    const parent = v.parentKey ? variantByKey.get(v.parentKey) : undefined;
    if (!parent) errors.push(`variante ${v.key}: pai inexistente (${v.parentKey ?? 'sem pai'})`);
    else if (LEVEL_ORDER[parent.level] >= LEVEL_ORDER[v.level]) {
      errors.push(`variante ${v.key}: o pai ${parent.key} não é de nível superior`);
    }
  }
  return errors;
}
