import { CatalogLinkCard } from './catalog-link-card';

export const metadata = { title: 'Catálogo' };

// A permissão (`catalog.link`) é conferida pela API: sem ela, verificar responde com a mensagem pronta e o cartão a mostra.
export default function CatalogoPage() {
  return (
    <section className="space-y-5">
      <h1 className="text-2xl font-semibold tracking-tight">Catálogo de peças</h1>
      <CatalogLinkCard />
    </section>
  );
}
