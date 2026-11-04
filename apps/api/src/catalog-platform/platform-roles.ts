/**
 * Papéis da PLATAFORMA que o Fixer informa para cada pessoa (docs/specs/parts-search-integration.md §4 e docs/specs/parts-search-fiscal.md §5). Os papéis
 * de negócio do Fixer (permissões em `auth/permissions.catalog.ts`) são mapeados aqui, e só aqui; quem traduz papel em escopo é a plataforma, com o mesmo
 * mapa para todo produto.
 *
 * Catálogo e ofertas (cada papel inclui o anterior, então basta o mais alto):
 *  - `price_manager`: quem define preço de venda (`pricing.write`);
 *  - `stockist`: quem lança nota de compra e, com ela, dá entrada no estoque (`invoices.reconcile`);
 *  - `viewer`: qualquer outra pessoa da oficina consulta o catálogo.
 *
 * Classificação fiscal da peça (escopos `fiscal:*` da plataforma, sempre do PRÓPRIO tenant):
 *  - `fiscal_editor`: quem lança nota ou define preço também classifica a peça da oficina (hoje já edita `Part.ncm`) e envia a evidência das notas de entrada;
 *  - `accountant`: quem confirma dados fiscais (`fiscal.verify`, o contador) aceita a classificação; o aceite carrega a referência dele.
 * `fiscal:admin` (curadoria do cadastro GLOBAL) NUNCA é de papel de oficina: é escopo de plataforma. Permissão desconhecida ou sem relação nunca eleva.
 */
export function platformRolesFor(permissions: Iterable<string>): string[] {
  const has = new Set(permissions);
  const roles: string[] = [];
  if (has.has('pricing.write')) roles.push('price_manager');
  else if (has.has('invoices.reconcile')) roles.push('stockist');
  else roles.push('viewer');
  if (has.has('pricing.write') || has.has('invoices.reconcile')) roles.push('fiscal_editor');
  if (has.has('fiscal.verify')) roles.push('accountant');
  return roles;
}
