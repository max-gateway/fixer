'use client';

import { ArrowRight, Barcode, CarFront, PackageSearch, Repeat2, SearchX, Warehouse } from 'lucide-react';
import { Button } from '@/components/ui/button';

export const EXAMPLES = ['bieleta estabilizadora', 'pastilha de freio dianteira', 'filtro de óleo', 'amortecedor traseiro'];

/** Busca no catálogo (ou lista do veículo) sem nada. */
export function NoResults({ query, vehicle, filtered, onClear, onExample }: { query: string; vehicle?: string; filtered: boolean; onClear: () => void; onExample: (q: string) => void }) {
  return (
    <div className="rounded-2xl border bg-card p-8 text-center">
      <SearchX aria-hidden className="mx-auto mb-3 size-8 text-muted-foreground" />
      <p className="font-semibold">{query.trim() ? `Nada encontrado para “${query.trim()}”${vehicle ? ` no ${vehicle}` : ''}` : `Nenhuma peça para o ${vehicle ?? 'veículo'}`}</p>
      <p className="mx-auto mt-1 max-w-md text-sm text-muted-foreground">
        {filtered ? 'Os filtros podem estar escondendo resultados.' : vehicle ? 'Tire o veículo para ver o catálogo inteiro, ou confira a grafia.' : 'Confira a grafia, tente só parte do nome ou o código sem hífen.'}
      </p>
      <div className="mt-4 flex flex-wrap justify-center gap-2">
        {filtered && (
          <Button size="sm" onClick={onClear}>
            Limpar filtros
          </Button>
        )}
        {!vehicle &&
          EXAMPLES.slice(0, 3).map((e) => (
            <Button key={e} size="sm" variant="outline" onClick={() => onExample(e)}>
              {e}
            </Button>
          ))}
      </div>
    </div>
  );
}

/** "Na oficina" ou "Com saldo" sem nada que case: a peça pode existir no catálogo e ainda não estar cadastrada. */
export function NoWorkshopParts({ query, stockOnly, onCatalog }: { query: string; stockOnly: boolean; onCatalog: () => void }) {
  const text = query.trim();
  return (
    <div className="rounded-2xl border bg-card p-8 text-center">
      <PackageSearch aria-hidden className="mx-auto mb-3 size-8 text-muted-foreground" />
      <p className="font-semibold">{text ? `Nada ${stockOnly ? 'com saldo ' : ''}na oficina para “${text}”` : stockOnly ? 'Nenhuma peça com saldo' : 'Nenhuma peça na oficina'}</p>
      <p className="mx-auto mt-1 max-w-md text-sm text-muted-foreground">A oficina procura pelo nome e pelo código interno. No catálogo inteiro a busca entende código, equivalentes e código de barras.</p>
      <Button size="sm" className="mt-4" onClick={onCatalog}>
        Buscar no catálogo inteiro <ArrowRight aria-hidden />
      </Button>
    </div>
  );
}

const TIPS = [
  { icon: CarFront, title: 'Pelo veículo', text: 'Escolha pela placa ou pelo modelo: a lista mostra só o que serve.' },
  { icon: Repeat2, title: 'Equivalentes', text: 'Mesma peça em outras marcas, pelos códigos de cross-reference.' },
  { icon: Barcode, title: 'Código de barras', text: 'Digite o GTIN ou leia a caixa com a câmera.' },
  { icon: Warehouse, title: 'Seu estoque junto', text: 'Cada peça diz se a oficina tem, quanto e por quanto vende.' },
];

/** Primeira vez: a oficina ainda não cadastrou nenhuma peça do catálogo, então não há estoque para abrir a tela. */
export function Welcome({ recents, onPick, onVehicle }: { recents: string[]; onPick: (q: string) => void; onVehicle: () => void }) {
  return (
    <div className="space-y-6 pt-1">
      <div className="rounded-2xl border bg-card p-6">
        <p className="font-semibold">O catálogo inteiro já está disponível: busque uma peça ou escolha o veículo</p>
        <p className="mt-1 max-w-xl text-sm text-muted-foreground">
          O estoque da oficina abre aqui assim que as peças entrarem pelas notas de compra, com saldo e preço.
        </p>
        <div className="mt-4 flex flex-wrap gap-2">
          <Button size="sm" onClick={onVehicle}>
            <CarFront aria-hidden /> Escolher veículo
          </Button>
          {(recents.length > 0 ? recents : EXAMPLES).slice(0, 5).map((q) => (
            <button key={q} type="button" onClick={() => onPick(q)} className="group inline-flex items-center gap-2 rounded-full border bg-background px-3 py-1 text-sm hover:border-ring/50 hover:bg-accent">
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
