'use client';

import { useMutation } from '@tanstack/react-query';
import { Loader2, Plus, Trash2 } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';
import { Button } from '@/components/ui/button';
import { describedBy, Field } from '@/components/ui/field';
import { Input, Select } from '@/components/ui/input';
import { deleteJson, putJson } from '@/lib/client-api';
import { pct1 } from '@/lib/pricing';
import type { RuleSettings } from './pricing-settings-form';

export type ScopedRule = RuleSettings & { id: string; scope: 'DEFAULT' | 'SUPPLIER' | 'NCM' | 'PART'; scopeKey: string; target: string };

const SCOPE_LABEL = { SUPPLIER: 'Fornecedor', NCM: 'NCM', PART: 'Peça' } as const;
const SCOPE_HINT = {
  SUPPLIER: 'CNPJ do fornecedor (todas as peças que ele vender).',
  NCM: 'De 2 a 8 dígitos. O prefixo vale para todos os NCM que começam assim: 8421 pega 8421.31.00.',
  PART: 'SKU da peça.',
} as const;

const summary = (r: RuleSettings) => `${r.method === 'MARGIN' ? 'margem' : 'markup'} de ${pct1(r.value)}${r.taxPctOverride !== null ? ` · imposto fixo ${pct1(r.taxPctOverride)}` : ''}`;

/** Exceções à regra padrão: por fornecedor, NCM ou peça. A mais específica vence (peça, NCM, fornecedor, padrão). */
export function RuleExceptions({ rules, base }: { rules: ScopedRule[]; base: RuleSettings | null }) {
  const router = useRouter();
  const [scope, setScope] = useState<keyof typeof SCOPE_LABEL>('SUPPLIER');
  const [key, setKey] = useState('');
  const [method, setMethod] = useState<RuleSettings['method']>(base?.method ?? 'MARGIN');
  const [value, setValue] = useState('');
  const [override, setOverride] = useState('');
  const [submitted, setSubmitted] = useState(false);

  const valueN = Number(value.replace(',', '.'));
  const overrideN = override.trim() === '' ? null : Number(override.replace(',', '.'));
  const errors = {
    key: key.trim() === '' ? 'Informe a quem a regra se aplica' : null,
    value: value.trim() === '' || !Number.isFinite(valueN) || valueN < 0 ? 'Informe um percentual, como 25' : null,
    override: overrideN !== null && (!Number.isFinite(overrideN) || overrideN < 0) ? 'Informe um percentual' : null,
  };
  const shown = submitted ? errors : { key: null, value: null, override: null };

  const save = useMutation({
    mutationFn: (body: object) => putJson('/api/pricing/rules', body, 'Não foi possível salvar a exceção.'),
    onSuccess: () => {
      setKey('');
      setValue('');
      setOverride('');
      setSubmitted(false);
      router.refresh();
    },
  });
  const remove = useMutation({
    mutationFn: (id: string) => deleteJson(`/api/pricing/rules/${id}`, 'Não foi possível apagar a regra.'),
    onSuccess: () => router.refresh(),
  });

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    setSubmitted(true);
    if (Object.values(errors).some(Boolean)) return;
    save.mutate({
      scope,
      scopeKey: key.trim(),
      method,
      value: valueN,
      taxPctOverride: overrideN,
      // o resto herda da regra padrão: a exceção muda o quanto ganhar, não as travas de segurança
      overheadPct: Number(base?.overheadPct ?? 0),
      rounding: base?.rounding ?? 'CENTS_90',
      minMarginPct: Number(base?.minMarginPct ?? 0),
      maxJumpPct: Number(base?.maxJumpPct ?? 25),
    });
  }

  return (
    <div className="max-w-2xl space-y-4">
      {!base && <p className="text-sm text-muted-foreground">Salve a regra padrão primeiro: as exceções herdam dela o arredondamento e as travas.</p>}
      {rules.length > 0 ? (
        <ul className="divide-y overflow-hidden rounded-xl border bg-card text-sm">
          {rules.map((r) => (
            <li key={r.id} className="flex items-center justify-between gap-3 px-4 py-2.5">
              <span className="min-w-0">
                <span className="font-medium">{SCOPE_LABEL[r.scope as keyof typeof SCOPE_LABEL]}</span> <span className="break-all text-muted-foreground">{r.target}</span>
                <span className="block text-xs text-muted-foreground">{summary(r)}</span>
              </span>
              <Button type="button" size="sm" variant="ghost" disabled={remove.isPending} onClick={() => remove.mutate(r.id)} aria-label={`Apagar a regra de ${r.target}`}>
                <Trash2 aria-hidden />
              </Button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-muted-foreground">Nenhuma exceção: todas as peças usam a regra padrão.</p>
      )}
      {remove.error && (
        <p role="alert" className="text-sm font-medium text-destructive">
          {remove.error.message}
        </p>
      )}

      <form onSubmit={onSubmit} className="space-y-3 rounded-xl border p-4" noValidate>
        <p className="text-sm font-medium">Nova exceção</p>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field id="exc-scope" label="Vale para">
            <Select id="exc-scope" value={scope} onChange={(e) => setScope(e.target.value as keyof typeof SCOPE_LABEL)}>
              {Object.entries(SCOPE_LABEL).map(([k, label]) => (
                <option key={k} value={k}>
                  {label}
                </option>
              ))}
            </Select>
          </Field>
          <Field id="exc-key" label={SCOPE_LABEL[scope]} hint={SCOPE_HINT[scope]} error={shown.key}>
            <Input {...describedBy('exc-key', shown.key, SCOPE_HINT[scope])} value={key} onChange={(e) => setKey(e.target.value)} />
          </Field>
          <Field id="exc-method" label="Como calcular">
            <Select id="exc-method" value={method} onChange={(e) => setMethod(e.target.value as RuleSettings['method'])}>
              <option value="MARGIN">Margem sobre a venda</option>
              <option value="MARKUP">Markup sobre o custo</option>
            </Select>
          </Field>
          <Field id="exc-value" label={method === 'MARGIN' ? 'Margem (%)' : 'Markup (%)'} error={shown.value}>
            <Input {...describedBy('exc-value', shown.value)} inputMode="decimal" value={value} onChange={(e) => setValue(e.target.value)} className="max-w-32" />
          </Field>
        </div>
        <Field id="exc-override" label="Imposto sobre a venda fixo (%)" optional hint="Só se esta exceção tiver um imposto próprio." error={shown.override}>
          <Input {...describedBy('exc-override', shown.override)} inputMode="decimal" value={override} onChange={(e) => setOverride(e.target.value)} className="max-w-32" />
        </Field>
        <div className="flex flex-wrap items-center gap-3">
          <Button type="submit" variant="outline" disabled={save.isPending || !base}>
            {save.isPending ? <Loader2 aria-hidden className="animate-spin" /> : <Plus aria-hidden />} Adicionar exceção
          </Button>
          {save.error && (
            <span role="alert" className="text-sm font-medium text-destructive">
              {save.error.message}
            </span>
          )}
        </div>
      </form>
    </div>
  );
}
