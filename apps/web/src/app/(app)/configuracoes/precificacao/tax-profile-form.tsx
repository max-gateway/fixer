'use client';

import { useMutation } from '@tanstack/react-query';
import { ChevronDown, Loader2, ShieldCheck } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';
import { Button } from '@/components/ui/button';
import { UnitInput } from '@/components/unit-input';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Switch } from '@/components/ui/switch';
import { postJson, putJson } from '@/lib/client-api';
import { num, show, Submit } from './pricing-settings-form';
import { REGIME_LABEL, type TaxReadiness } from './readiness';

export type TaxProfileSettings = {
  rbt12: string | null;
  rbt12AsOf: string | null;
  icmsSalePct: string | null;
  simplesEffectiveRatePct: string | null;
  icmsSharePct: string | null;
  pisSharePct: string | null;
  cofinsSharePct: string | null;
  requireTaxConfirmation: boolean;
  /** Em dia com a SEFAZ estadual (PE: art. 393-A); null = não informado. */
  stateTaxRegular?: boolean | null;
  reviewedBy: string | null;
  reviewedAt: string | null;
  rulesVersion: string;
};

const REGULAR_OPTIONS = [
  { value: 'yes', label: 'Em dia', hint: 'Sem débito, PGDAS-D entregue e antecipações pagas.' },
  { value: 'no', label: 'Com pendência', hint: 'Paga a diferença cheia de alíquotas.' },
  { value: 'unknown', label: 'Não sei', hint: 'O custo usa o pior caso até você informar.' },
] as const;
const regularValue = (v: boolean | null | undefined) => (v === true ? 'yes' : v === false ? 'no' : 'unknown');

const pctError = (v: number | null | 'invalid', max = 100) => (v === 'invalid' || (typeof v === 'number' && v > max) ? `Informe um percentual entre 0 e ${max}` : null);

/**
 * Dados tributários da oficina. Mostra só o que o regime usa: no Simples a RBT12 (a alíquota vem do Anexo I); no Lucro
 * Presumido o ICMS cobrado na venda; no Lucro Real não há percentual sobre a venda. Os percentuais do contador ficam num
 * bloco recolhido, porque valem mais que a tabela e a maioria das oficinas não precisa deles.
 */
export function TaxProfileForm({ initial, readiness, canReview }: { initial: TaxProfileSettings | null; readiness: TaxReadiness; canReview: boolean }) {
  const router = useRouter();
  const regime = readiness.regime;
  const [icmsSale, setIcmsSale] = useState(show(initial?.icmsSalePct));
  const [rbt12, setRbt12] = useState(show(initial?.rbt12));
  const [rbt12AsOf, setRbt12AsOf] = useState(initial?.rbt12AsOf ?? '');
  const [rate, setRate] = useState(show(initial?.simplesEffectiveRatePct));
  const [icms, setIcms] = useState(show(initial?.icmsSharePct));
  const [pis, setPis] = useState(show(initial?.pisSharePct));
  const [cofins, setCofins] = useState(show(initial?.cofinsSharePct));
  const [require, setRequire] = useState(initial?.requireTaxConfirmation ?? false);
  const [regular, setRegular] = useState<string>(regularValue(initial?.stateTaxRegular));
  const [reviewer, setReviewer] = useState(initial?.reviewedBy ?? '');
  const [submitted, setSubmitted] = useState(false);

  const n = { icmsSale: num(icmsSale), rbt12: num(rbt12), rate: num(rate), icms: num(icms), pis: num(pis), cofins: num(cofins) };
  const shareSum = [n.icms, n.pis, n.cofins].reduce<number>((s, v) => s + (typeof v === 'number' ? v : 0), 0);
  const errors = {
    icmsSale: pctError(n.icmsSale),
    rbt12: n.rbt12 === 'invalid' ? 'Informe um valor em reais' : null,
    rate: pctError(n.rate),
    icms: n.icms === 'invalid' ? 'Informe um percentual' : null,
    pis: n.pis === 'invalid' ? 'Informe um percentual' : null,
    cofins: n.cofins === 'invalid' ? 'Informe um percentual' : null,
    sum: shareSum > 100 ? 'ICMS, PIS e COFINS somam mais de 100% da alíquota efetiva' : null,
  };
  const shown = submitted ? errors : { icmsSale: null, rbt12: null, rate: null, icms: null, pis: null, cofins: null, sum: null };
  const hasManual = initial?.simplesEffectiveRatePct != null || initial?.icmsSharePct != null || initial?.pisSharePct != null || initial?.cofinsSharePct != null;

  const save = useMutation({
    mutationFn: (body: object) => putJson('/api/pricing/tax-profile', body, 'Não foi possível salvar os dados tributários.'),
    onSuccess: () => router.refresh(),
  });
  const review = useMutation({
    mutationFn: () => postJson('/api/pricing/tax-profile/review', { reviewedBy: reviewer }, 'Não foi possível registrar a validação.'),
    onSuccess: () => router.refresh(),
  });

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    setSubmitted(true);
    if (Object.values(errors).some(Boolean)) return;
    save.mutate({
      icmsSalePct: n.icmsSale as number | null,
      rbt12: n.rbt12 as number | null,
      rbt12AsOf: rbt12AsOf || null,
      simplesEffectiveRatePct: n.rate as number | null,
      icmsSharePct: n.icms as number | null,
      pisSharePct: n.pis as number | null,
      cofinsSharePct: n.cofins as number | null,
      requireTaxConfirmation: require,
      stateTaxRegular: regular === 'yes' ? true : regular === 'no' ? false : null,
    });
  }

  return (
    <div className="max-w-2xl space-y-6">
      <p className="text-sm text-muted-foreground">
        Regime: <strong className="text-foreground">{REGIME_LABEL[regime]}</strong>
        {!readiness.regimeInformed && ' (assumido)'} ·{' '}
        <Link href="/configuracoes" className="underline underline-offset-2">
          alterar em Dados fiscais
        </Link>
      </p>

      <form onSubmit={onSubmit} className="space-y-5" noValidate>
        {regime === 'SIMPLES' && (
          <div className="grid gap-4 sm:grid-cols-2">
            <Field id="tax-rbt12" label="Receita dos últimos 12 meses (RBT12), em R$" error={shown.rbt12} hint="Está no extrato do PGDAS-D. Com ela o Fixer calcula a alíquota pelo Anexo I do Simples Nacional.">
              <UnitInput id="tax-rbt12" unit="R$" side="start" hint value={rbt12} onChange={(e) => setRbt12(e.target.value)} error={shown.rbt12} className="max-w-56" />
            </Field>
            <Field id="tax-rbt12-asof" label="Referente a" optional hint="Mês de referência.">
              <Input id="tax-rbt12-asof" type="date" value={rbt12AsOf} onChange={(e) => setRbt12AsOf(e.target.value)} />
            </Field>
          </div>
        )}

        {regime === 'SIMPLES' && (
          <fieldset className="space-y-2">
            <legend id="tax-regular" className="text-sm font-medium">
              Situação na SEFAZ estadual
            </legend>
            <p className="text-xs text-muted-foreground">Em PE, muda o ICMS antecipado nas compras de outro estado (RICMS-PE, art. 393-A), que entra no custo das peças.</p>
            <RadioGroup value={regular} onValueChange={setRegular} aria-labelledby="tax-regular" className="gap-1.5">
              {REGULAR_OPTIONS.map((o) => (
                <label key={o.value} className="flex cursor-pointer items-start gap-2 text-sm">
                  <RadioGroupItem value={o.value} className="mt-0.5" />
                  <span>
                    {o.label}
                    <span className="block text-xs text-muted-foreground">{o.hint}</span>
                  </span>
                </label>
              ))}
            </RadioGroup>
          </fieldset>
        )}

        {regime === 'PRESUMIDO' && (
          <div className="grid gap-4 sm:grid-cols-2">
            <Field id="tax-icms-sale" label="ICMS cobrado na venda (%)" error={shown.icmsSale} hint="A alíquota interna de ICMS da sua UF para peças. Peças com ICMS-ST já recolhido não usam.">
              <UnitInput id="tax-icms-sale" unit="%" hint value={icmsSale} onChange={(e) => setIcmsSale(e.target.value)} error={shown.icmsSale} className="max-w-32" />
            </Field>
            <Field id="tax-rbt12" label="Receita anual (R$)" optional error={shown.rbt12} hint="Só para a majoração da presunção acima de R$ 5 milhões por ano (LC 224/2025).">
              <UnitInput id="tax-rbt12" unit="R$" side="start" hint value={rbt12} onChange={(e) => setRbt12(e.target.value)} error={shown.rbt12} className="max-w-56" />
            </Field>
          </div>
        )}

        {regime === 'REAL' && (
          <Alert>
            <AlertDescription>No Lucro Real o imposto incide sobre o lucro e admite crédito: não existe um percentual sobre a venda. Defina o percentual de imposto na regra de preço (aba &quot;Regra de preço&quot;).</AlertDescription>
          </Alert>
        )}

        {regime === 'SIMPLES' && (
          <Collapsible defaultOpen={hasManual} className="rounded-lg border">
            <CollapsibleTrigger className="group flex w-full items-center justify-between gap-2 rounded-lg p-3 text-left text-sm font-medium outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50">
              Percentuais informados pelo contador (opcional)
              <ChevronDown aria-hidden className="size-4 text-muted-foreground transition-transform group-data-[state=open]:rotate-180" />
            </CollapsibleTrigger>
            <CollapsibleContent className="space-y-4 px-3 pb-3">
              <p className="text-xs text-muted-foreground">Se o seu contador passar a alíquota efetiva e a repartição, preencha: eles valem mais que a tabela da lei. Em branco, o Fixer usa a RBT12.</p>
              <Field id="tax-rate" label="Alíquota efetiva" optional error={shown.rate}>
                <UnitInput id="tax-rate" unit="%" value={rate} onChange={(e) => setRate(e.target.value)} error={shown.rate} className="max-w-32" />
              </Field>
              <fieldset className="space-y-3">
                <legend className="text-sm font-medium">Quanto dessa alíquota é cada tributo (% da própria alíquota)</legend>
                <div className="grid gap-4 sm:grid-cols-3">
                  <Field id="tax-icms" label="ICMS" optional error={shown.icms}>
                    <UnitInput id="tax-icms" unit="%" value={icms} onChange={(e) => setIcms(e.target.value)} error={shown.icms} />
                  </Field>
                  <Field id="tax-pis" label="PIS" optional error={shown.pis}>
                    <UnitInput id="tax-pis" unit="%" value={pis} onChange={(e) => setPis(e.target.value)} error={shown.pis} />
                  </Field>
                  <Field id="tax-cofins" label="COFINS" optional error={shown.cofins}>
                    <UnitInput id="tax-cofins" unit="%" value={cofins} onChange={(e) => setCofins(e.target.value)} error={shown.cofins} />
                  </Field>
                </div>
                {shown.sum && (
                  <p role="alert" className="text-xs font-medium text-destructive">
                    {shown.sum}
                  </p>
                )}
              </fieldset>
            </CollapsibleContent>
          </Collapsible>
        )}

        <div className="flex items-start gap-3">
          <Switch id="tax-require" checked={require} onCheckedChange={setRequire} className="mt-0.5" />
          <label htmlFor="tax-require" className="text-sm">
            Exigir confirmação do enquadramento antes de lançar
            <span className="block text-xs text-muted-foreground">Peças com imposto &quot;estimado&quot; só lançam depois do &quot;estou ciente&quot;.</span>
          </label>
        </div>
        <Submit pending={save.isPending} error={save.error?.message ?? null} done={save.isSuccess} label="Salvar" />
      </form>

      {readiness.supported && (
        <div className="space-y-2 rounded-lg border p-4">
          <h3 className="text-sm font-semibold">Validação do contador</h3>
          {initial?.reviewedAt ? (
            <p className="flex items-start gap-2 text-sm text-emerald-800">
              <ShieldCheck aria-hidden className="mt-0.5 size-4 shrink-0" /> Validados por {initial.reviewedBy} em {new Date(initial.reviewedAt).toLocaleDateString('pt-BR')}. Mudar um valor acima pede nova validação.
            </p>
          ) : (
            <p className="text-sm text-muted-foreground">Os dados acima ainda não foram validados. As tabelas da lei são validadas na aba &quot;Tabelas&quot;.</p>
          )}
          {canReview && (initial?.simplesEffectiveRatePct != null || initial?.rbt12 != null || initial?.icmsSalePct != null) && (
            <div className="flex flex-wrap items-end gap-2">
              <Field id="tax-reviewer" label="Quem validou">
                <Input id="tax-reviewer" value={reviewer} onChange={(e) => setReviewer(e.target.value)} placeholder="Nome do contador" className="max-w-64" />
              </Field>
              <Button type="button" variant="outline" disabled={review.isPending || reviewer.trim().length < 2} onClick={() => review.mutate()}>
                {review.isPending ? <Loader2 aria-hidden className="animate-spin" /> : <ShieldCheck aria-hidden />} Registrar validação
              </Button>
            </div>
          )}
          {review.error && (
            <p role="alert" className="text-sm font-medium text-destructive">
              {review.error.message}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
