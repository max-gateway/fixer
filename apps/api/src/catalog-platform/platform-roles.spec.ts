import { PLATFORM_ONLY_SCOPES, PLATFORM_ROLE_SCOPES, ROLES } from '@max-gateway/auth';
import { describe, expect, it } from 'vitest';
import { PERMISSIONS } from '../auth/permissions.catalog.js';
import { platformRolesFor } from './platform-roles.js';

describe('platformRolesFor (papéis de negócio do Fixer → papéis da plataforma)', () => {
  it('quem não tem permissão de negócio ainda consulta o catálogo (viewer)', () => {
    expect(platformRolesFor([])).toEqual(['viewer']);
  });

  it('lançar nota de compra dá estoque (stockist)', () => {
    expect(platformRolesFor(['invoices.reconcile'])).toEqual(['stockist']);
  });

  it('definir preço dá preço (price_manager), que inclui o estoque', () => {
    expect(platformRolesFor(['pricing.write'])).toEqual(['price_manager']);
    expect(platformRolesFor(['invoices.reconcile', 'pricing.write'])).toEqual(['price_manager']);
  });

  it('permissão sem relação com catálogo nunca eleva (acesso, fiscal, contas a pagar)', () => {
    for (const key of ['access.manage', 'access.read', 'fiscal.manage', 'fiscal.verify', 'payables.pay', 'pricing.read', 'invoices.read']) {
      expect(platformRolesFor([key])).toEqual(['viewer']);
    }
  });

  it('permissão desconhecida não concede nada', () => {
    expect(platformRolesFor(['inventada.tudo', 'admin'])).toEqual(['viewer']);
  });

  it('aceita Set e array, e devolve sempre um único papel da plataforma', () => {
    expect(platformRolesFor(new Set(['pricing.write']))).toEqual(['price_manager']);
    for (const key of PERMISSIONS.map((p) => p.key)) {
      const roles = platformRolesFor([key]);
      expect(roles).toHaveLength(1);
      expect(ROLES).toContain(roles[0]);
    }
  });

  it('nenhum papel devolvido concede escopo exclusivo da plataforma', () => {
    const roles = platformRolesFor(PERMISSIONS.map((p) => p.key));
    const scopes = roles.flatMap((r) => [...PLATFORM_ROLE_SCOPES[r]!]);
    for (const only of PLATFORM_ONLY_SCOPES) expect(scopes).not.toContain(only);
  });
});
