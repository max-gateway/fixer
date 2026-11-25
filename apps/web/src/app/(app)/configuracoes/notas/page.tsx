import { ArrowLeft, TriangleAlert } from 'lucide-react';
import Link from 'next/link';
import { ApiError, apiGet } from '@/lib/api';
import type { FiscalStatus } from '@/lib/fiscal-import';
import { CertificateCard } from './certificate-card';
import { CompanyForm } from './company-form';
import { SyncCard } from './sync-card';

export const metadata = { title: 'Importação de notas' };

export default async function ImportacaoNotasPage() {
  let status: FiscalStatus;
  try {
    status = await apiGet<FiscalStatus>('/fiscal/status');
  } catch (err) {
    const denied = err instanceof ApiError && err.status === 403;
    return (
      <section className="space-y-5">
        <Back />
        <div role="alert" className="flex items-start gap-3 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-900">
          <TriangleAlert aria-hidden className="mt-0.5 size-4 shrink-0" />
          <div>
            <p className="font-semibold">{denied ? 'Você não tem permissão para ver esta configuração.' : 'Não foi possível carregar a configuração.'}</p>
            {denied && <p>Peça a um administrador a permissão &quot;invoices.read&quot;.</p>}
          </div>
        </div>
      </section>
    );
  }

  const cnpjSaved = Boolean(status.settings?.cnpj);

  return (
    <section className="space-y-8">
      <div className="space-y-3">
        <Back />
        <header>
          <h1 className="text-2xl font-semibold tracking-tight">Importação de notas de compra</h1>
          <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
            O Fixer consulta a SEFAZ com o certificado digital da oficina e traz sozinho as NF-e emitidas contra o seu CNPJ. Você só confere os itens e lança no estoque.
          </p>
        </header>
      </div>

      <Step n={1} title="Certificado digital" done={Boolean(status.credential)}>
        <CertificateCard status={status} cnpjSaved={cnpjSaved} />
      </Step>

      {cnpjSaved && (
        <Step n={2} title="Dados da empresa" done>
          <CompanyForm key={`${status.settings?.cnpj}|${status.settings?.legalName}|${status.settings?.ufCode}`} initial={status.settings} locked={Boolean(status.credential)} />
        </Step>
      )}

      {status.credential && (
        <Step n={3} title="Sincronização" done={status.credential.enabled}>
          <SyncCard credential={status.credential} />
        </Step>
      )}
    </section>
  );
}

function Back() {
  return (
    <Link href="/notas" className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground">
      <ArrowLeft aria-hidden className="size-4" /> Notas de compra
    </Link>
  );
}

function Step({ n, title, done, children }: { n: number; title: string; done: boolean; children: React.ReactNode }) {
  return (
    <div className="space-y-3">
      <h2 className="flex items-center gap-2.5 text-lg font-semibold">
        <span
          aria-hidden
          className={`grid size-6 place-items-center rounded-full text-xs font-bold ${done ? 'bg-emerald-600 text-white' : 'bg-muted text-muted-foreground'}`}
        >
          {done ? '✓' : n}
        </span>
        {title}
        <span className="sr-only">{done ? ' (concluído)' : ''}</span>
      </h2>
      {children}
    </div>
  );
}
