import { Suspense } from 'react';
import { MarketplaceCard } from './marketplace-card';

export const metadata = { title: 'Marketplaces' };

// As permissões (`marketplace.read` e `marketplace.manage`) e o direito do plano são conferidos pela API: sem eles a lista responde com a mensagem pronta e o cartão a mostra.
export default function MarketplacesPage() {
  return (
    <section className="space-y-5">
      <h1 className="text-2xl font-semibold tracking-tight">Marketplaces</h1>
      <Suspense>
        <MarketplaceCard />
      </Suspense>
    </section>
  );
}
