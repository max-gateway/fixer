/** Lista de catálogos da plataforma que as oficinas do Fixer leem (`PARTS_SEARCH_CATALOGS`, separada por vírgula). Vazia = nenhum. */
export function parseCatalogList(raw: string | undefined): string[] {
  return (raw ?? '')
    .split(',')
    .map((c) => c.trim())
    .filter(Boolean);
}
