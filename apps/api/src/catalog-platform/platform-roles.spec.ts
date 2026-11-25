import { PLATFORM_ONLY_SCOPES, PLATFORM_ROLE_SCOPES } from '@max-gateway/auth';
import { describe, expect, it } from 'vitest';
import { PERMISSIONS } from '../auth/permissions.catalog.js';
import { platformRolesFor } from './platform-roles.js';

/** Papéis fiscais da plataforma e o que cada um concede (docs/specs/parts-search-fiscal.md §5; `fiscal-roles.ts` no parts-search). */
const FISCAL_ROLE_SCOPES: Record<string, string[]> = {
  fiscal_editor: ['fiscal:read', 'fiscal:write'],
  accountant: ['fiscal:read', 'fiscal:review'],
};
const scopesOf = (roles: string[]) => roles.flatMap((r) => [...(PLATFORM_ROLE_SCOPES[r] ?? []), ...(FISCAL_ROLE_SCOPES[r] ?? [])]);

describe('platformRolesFor (papéis de negócio do Fixer → papéis da plataforma)', () => {
  it('quem não tem permissão de negócio ainda consulta o catálogo (viewer), sem papel fiscal', () => {
    expect(platformRolesFor([])).toEqual(['viewer']);
  });

  it('lançar nota de compra dá estoque (stockist) e a classificação fiscal da peça (fiscal_editor)', () => {
    expect(platformRolesFor(['invoices.reconcile'])).toEqual(['stockist', 'fiscal_editor']);
  });

  it('definir preço dá preço (price_manager), que inclui o estoque, e a classificação fiscal', () => {
    expect(platformRolesFor(['pricing.write'])).toEqual(['price_manager', 'fiscal_editor']);
    expect(platformRolesFor(['invoices.reconcile', 'pricing.write'])).toEqual(['price_manager', 'fiscal_editor']);
  });

  it('confirmar dados fiscais (o contador) dá o aceite (accountant), sem dar escrita de oferta', () => {
    expect(platformRolesFor(['fiscal.verify'])).toEqual(['viewer', 'accountant']);
    expect(platformRolesFor(['invoices.reconcile', 'fiscal.verify'])).toEqual(['stockist', 'fiscal_editor', 'accountant']);
  });

  it('permissão sem relação com catálogo nunca eleva (acesso, configuração fiscal, contas a pagar)', () => {
    for (const key of ['access.manage', 'access.read', 'fiscal.manage', 'payables.pay', 'pricing.read', 'invoices.read']) {
      expect(platformRolesFor([key]), key).toEqual(['viewer']);
    }
  });

  it('permissão desconhecida não concede nada', () => {
    expect(platformRolesFor(['inventada.tudo', 'admin'])).toEqual(['viewer']);
  });

  it('aceita Set e array; exatamente um papel de catálogo/oferta, mais os fiscais que couberem', () => {
    expect(platformRolesFor(new Set(['pricing.write']))).toEqual(['price_manager', 'fiscal_editor']);
    for (const key of PERMISSIONS.map((p) => p.key)) {
      const roles = platformRolesFor([key]);
      expect(roles.filter((r) => ['viewer', 'stockist', 'price_manager'].includes(r))).toHaveLength(1);
    }
  });

  it('nenhum papel devolvido concede escopo exclusivo da plataforma, nem a curadoria fiscal (fiscal:admin)', () => {
    const scopes = scopesOf(platformRolesFor(PERMISSIONS.map((p) => p.key)));
    for (const only of [...PLATFORM_ONLY_SCOPES, 'fiscal:admin']) expect(scopes).not.toContain(only);
    expect(scopes).toEqual(expect.arrayContaining(['fiscal:read', 'fiscal:write', 'fiscal:review']));
  });
});
