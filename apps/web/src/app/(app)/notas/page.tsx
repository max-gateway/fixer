import { FileDown, FileText, Settings, TriangleAlert } from 'lucide-react';
import Link from 'next/link';
import { Badge } from '@/components/ui/badge';
import { buttonVariants } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ApiError, apiGet } from '@/lib/api';
import { describeInvoice, formatCnpj, money, shortDate, VIEW_LABEL, VIEWS, type InvoiceRow, type View } from '@/lib/invoices';
import { cn } from '@/lib/utils';

export const metadata = { title: 'Notas de compra' };

type Listing = { total: number; items: InvoiceRow[] };

function href(view: View, q?: string) {
  const p = new URLSearchParams();
  if (view !== 'pending') p.set('view', view);
  if (q) p.set('q', q);
  const s = p.toString();
  return s ? `/notas?${s}` : '/notas';
}

export default async function NotasPage({ searchParams }: { searchParams: Promise<{ view?: string; q?: string }> }) {
  const sp = await searchParams;
  const view: View = (VIEWS as readonly string[]).includes(sp.view ?? '') ? (sp.view as View) : 'pending';
  const q = sp.q?.trim() || undefined;

  let listing: Listing;
  let counts: Record<View, number>;
  try {
    const params = new URLSearchParams({ view });
    if (q) params.set('q', q);
    [listing, counts] = await Promise.all([apiGet<Listing>(`/invoices?${params}`), apiGet<Record<View, number>>('/invoices/summary')]);
  } catch (err) {
    const denied = err instanceof ApiError && err.status === 403;
    return (
      <section className="space-y-5">
        <Header />
        <div role="alert" className="flex items-start gap-3 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-900">
          <TriangleAlert aria-hidden className="mt-0.5 size-4 shrink-0" />
          <div>
            <p className="font-semibold">{denied ? 'Você não tem permissão para ver as notas de compra.' : 'Não foi possível carregar as notas.'}</p>
            <p>{denied ? 'Peça a um administrador a permissão "invoices.read".' : 'Verifique sua conexão e recarregue a página.'}</p>
          </div>
        </div>
      </section>
    );
  }

  return (
    <section className="space-y-5">
      <Header />

      <nav aria-label="Filtrar notas" className="-mx-1 flex gap-1 overflow-x-auto px-1 pb-1">
        {VIEWS.map((v) => (
          <Link
            key={v}
            href={href(v, q)}
            aria-current={v === view ? 'page' : undefined}
            className={cn(
              'inline-flex shrink-0 items-center gap-1.5 rounded-full border px-3 py-1.5 text-sm font-medium transition-colors',
              v === view ? 'border-brand bg-brand text-white' : 'bg-card hover:bg-muted',
            )}
          >
            {VIEW_LABEL[v]}
            <span className={cn('tabular text-xs', v === view ? 'text-white/85' : 'text-muted-foreground')}>{counts[v]}</span>
          </Link>
        ))}
      </nav>

      <form action="/notas" className="flex gap-2">
        {view !== 'pending' && <input type="hidden" name="view" value={view} />}
        <Input
          name="q"
          type="search"
          defaultValue={q}
          placeholder="Buscar por fornecedor, CNPJ, número ou chave"
          aria-label="Buscar notas"
          className="h-11 text-[15px]"
        />
        <button className={buttonVariants({ variant: 'outline', size: 'lg' })}>Buscar</button>
      </form>

      {listing.items.length === 0 ? (
        <Empty view={view} filtered={Boolean(q)} />
      ) : (
        <div>
          <p className="mb-2 text-xs text-muted-foreground" aria-live="polite">
            {listing.total} {listing.total === 1 ? 'nota' : 'notas'}
            {listing.total > listing.items.length && ` (mostrando ${listing.items.length})`}
          </p>
          <ul className="divide-y overflow-hidden rounded-xl border bg-card shadow-xs">
            {listing.items.map((n) => (
              <InvoiceItem key={n.id} n={n} />
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}

function Header() {
  return (
    <header className="flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Notas de compra</h1>
        <p className="text-sm text-muted-foreground">NF-e emitidas contra o CNPJ da oficina, buscadas automaticamente na SEFAZ.</p>
      </div>
      <Link href="/configuracoes" className={buttonVariants({ variant: 'outline', size: 'sm' })}>
        <Settings aria-hidden /> Cadastro
      </Link>
    </header>
  );
}

function InvoiceItem({ n }: { n: InvoiceRow }) {
  const s = describeInvoice(n);
  return (
    <li>
      <Link
        href={`/notas/${n.id}`}
        className="grid grid-cols-[1fr_auto] items-center gap-x-4 gap-y-1 px-4 py-3.5 transition-colors hover:bg-muted/60 focus-visible:bg-muted/60 sm:grid-cols-[minmax(0,1.6fr)_7rem_6rem_auto] sm:py-3"
      >
        <span className="min-w-0">
          <span className="block truncate text-sm font-medium">{n.issuerName || 'Fornecedor não identificado'}</span>
          <span className="block truncate text-xs text-muted-foreground">
            {formatCnpj(n.issuerCnpj)}
            {n.number != null && ` · NF ${n.number}${n.series != null ? `/${n.series}` : ''}`}
          </span>
        </span>
        <Badge variant={s.tone} className="col-start-2 row-start-1 justify-self-end sm:col-start-4">
          {s.label}
        </Badge>
        <span className="tabular text-sm font-medium sm:text-right">{money(n.totalAmount)}</span>
        <span className="tabular text-xs text-muted-foreground sm:text-sm">
          {shortDate(n.issuedAt)}
          {n.status === 'FULL' && n.unresolvedCount > 0 && <span className="ml-2 font-medium text-amber-800">{n.unresolvedCount} sem peça</span>}
          {n.manifestError && <span className="ml-2 font-medium text-red-800">ciência rejeitada</span>}
        </span>
      </Link>
    </li>
  );
}

const EMPTY: Record<View, { title: string; hint: string }> = {
  pending: { title: 'Nada para conciliar', hint: 'Quando chegar uma nota com itens ainda sem peça, ela aparece aqui.' },
  ready: { title: 'Nenhuma nota pronta', hint: 'Notas com todos os itens vinculados aparecem aqui, prontas para lançar no estoque.' },
  posted: { title: 'Nenhuma nota lançada', hint: 'As entradas já lançadas no estoque ficam aqui.' },
  summary: { title: 'Nenhuma nota sem XML', hint: 'Notas que só chegaram como resumo, aguardando a ciência da operação.' },
  canceled: { title: 'Nenhuma nota cancelada', hint: 'Notas canceladas pelo fornecedor aparecem aqui.' },
  ignored: { title: 'Nenhuma nota ignorada', hint: 'Notas que não são compras para o CNPJ da oficina aparecem aqui.' },
  all: { title: 'Nenhuma nota ainda', hint: 'Em "Importação", cadastre o CNPJ e envie o certificado digital para buscar as notas automaticamente.' },
};

function Empty({ view, filtered }: { view: View; filtered: boolean }) {
  const e = filtered ? { title: 'Nenhuma nota com essa busca', hint: 'Tente outro termo ou troque de aba.' } : EMPTY[view];
  return (
    <div className="grid place-items-center gap-3 rounded-xl border border-dashed bg-card/60 px-6 py-16 text-center">
      <span className="grid size-12 place-items-center rounded-full bg-muted text-muted-foreground">
        {view === 'all' ? <FileDown aria-hidden className="size-6" /> : <FileText aria-hidden className="size-6" />}
      </span>
      <div>
        <p className="font-semibold">{e.title}</p>
        <p className="max-w-md text-sm text-muted-foreground">{e.hint}</p>
      </div>
    </div>
  );
}
