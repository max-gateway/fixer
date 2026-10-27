'use client';

import { ArrowRight, Barcode, Car, History, PackageSearch, Repeat2, SearchX } from 'lucide-react';
import { Button } from '@/components/ui/button';

export const EXAMPLES = ['bieleta estabilizadora', 'pastilha de freio dianteira', 'filtro de óleo', 'amortecedor traseiro', '7891234567890'];

export function NoResults({ query, filtered, onClear, onExample }: { query: string; filtered: boolean; onClear: () => void; onExample: (q: string) => void }) {
  return (
    <div className="rounded-2xl border bg-card p-8 text-center">
      <SearchX aria-hidden className="mx-auto mb-3 size-8 text-muted-foreground" />
      <p className="font-semibold">{query.trim() ? `Nada encontrado para “${query.trim()}”` : 'Nenhuma peça para este veículo'}</p>
      <p className="mx-auto mt-1 max-w-md text-sm text-muted-foreground">
        {filtered ? 'Os filtros podem estar escondendo resultados.' : 'Confira a grafia, tente só parte do nome ou o código sem hífen.'}
      </p>
      <div className="mt-4 flex flex-wrap justify-center gap-2">
        {filtered && (
          <Button size="sm" onClick={onClear}>
            Limpar filtros
          </Button>
        )}
        {EXAMPLES.slice(0, 3).map((e) => (
          <Button key={e} size="sm" variant="outline" onClick={() => onExample(e)}>
            {e}
          </Button>
        ))}
      </div>
    </div>
  );
}

const TIPS = [
  { icon: Repeat2, title: 'Equivalentes', text: 'Mesma peça em outras marcas, pelos códigos de cross-reference.' },
  { icon: Car, title: 'Compatibilidade', text: 'Onde a peça serve, por montadora, modelo e ano.' },
  { icon: Barcode, title: 'Código de barras', text: 'Digite o GTIN ou leia a caixa com a câmera.' },
  { icon: History, title: 'Na oficina', text: 'Saldo, preço de venda e histórico de compra e uso.' },
];

export function Welcome({ recents, onPick }: { recents: string[]; onPick: (q: string) => void }) {
  return (
    <div className="space-y-6 pt-1">
      <div className="space-y-2">
        <p className="text-sm font-medium text-muted-foreground">{recents.length > 0 ? 'Continue de onde parou' : 'Experimente buscar'}</p>
        <div className="flex flex-wrap gap-2">
          {(recents.length > 0 ? recents : EXAMPLES).map((q) => (
            <button key={q} type="button" onClick={() => onPick(q)} className="group inline-flex items-center gap-2 rounded-full border bg-card px-3 py-1 text-sm hover:border-ring/50 hover:bg-accent">
              {q}
              <ArrowRight aria-hidden className="size-3.5 text-muted-foreground transition-transform group-hover:translate-x-0.5 group-hover:text-brand" />
            </button>
          ))}
        </div>
      </div>
      <ul className="grid divide-y rounded-xl border bg-card sm:grid-cols-2 sm:divide-y-0 lg:grid-cols-4 lg:divide-x">
        {TIPS.map(({ icon: Icon, title, text }) => (
          <li key={title} className="flex items-start gap-3 p-4">
            <Icon aria-hidden className="mt-0.5 size-4 shrink-0 text-brand" />
            <div>
              <p className="text-sm font-semibold">{title}</p>
              <p className="mt-0.5 text-xs text-muted-foreground">{text}</p>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** "Minha oficina" sem nenhuma peça que case. */
export function NoWorkshopParts({ filtered, onClear, onCatalog }: { filtered: boolean; onClear: () => void; onCatalog: () => void }) {
  return (
    <div className="rounded-2xl border bg-card p-8 text-center">
      <PackageSearch aria-hidden className="mx-auto mb-3 size-8 text-muted-foreground" />
      <p className="font-semibold">{filtered ? 'Nenhuma peça da oficina com esses filtros' : 'Nenhuma peça do catálogo cadastrada na oficina'}</p>
      <p className="mx-auto mt-1 max-w-md text-sm text-muted-foreground">Busque no catálogo e use “Cadastrar” na peça para ela aparecer aqui, com saldo e preço.</p>
      <div className="mt-4 flex flex-wrap justify-center gap-2">
        {filtered && (
          <Button size="sm" variant="outline" onClick={onClear}>
            Limpar filtros
          </Button>
        )}
        <Button size="sm" onClick={onCatalog}>
          Buscar no catálogo
        </Button>
      </div>
    </div>
  );
}
