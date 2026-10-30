import { redirect } from 'next/navigation';
import {
  ArrowRight,
  CarFront,
  ClipboardList,
  FileText,
  Package,
  ShieldCheck,
  Smartphone,
  Users,
  Wallet,
} from 'lucide-react';
import { auth, signIn } from '@/auth';
import { getBranding } from '@/lib/branding';
import { safePath } from '@/lib/logout';

const FEATURES = [
  {
    icon: ClipboardList,
    title: 'Ordens de serviço',
    text: 'Do orçamento à entrega, cada OS com status claro, itens, mão de obra e histórico.',
  },
  {
    icon: CarFront,
    title: 'Consulta de placa',
    text: 'Fotografe ou digite a placa e comece o atendimento com o veículo já identificado.',
  },
  {
    icon: Package,
    title: 'Peças e compatibilidade',
    text: 'Catálogo com estoque da oficina e peças compatíveis com o veículo do cliente.',
  },
  {
    icon: FileText,
    title: 'Notas fiscais de entrada',
    text: 'As notas de compra chegam sozinhas e os itens são ligados ao catálogo.',
  },
  {
    icon: Wallet,
    title: 'Contas a pagar',
    text: 'Compras e vencimentos num lugar só, para fechar o mês sem planilha paralela.',
  },
  {
    icon: Users,
    title: 'Clientes e equipe',
    text: 'Cadastro de clientes e da equipe, com permissões por função.',
  },
];

const STEPS = [
  { n: '01', title: 'Identifique o veículo', text: 'A placa traz marca, modelo e ano. Sem digitação repetida.' },
  { n: '02', title: 'Monte o orçamento', text: 'Serviços e peças compatíveis, com a margem que você definir.' },
  { n: '03', title: 'Acompanhe e entregue', text: 'A OS avança por etapas e o cliente acompanha pelo celular.' },
];

const STATUS_ROWS = [
  { plate: 'RKT-4B21', car: 'Onix 1.0 · 2021', status: 'Em execução', tone: 'bg-brand/20 text-blue-200 ring-brand/40' },
  { plate: 'QWE-9H77', car: 'HB20 1.6 · 2019', status: 'Aguardando peça', tone: 'bg-amber-400/15 text-amber-200 ring-amber-300/30' },
  { plate: 'BRA-2E19', car: 'Corolla 2.0 · 2022', status: 'Pronto p/ retirada', tone: 'bg-emerald-400/15 text-emerald-200 ring-emerald-300/30' },
];

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

  async function login() {
    'use server';
    await signIn('keycloak', { redirectTo });
  }

  const Brand = ({ className = '' }: { className?: string }) => (
    <div className={`flex items-center gap-3 ${className}`}>
      {b.logoUrl && (
        <img src={b.logoUrl} alt={b.logoHasName ? b.displayName : ''} className={b.logoHasName ? 'h-12 w-auto' : 'h-9 w-auto'} />
      )}
      {!b.logoHasName && <span className="text-lg font-bold tracking-tight">{b.displayName}</span>}
    </div>
  );

  return (
    <main className="min-h-screen bg-slate-50 text-slate-900">
      {/* Hero escuro */}
      <div className="relative isolate overflow-hidden bg-brand-secondary text-white">
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 -z-10 opacity-[0.35] [background-image:linear-gradient(rgb(255_255_255/0.06)_1px,transparent_1px),linear-gradient(90deg,rgb(255_255_255/0.06)_1px,transparent_1px)] [background-size:56px_56px] [mask-image:radial-gradient(70%_60%_at_50%_30%,black,transparent)]"
        />
        <div aria-hidden className="pointer-events-none absolute -top-40 left-1/2 -z-10 size-[44rem] -translate-x-1/2 rounded-full bg-brand/30 blur-[120px]" />
        <div aria-hidden className="pointer-events-none absolute -right-40 top-1/3 -z-10 size-[28rem] rounded-full bg-brand/20 blur-[110px]" />

        <header className="mx-auto flex max-w-6xl items-center justify-between px-6 py-5">
          <Brand />
          <nav className="flex items-center gap-2 sm:gap-6">
            <a href="#recursos" className="hidden text-sm text-white/70 transition hover:text-white sm:block">
              Recursos
            </a>
            <a href="#como-funciona" className="hidden text-sm text-white/70 transition hover:text-white sm:block">
              Como funciona
            </a>
            <form action={login}>
              <button className="rounded-full border border-white/20 bg-white/5 px-5 py-2 text-sm font-semibold backdrop-blur transition hover:bg-white/15">
                Entrar
              </button>
            </form>
          </nav>
        </header>

        <section className="mx-auto grid max-w-6xl items-center gap-14 px-6 pb-24 pt-14 lg:grid-cols-[1.05fr_1fr] lg:pt-20">
          <div className="animate-rise">
            <span className="inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/5 px-3.5 py-1.5 text-xs font-medium text-white/80">
              <span className="size-1.5 rounded-full bg-emerald-400 shadow-[0_0_8px] shadow-emerald-400" />
              Gestão completa para oficinas mecânicas
            </span>
            <h1 className="mt-6 text-4xl font-bold leading-[1.08] tracking-tight sm:text-5xl lg:text-6xl">
              A oficina em ordem,{' '}
              <span className="bg-gradient-to-r from-blue-300 via-white to-blue-200 bg-clip-text text-transparent">
                do orçamento à entrega.
              </span>
            </h1>
            <p className="mt-6 max-w-xl text-lg leading-relaxed text-white/70">
              Ordens de serviço, clientes, peças, notas fiscais e consulta de placa num só lugar. Menos papel e
              retrabalho, mais carros saindo no prazo.
            </p>

            {error && (
              <p role="alert" className="mt-6 max-w-md rounded-lg bg-red-500/10 px-4 py-3 text-sm text-red-200 ring-1 ring-red-400/30">
                Não foi possível entrar. Tente novamente.
              </p>
            )}

            <div className="mt-9 flex flex-wrap items-center gap-4">
              <form action={login}>
                <button className="btn-glow group inline-flex items-center gap-2 rounded-xl bg-brand px-7 py-3.5 text-base font-semibold text-white transition active:scale-[0.99]">
                  Acessar o painel
                  <ArrowRight className="size-4 transition group-hover:translate-x-0.5" />
                </button>
              </form>
              <a href="#recursos" className="text-sm font-medium text-white/70 transition hover:text-white">
                Conhecer os recursos
              </a>
            </div>
            <p className="mt-5 flex items-center gap-2 text-sm text-white/50">
              <ShieldCheck className="size-4" />
              Você será levado à tela segura de autenticação.
            </p>
          </div>

          {/* Mockup do painel */}
          <div aria-hidden className="relative animate-rise [animation-delay:120ms]">
            <div className="absolute -inset-4 rounded-[2rem] bg-gradient-to-tr from-brand/30 to-transparent blur-2xl" />
            <div className="relative rounded-2xl border border-white/10 bg-white/[0.06] p-5 shadow-2xl backdrop-blur-xl lg:rotate-[-1.5deg]">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-xs uppercase tracking-wider text-white/50">Hoje na oficina</p>
                  <p className="mt-1 text-2xl font-bold">12 ordens abertas</p>
                </div>
                <div className="flex gap-1.5">
                  <span className="size-2.5 rounded-full bg-white/20" />
                  <span className="size-2.5 rounded-full bg-white/20" />
                  <span className="size-2.5 rounded-full bg-white/20" />
                </div>
              </div>

              <div className="mt-5 grid grid-cols-3 gap-3">
                {[
                  ['Em execução', '5'],
                  ['Aguardando', '4'],
                  ['Prontas', '3'],
                ].map(([label, value]) => (
                  <div key={label} className="rounded-xl bg-white/[0.06] p-3 ring-1 ring-white/10">
                    <p className="text-2xl font-bold tabular">{value}</p>
                    <p className="text-xs text-white/55">{label}</p>
                  </div>
                ))}
              </div>

              <ul className="mt-5 space-y-2.5">
                {STATUS_ROWS.map((r) => (
                  <li key={r.plate} className="flex items-center justify-between rounded-xl bg-white/[0.05] px-4 py-3 ring-1 ring-white/10">
                    <div className="flex items-center gap-3">
                      <span className="rounded-md bg-white px-2 py-1 text-xs font-bold tracking-widest text-slate-900 tabular">
                        {r.plate}
                      </span>
                      <span className="text-sm text-white/70">{r.car}</span>
                    </div>
                    <span className={`rounded-full px-2.5 py-1 text-xs font-medium ring-1 ${r.tone}`}>{r.status}</span>
                  </li>
                ))}
              </ul>
            </div>

            <div className="absolute -bottom-6 -left-4 hidden items-center gap-3 rounded-2xl border border-white/10 bg-brand-secondary/90 px-4 py-3 shadow-xl backdrop-blur sm:flex">
              <span className="grid size-9 place-items-center rounded-lg bg-brand/20 text-blue-200">
                <Smartphone className="size-5" />
              </span>
              <div>
                <p className="text-sm font-semibold">Portal do cliente</p>
                <p className="text-xs text-white/55">Acompanha a OS pelo celular</p>
              </div>
            </div>
          </div>
        </section>
      </div>

      {/* Recursos */}
      <section id="recursos" className="mx-auto max-w-6xl scroll-mt-8 px-6 py-24">
        <div className="max-w-2xl">
          <p className="text-sm font-semibold uppercase tracking-wider text-brand">Recursos</p>
          <h2 className="mt-3 text-3xl font-bold tracking-tight sm:text-4xl">Tudo o que a oficina usa no dia a dia</h2>
          <p className="mt-4 text-lg text-slate-500">
            Um painel único, pensado para o balcão, a bancada e o escritório.
          </p>
        </div>
        <div className="mt-12 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {FEATURES.map(({ icon: Icon, title, text }) => (
            <article
              key={title}
              className="surface group rounded-2xl border border-slate-200 bg-white p-6 transition hover:-translate-y-1 hover:border-brand/40"
            >
              <span className="grid size-11 place-items-center rounded-xl bg-brand-soft text-brand transition group-hover:bg-brand group-hover:text-white">
                <Icon className="size-5" />
              </span>
              <h3 className="mt-5 text-lg font-semibold">{title}</h3>
              <p className="mt-2 leading-relaxed text-slate-500">{text}</p>
            </article>
          ))}
        </div>
      </section>

      {/* Como funciona */}
      <section id="como-funciona" className="scroll-mt-8 border-y border-slate-200 bg-white">
        <div className="mx-auto max-w-6xl px-6 py-24">
          <div className="max-w-2xl">
            <p className="text-sm font-semibold uppercase tracking-wider text-brand">Como funciona</p>
            <h2 className="mt-3 text-3xl font-bold tracking-tight sm:text-4xl">Três passos do balcão à entrega</h2>
          </div>
          <ol className="mt-12 grid gap-8 md:grid-cols-3">
            {STEPS.map((s) => (
              <li key={s.n} className="relative border-t-2 border-brand/25 pt-6">
                <span className="text-5xl font-bold text-brand/20 tabular">{s.n}</span>
                <h3 className="mt-3 text-xl font-semibold">{s.title}</h3>
                <p className="mt-2 leading-relaxed text-slate-500">{s.text}</p>
              </li>
            ))}
          </ol>
        </div>
      </section>

      {/* CTA final */}
      <section className="mx-auto max-w-6xl px-6 py-24">
        <div className="relative isolate overflow-hidden rounded-3xl bg-brand-secondary px-8 py-16 text-center text-white sm:px-16">
          <div aria-hidden className="pointer-events-none absolute left-1/2 top-0 -z-10 size-[30rem] -translate-x-1/2 -translate-y-1/2 rounded-full bg-brand/40 blur-[100px]" />
          <h2 className="mx-auto max-w-2xl text-3xl font-bold tracking-tight sm:text-4xl">
            Pronto para tirar a oficina do papel?
          </h2>
          <p className="mx-auto mt-4 max-w-xl text-lg text-white/65">
            Entre com a sua conta {b.displayName} e continue de onde parou.
          </p>
          <form action={login} className="mt-8">
            <button className="btn-glow group inline-flex items-center gap-2 rounded-xl bg-brand px-8 py-3.5 text-base font-semibold text-white transition active:scale-[0.99]">
              Entrar
              <ArrowRight className="size-4 transition group-hover:translate-x-0.5" />
            </button>
          </form>
        </div>
      </section>

      <footer className="border-t border-slate-200">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3 px-6 py-6 text-sm text-slate-500">
          <span>
            © {new Date().getFullYear()} {b.displayName}
          </span>
          <span className="flex items-center gap-1.5">
            <ShieldCheck className="size-4" /> Autenticação segura
          </span>
        </div>
      </footer>
    </main>
  );
}
