'use client';

import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Icon } from '@/components/icons';
import { customerCompleteness, type PortalCustomer } from '@/lib/portal';

type Values = Omit<PortalCustomer, 'document'>;
type Save = 'idle' | 'dirty' | 'saving' | 'saved' | 'error';

const onlyDigits = (v: string) => v.replace(/\D/g, '');
const maskPhone = (v: string) => {
  const d = onlyDigits(v).slice(0, 11);
  if (d.length <= 2) return d;
  if (d.length <= 6) return `(${d.slice(0, 2)}) ${d.slice(2)}`;
  const split = d.length === 11 ? 7 : 6;
  return `(${d.slice(0, 2)}) ${d.slice(2, split)}-${d.slice(split)}`;
};
const maskCep = (v: string) => {
  const d = onlyDigits(v).slice(0, 8);
  return d.length > 5 ? `${d.slice(0, 5)}-${d.slice(5)}` : d;
};

function validate(v: Values): Partial<Record<keyof Values, string>> {
  const e: Partial<Record<keyof Values, string>> = {};
  if (v.name.trim().length < 2) e.name = 'Informe seu nome';
  const phone = onlyDigits(v.phone ?? '');
  if (phone && (phone.length < 10 || phone.length > 11)) e.phone = 'Telefone incompleto';
  if (v.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.email)) e.email = 'E-mail inválido';
  const cep = onlyDigits(v.zipCode ?? '');
  if (cep && cep.length !== 8) e.zipCode = 'CEP incompleto';
  if (v.state && !/^[a-zA-Z]{2}$/.test(v.state)) e.state = 'UF com 2 letras';
  return e;
}

const maskDocument = (v: string) => {
  const d = onlyDigits(v).slice(0, 14);
  if (d.length <= 11)
    return d.replace(/(\d{3})(\d{1,3})?(\d{1,3})?(\d{1,2})?/, (_, a, b, c, e) => [a, b && `.${b}`, c && `.${c}`, e && `-${e}`].filter(Boolean).join(''));
  return d.replace(/(\d{2})(\d{3})(\d{3})(\d{1,4})?(\d{1,2})?/, (_, a, b, c, e, f) => `${a}.${b}.${c}${e ? `/${e}` : ''}${f ? `-${f}` : ''}`);
};

export type LookupResult = { found: false } | { found: true; customer: Values };

export function MyDataPanel({
  customer,
  document,
  pending,
  readOnly,
  onSave,
  onLookup,
  onIdentify,
}: {
  customer: Values;
  document: string | null;
  /** Cadastro pendente: pede CPF/CNPJ, busca cadastro existente e só grava ao confirmar. */
  pending: boolean;
  readOnly: boolean;
  onSave: (v: Values) => Promise<void>;
  onLookup: (document: string) => Promise<LookupResult>;
  onIdentify: (document: string, v: Values) => Promise<void>;
}) {
  const [docInput, setDocInput] = useState('');
  const [docMsg, setDocMsg] = useState<{ tone: 'ok' | 'info' | 'error'; text: string } | null>(null);
  const [identifying, setIdentifying] = useState(false);
  const docDigits = onlyDigits(docInput);
  const docValid = docDigits.length === 11 || docDigits.length === 14;
  const [values, setValues] = useState<Values>({
    ...customer,
    phone: customer.phone ? maskPhone(customer.phone) : '',
    zipCode: customer.zipCode ? maskCep(customer.zipCode) : '',
  });
  const [save, setSave] = useState<Save>('idle');
  const [cepMsg, setCepMsg] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const queryClient = useQueryClient();
  const latest = useRef(values);
  latest.current = values;

  const errors = validate(values);
  const hasErrors = Object.keys(errors).length > 0;
  const pct = customerCompleteness({ ...values, document });

  const flush = async () => {
    if (Object.keys(validate(latest.current)).length > 0) return setSave('idle');
    setSave('saving');
    try {
      await onSave(latest.current);
      setSave('saved');
    } catch {
      setSave('error');
    }
  };

  const change = (patch: Partial<Values>) => {
    setValues((v) => ({ ...v, ...patch }));
    if (pending) return; // identificação é confirmada no botão: fundir cadastros não é desfazível
    setSave('dirty');
    clearTimeout(timer.current);
    timer.current = setTimeout(flush, 900);
  };

  // Busca automática: ao completar o CPF/CNPJ, traz o cadastro existente (se houver) para conferência.
  async function onDocChange(masked: string) {
    setDocInput(masked);
    const d = onlyDigits(masked);
    if (d.length !== 11 && d.length !== 14) return setDocMsg(null);
    setDocMsg({ tone: 'info', text: 'Procurando seu cadastro…' });
    try {
      const r = await onLookup(d);
      if (r.found) {
        setValues({ ...r.customer, phone: r.customer.phone ? maskPhone(r.customer.phone) : '', zipCode: r.customer.zipCode ? maskCep(r.customer.zipCode) : '' });
        setDocMsg({ tone: 'ok', text: 'Encontramos seu cadastro! Confira os dados abaixo e confirme.' });
      } else {
        setDocMsg({ tone: 'info', text: 'Primeiro acesso: preencha seus dados abaixo.' });
      }
    } catch (err) {
      setDocMsg({ tone: 'error', text: err instanceof Error ? err.message : 'Não foi possível buscar agora. Preencha manualmente.' });
    }
  }

  async function identify() {
    setIdentifying(true);
    try {
      await onIdentify(docDigits, latest.current);
      setDocMsg(null);
    } catch (err) {
      setDocMsg({ tone: 'error', text: err instanceof Error ? err.message : 'Não foi possível salvar. Tente de novo.' });
    } finally {
      setIdentifying(false);
    }
  }
  useEffect(() => () => clearTimeout(timer.current), []);

  // ViaCEP (gratuito): preenche o endereço quando o CEP fica completo.
  async function lookupCep(masked: string) {
    const cep = onlyDigits(masked);
    if (cep.length !== 8) return setCepMsg(null);
    setCepMsg('Buscando endereço…');
    try {
      // Endereço de um CEP quase não muda: cache de 24 h evita repetir a consulta ao digitar de novo.
      const d = await queryClient.fetchQuery({
        queryKey: ['viacep', cep],
        staleTime: 24 * 60 * 60_000,
        queryFn: async () => (await fetch(`https://viacep.com.br/ws/${cep}/json/`)).json(),
      });
      if (d.erro) return setCepMsg('CEP não encontrado. Preencha o endereço manualmente.');
      change({
        zipCode: masked,
        street: d.logradouro || latest.current.street || '',
        district: d.bairro || latest.current.district || '',
        city: d.localidade || '',
        state: d.uf || '',
      });
      setCepMsg(null);
    } catch {
      setCepMsg('Não foi possível buscar o CEP. Preencha manualmente.');
    }
  }

  const text = (key: keyof Values, label: string, extra: { type?: string; autoComplete?: string; mask?: (v: string) => string; inputMode?: 'numeric' | 'tel' | 'email'; className?: string; hint?: string; after?: (v: string) => void } = {}) => (
    <Field label={label} error={errors[key]} hint={extra.hint} className={extra.className}>
      <input
        value={(values[key] as string | null) ?? ''}
        onChange={(e) => {
          const v = extra.mask ? extra.mask(e.target.value) : e.target.value;
          change({ [key]: v } as Partial<Values>);
          extra.after?.(v);
        }}
        onBlur={() => !pending && save === 'dirty' && (clearTimeout(timer.current), flush())}
        type={extra.type ?? 'text'}
        inputMode={extra.inputMode}
        autoComplete={extra.autoComplete}
        disabled={readOnly}
        aria-invalid={!!errors[key]}
        className={`w-full rounded-xl border bg-card px-3.5 py-2.5 text-[15px] outline-none transition focus:ring-4 disabled:bg-slate-50 ${
          errors[key] ? 'border-red-400 focus:border-red-500 focus:ring-red-500/10' : 'border-slate-200 focus:border-brand focus:ring-brand/10'
        }`}
      />
    </Field>
  );

  return (
    <div className="space-y-5">
      <div className="flex items-center gap-4 rounded-3xl border border-slate-200 bg-card surface p-5 shadow-sm">
        <Ring pct={pct} />
        <div className="min-w-0 flex-1">
          <h2 className="font-semibold">{pct === 100 ? 'Cadastro completo' : 'Complete seu cadastro'}</h2>
          <p className="text-sm text-slate-600">
            {pct === 100 ? 'Tudo certo! Você pode editar quando quiser.' : 'Assim a oficina fala com você e emite os documentos sem atrasos.'}
          </p>
        </div>
        <SaveBadge state={hasErrors && save !== 'saved' ? 'idle' : save} onRetry={flush} />
      </div>

      <Card title="Contato">
        {pending && (
          <Field
            label="CPF ou CNPJ"
            hint={docMsg?.text ?? 'Comece por aqui: se você já é cliente, preenchemos seus dados.'}
            error={docMsg?.tone === 'error' ? docMsg.text : undefined}
            className="sm:col-span-2"
          >
            <input
              value={docInput}
              onChange={(e) => void onDocChange(maskDocument(e.target.value))}
              inputMode="numeric"
              autoComplete="off"
              disabled={readOnly}
              autoFocus
              className="w-full rounded-xl border border-slate-200 bg-card px-3.5 py-2.5 text-[15px] outline-none transition focus:border-brand focus:ring-4 focus:ring-brand/10"
            />
          </Field>
        )}
        {text('name', 'Nome completo', { autoComplete: 'name', className: 'sm:col-span-2' })}
        {!pending && (
          <Field label="CPF/CNPJ" hint="Protegido: só a oficina vê o número completo.">
            <div className="flex items-center gap-2 rounded-xl border border-slate-200 bg-slate-50 px-3.5 py-2.5 text-[15px] text-slate-500">
              <Icon name="lock" className="size-4" />
              {document}
            </div>
          </Field>
        )}
        {text('phone', 'Telefone / WhatsApp', { type: 'tel', inputMode: 'tel', autoComplete: 'tel-national', mask: maskPhone })}
        {text('email', 'E-mail', { type: 'email', inputMode: 'email', autoComplete: 'email', className: 'sm:col-span-2' })}
      </Card>

      <Card title="Endereço">
        {text('zipCode', 'CEP', { inputMode: 'numeric', autoComplete: 'postal-code', mask: maskCep, after: lookupCep, hint: cepMsg ?? undefined })}
        <div className="hidden sm:block" />
        {text('street', 'Rua', { autoComplete: 'address-line1', className: 'sm:col-span-2' })}
        {text('number', 'Número')}
        {text('complement', 'Complemento')}
        {text('district', 'Bairro')}
        {text('city', 'Cidade', { autoComplete: 'address-level2' })}
        {text('state', 'UF', { autoComplete: 'address-level1' })}
      </Card>

      {pending && (
        <button
          onClick={() => void identify()}
          disabled={readOnly || identifying || !docValid || hasErrors}
          className="w-full rounded-2xl bg-brand px-5 py-3.5 font-semibold text-white shadow-sm transition hover:bg-brand-hover disabled:opacity-50"
        >
          {identifying ? 'Salvando…' : 'Confirmar meus dados'}
        </button>
      )}
    </div>
  );
}

function Card({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="rounded-3xl border border-slate-200 bg-card surface p-5 shadow-sm">
      <h3 className="mb-4 text-xs font-semibold uppercase tracking-widest text-slate-500">{title}</h3>
      <div className="grid gap-4 sm:grid-cols-2">{children}</div>
    </section>
  );
}

function Field({ label, error, hint, className = '', children }: { label: string; error?: string; hint?: string; className?: string; children: ReactNode }) {
  return (
    <label className={`block space-y-1.5 ${className}`}>
      <span className="text-sm font-medium text-slate-700">{label}</span>
      {children}
      {(error || hint) && <span className={`block text-xs ${error ? 'text-red-600' : 'text-slate-500'}`}>{error ?? hint}</span>}
    </label>
  );
}

function Ring({ pct }: { pct: number }) {
  const r = 22;
  const c = 2 * Math.PI * r;
  return (
    <div className="relative size-14 shrink-0" role="img" aria-label={`${pct}% do cadastro preenchido`}>
      <svg viewBox="0 0 56 56" className="size-full -rotate-90">
        <circle cx="28" cy="28" r={r} fill="none" stroke="#dde5f0" strokeWidth="5" />
        <circle cx="28" cy="28" r={r} fill="none" stroke={pct === 100 ? '#10b981' : 'var(--brand-primary)'} strokeWidth="5" strokeLinecap="round" strokeDasharray={c} strokeDashoffset={c * (1 - pct / 100)} className="transition-all duration-700" />
      </svg>
      <span className="absolute inset-0 grid place-items-center text-xs font-bold tabular-nums">{pct}%</span>
    </div>
  );
}

function SaveBadge({ state, onRetry }: { state: Save; onRetry: () => void }) {
  if (state === 'idle') return null;
  const base = 'flex shrink-0 items-center gap-1 rounded-full px-2.5 py-1 text-xs font-medium';
  if (state === 'error')
    return (
      <button onClick={onRetry} className={`${base} bg-red-50 text-red-700`}>
        Falhou · tentar de novo
      </button>
    );
  if (state === 'saved')
    return (
      <span className={`${base} bg-emerald-50 text-emerald-700`} role="status">
        <Icon name="check" className="size-3.5" /> Salvo
      </span>
    );
  return (
    <span className={`${base} bg-slate-100 text-slate-600`} role="status">
      <Icon name="cloud" className="size-3.5" /> {state === 'saving' ? 'Salvando…' : 'Alterações…'}
    </span>
  );
}
