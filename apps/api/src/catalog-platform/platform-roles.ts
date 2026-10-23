import type { Role } from '@max-gateway/auth';

/**
 * Papel da PLATAFORMA que o Fixer informa para cada pessoa (docs/specs/parts-search-integration.md §4). Os papéis de negócio do Fixer
 * (permissões em `auth/permissions.catalog.ts`) são mapeados aqui, e só aqui; quem traduz papel em escopo é o `@max-gateway/auth`
 * (`PLATFORM_ROLE_SCOPES`), com o mesmo mapa para todo produto.
 *
 * Cada papel da plataforma inclui o anterior, então basta devolver o mais alto:
 *  - `price_manager`: quem define preço de venda (`pricing.write`);
 *  - `stockist`: quem lança nota de compra e, com ela, dá entrada no estoque (`invoices.reconcile`);
 *  - `viewer`: qualquer outra pessoa da oficina consulta o catálogo.
 * Permissão desconhecida ou sem relação com catálogo (acesso, fiscal, contas a pagar) nunca eleva.
 */
export function platformRolesFor(permissions: Iterable<string>): Role[] {
  const has = new Set(permissions);
  if (has.has('pricing.write')) return ['price_manager'];
  if (has.has('invoices.reconcile')) return ['stockist'];
  return ['viewer'];
}
