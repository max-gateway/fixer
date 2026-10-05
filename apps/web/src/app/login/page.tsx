import { redirect } from 'next/navigation';
import { auth, signIn } from '@/auth';
import { getBranding } from '@/lib/branding';

// Só caminhos internos: evita open redirect via ?callbackUrl=https://...
const safePath = (value?: string) => (value && value.startsWith('/') && !value.startsWith('//') ? value : '/');

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ callbackUrl?: string; error?: string }>;
}) {
  const { callbackUrl, error } = await searchParams;
  const redirectTo = safePath(callbackUrl);

  const session = (await auth()) as { error?: string } | null;
  if (session && !session.error) redirect(redirectTo);

  const b = getBranding();

  return (
    <main className="grid min-h-screen lg:grid-cols-[1.1fr_1fr]">
      <section className="relative hidden overflow-hidden bg-brand-secondary p-12 text-white lg:flex lg:flex-col lg:justify-between">
        <div className="flex items-center gap-3">
          {b.logoUrl && <img src={b.logoUrl} alt="" className="h-10 w-auto" />}
          <span className="text-xl font-bold">{b.displayName}</span>
        </div>
        <div className="max-w-md">
          <h2 className="text-4xl font-bold leading-tight">A oficina em ordem, do orçamento à entrega.</h2>
          <p className="mt-4 text-lg leading-relaxed text-white/70">
            Ordens de serviço, clientes e consulta de placa em um só lugar.
          </p>
        </div>
        <div className="h-1.5 w-24 rounded-full bg-brand" />
        <div className="pointer-events-none absolute -right-32 -top-32 size-96 rounded-full bg-brand/20 blur-3xl" />
      </section>

      <section className="flex items-center justify-center px-6 py-12">
        <div className="w-full max-w-sm">
          <div className="mb-10 flex items-center gap-3 lg:hidden">
            {b.logoUrl && <img src={b.logoUrl} alt="" className="h-9 w-auto" />}
            <span className="text-xl font-bold text-slate-900">{b.displayName}</span>
          </div>

          <h1 className="text-3xl font-bold text-slate-900">Entrar</h1>
          <p className="mt-2 text-slate-500">Acesse o painel da {b.displayName}.</p>

          {error && (
            <p role="alert" className="mt-6 rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700 ring-1 ring-red-200">
              Não foi possível entrar. Tente novamente.
            </p>
          )}

          <form
            className="mt-8"
            action={async () => {
              'use server';
              await signIn('keycloak', { redirectTo });
            }}
          >
            <button className="w-full rounded-xl bg-brand px-4 py-3.5 text-base font-semibold text-white shadow-sm transition hover:bg-brand-hover active:scale-[0.99]">
              Continuar para o login
            </button>
          </form>
          <p className="mt-4 text-center text-sm text-slate-500">
            Você será levado à tela segura de autenticação.
          </p>
        </div>
      </section>
    </main>
  );
}
