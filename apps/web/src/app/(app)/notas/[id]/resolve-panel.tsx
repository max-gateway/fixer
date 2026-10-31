'use client';

import { useMutation, useQuery } from '@tanstack/react-query';
import { CircleCheck, Loader2, PackagePlus } from 'lucide-react';
import { useState, type FormEvent, type ReactNode } from 'react';
import { CatalogPartPicker } from '@/components/catalog/catalog-part-picker';
import { Button } from '@/components/ui/button';
import { describedBy, Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import type { CatalogHit } from '@/lib/catalog';
import { getJson, postJson, putJson } from '@/lib/client-api';
import type { InvoiceItem } from '@/lib/invoices';
import { qty } from '@/lib/invoices';
import type { Part } from '@/lib/orders';
import { PartPicker } from './part-picker';

type Picked = Pick<Part, 'id' | 'sku' | 'name'>;
type Source = 'catalog' | 'workshop' | 'note';

const toNumber = (v: string) => {
  const n = Number(v.trim().replace(',', '.'));
  return v.trim() !== '' && Number.isFinite(n) ? n : null;
};

/** Moldura comum dos formulários do item: título, conteúdo, erro e os botões de salvar/cancelar. */
function FormShell({ title, onSubmit, children, pending, error, onCancel, submitLabel, submitDisabled = false }: {
  title: string;
  onSubmit: (e: FormEvent) => void;
  children: ReactNode;
  pending: boolean;
  error: string | null;
  onCancel: () => void;
  submitLabel: string;
  submitDisabled?: boolean;
}) {
  return (
    <form onSubmit={onSubmit} className="space-y-4 rounded-lg border bg-muted/40 p-4" noValidate>
      <p className="text-sm font-semibold">{title}</p>
      {children}
      {error && (
        <p role="alert" className="text-sm font-medium text-destructive">
          {error}
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        <Button type="submit" size="sm" disabled={pending || submitDisabled}>
          {pending && <Loader2 aria-hidden className="animate-spin" />} {submitLabel}
        </Button>
        <Button type="button" size="sm" variant="ghost" onClick={onCancel} disabled={pending}>
          Cancelar
        </Button>
      </div>
    </form>
  );
}

/**
 * Como o item da nota vira estoque (vale para qualquer peça, escolhida ou nova): unidades por embalagem, o resultado em unidades e se o
 * vínculo é lembrado para as próximas notas do fornecedor.
 */
function ConversionFields({ id, item, factor, onFactor, error, remember, onRemember }: {
  id: string;
  item: InvoiceItem;
  factor: string;
  onFactor: (v: string) => void;
  error: string | null;
  remember: boolean;
  onRemember: (v: boolean) => void;
}) {
  const f = toNumber(factor);
  const hint = `Quantas unidades de estoque vêm em 1 ${item.unit} da nota. Caixa com 4 peças: digite 4.`;
  return (
    <div className="space-y-3 border-t pt-4">
      <Field id={`${id}-factor`} label="Unidades por embalagem" hint={hint} error={error}>
        <div className="flex flex-wrap items-center gap-3">
          <Input {...describedBy(`${id}-factor`, error, hint)} inputMode="decimal" value={factor} onChange={(e) => onFactor(e.target.value)} className="max-w-32" />
          {f !== null && f > 0 && (
            <p className="tabular text-sm text-muted-foreground">
              Entram no estoque: <strong className="text-foreground">{qty(Number(item.quantity) * f)}</strong> un
            </p>
          )}
        </div>
      </Field>
      <label htmlFor={`${id}-remember`} className="flex items-start gap-2 text-sm">
        <input id={`${id}-remember`} type="checkbox" checked={remember} onChange={(e) => onRemember(e.target.checked)} className="mt-0.5 size-4 accent-[var(--brand-primary)]" />
        <span>
          Lembrar este vínculo
          <span className="block text-xs text-muted-foreground">As próximas notas deste fornecedor com o mesmo código já entram ligadas a esta peça.</span>
        </span>
      </label>
    </div>
  );
}

/**
 * Define a peça de um item da nota num só lugar, começando pelo catálogo: a pessoa acha a peça da nota na busca do catálogo e o painel decide
 * sozinho o resto. Se a oficina já cadastrou aquela peça do catálogo, o item é vinculado a ela; se não, ela é cadastrada (nome e SKU do catálogo,
 * fiscal e custo da nota; o preço de venda sai da precificação). Para peça que não está no catálogo há duas saídas: escolher uma peça já
 * cadastrada na oficina ou cadastrar só com os dados da nota.
 */
export function ResolvePanel({ invoiceId, item, preselect, onCancel, onDone }: {
  invoiceId: string;
  item: InvoiceItem;
  /** Peça da oficina já marcada (vinda da sugestão do catálogo). */
  preselect?: Picked;
  onCancel: () => void;
  onDone: () => void;
}) {
  const [source, setSource] = useState<Source>(preselect ? 'workshop' : 'catalog');
  const [hit, setHit] = useState<CatalogHit | null>(null);
  const [part, setPart] = useState<Picked | null>(preselect ?? (item.part ? { id: item.part.id, sku: item.part.sku, name: item.part.name } : null));
  const [factor, setFactor] = useState(String(Number(item.unitFactor)).replace('.', ','));
  const [remember, setRemember] = useState(true);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // A peça escolhida no catálogo pode já existir na oficina: então o item é vinculado a ela em vez de cadastrar outra.
  const local = useQuery({
    queryKey: ['parts-by-catalog-sku', hit?.sku],
    enabled: source === 'catalog' && !!hit,
    queryFn: () => getJson<Part[]>(`/api/parts?catalogSku=${encodeURIComponent(hit!.sku)}`, 'Não foi possível verificar o cadastro da peça na oficina.'),
  });
  const registered = local.data?.[0];
  const checking = source === 'catalog' && !!hit && local.isLoading;

  const f = toNumber(factor);
  const errors = {
    pick: source === 'catalog' && !hit ? 'Escolha a peça do catálogo na lista.' : source === 'workshop' && !part ? 'Escolha a peça na lista.' : null,
    factor: f === null || f <= 0 ? 'Informe um número maior que zero' : null,
  };
  const shown = submitted ? errors : { pick: null, factor: null };

  const linkTo = (partId: string) =>
    putJson(`/api/invoices/${invoiceId}/items/${item.itemNumber}`, { action: 'link', partId, unitFactor: f, saveMapping: remember }, 'Não foi possível salvar o vínculo.');
  const register = (catalogSku?: string) =>
    postJson(
      `/api/invoices/${invoiceId}/items/${item.itemNumber}/create-part`,
      { unitFactor: f, saveMapping: remember, ...(catalogSku ? { catalogSku } : {}) },
      'Não foi possível cadastrar a peça.',
    );

  const save = useMutation({
    mutationFn: () => {
      if (source === 'workshop') return linkTo(part!.id);
      if (source === 'catalog' && registered) return linkTo(registered.id);
      return register(source === 'catalog' ? hit!.sku : undefined);
    },
    onSuccess: onDone,
    onError: (e) => setError(e.message),
  });

  function submit(e: FormEvent) {
    e.preventDefault();
    setSubmitted(true);
    if (Object.values(errors).some(Boolean) || checking) return;
    setError(null);
    save.mutate();
  }

  const id = `resolve-${item.id}`;
  const registers = source === 'note' || (source === 'catalog' && !registered);
  const go = (next: Source) => {
    setSource(next);
    setSubmitted(false);
    setError(null);
  };
  return (
    <FormShell
      title={item.part ? 'Trocar a peça deste item' : 'Qual peça é esta?'}
      onSubmit={submit}
      pending={save.isPending}
      error={error}
      onCancel={onCancel}
      submitLabel={registers ? 'Cadastrar e vincular' : 'Salvar vínculo'}
      submitDisabled={checking}
    >
      {source === 'catalog' && (
        <div className="space-y-3">
          <Field id={`${id}-catalog`} label="Peça do catálogo" hint="Busque pelo nome, número ou código de barras da peça da nota." error={shown.pick}>
            <CatalogPartPicker id={`${id}-catalog`} value={hit} onChange={setHit} initialQuery={item.description} />
          </Field>
          {hit && <CatalogStatus checking={checking} failed={local.isError} registered={registered} />}
          <p className="flex flex-wrap items-center gap-x-1 gap-y-1 text-xs text-muted-foreground">
            Não está no catálogo?
            <SwitchLink onClick={() => go('workshop')}>Escolher uma peça já cadastrada na oficina</SwitchLink>
            ou
            <SwitchLink onClick={() => go('note')}>cadastrar só com os dados da nota</SwitchLink>
          </p>
        </div>
      )}

      {source === 'workshop' && (
        <div className="space-y-3">
          <Field id={`${id}-part`} label="Peça da oficina" hint="Só aparecem as peças já cadastradas na oficina, com o saldo de estoque de cada uma." error={shown.pick}>
            <PartPicker id={`${id}-part`} value={part} onChange={setPart} initialQuery={item.description} onSearchCatalog={() => go('catalog')} />
          </Field>
          <p className="text-xs text-muted-foreground">
            <SwitchLink onClick={() => go('catalog')}>Buscar no catálogo</SwitchLink>
          </p>
        </div>
      )}

      {source === 'note' && (
        <div className="space-y-3">
          <p className="text-sm">
            A peça será cadastrada com o código <strong>{item.supplierCode.toUpperCase()}</strong> e a descrição da nota. NCM, CEST, origem, código de barras,
            unidade e o custo (com frete, IPI e ST) vêm do XML. O preço de venda você define na precificação.
          </p>
          <p className="text-xs text-muted-foreground">
            <SwitchLink onClick={() => go('catalog')}>Buscar no catálogo</SwitchLink>
          </p>
        </div>
      )}

      <ConversionFields id={id} item={item} factor={factor} onFactor={setFactor} error={shown.factor} remember={remember} onRemember={setRemember} />
    </FormShell>
  );
}

/** Diz, depois de escolher a peça do catálogo, o que vai acontecer na oficina ao salvar. */
function CatalogStatus({ checking, failed, registered }: { checking: boolean; failed: boolean; registered?: Part }) {
  if (checking) {
    return (
      <p role="status" className="flex items-center gap-2 text-xs text-muted-foreground">
        <Loader2 aria-hidden className="size-3.5 animate-spin" /> Verificando se a oficina já cadastrou esta peça…
      </p>
    );
  }
  if (failed) {
    return (
      <p role="alert" className="text-xs font-medium text-destructive">
        Não foi possível verificar o cadastro da peça na oficina. Tente escolher a peça de novo.
      </p>
    );
  }
  return registered ? (
    <p role="status" className="flex items-start gap-2 rounded-md border border-emerald-500/30 bg-emerald-500/5 px-3 py-2 text-xs">
      <CircleCheck aria-hidden className="mt-px size-3.5 shrink-0 text-emerald-600" />
      <span>
        <strong>Já cadastrada na oficina</strong> ({registered.sku}), com {Number(registered.stockQty).toLocaleString('pt-BR')} un em estoque. O item será vinculado a ela.
      </span>
    </p>
  ) : (
    <p role="status" className="flex items-start gap-2 rounded-md border border-brand/30 bg-brand/5 px-3 py-2 text-xs">
      <PackagePlus aria-hidden className="mt-px size-3.5 shrink-0 text-brand" />
      <span>
        <strong>Ainda não cadastrada na oficina.</strong> Ao salvar, ela é cadastrada com o nome e o SKU do catálogo e o custo da nota.
      </span>
    </p>
  );
}

function SwitchLink({ onClick, children }: { onClick: () => void; children: ReactNode }) {
  return (
    <button type="button" onClick={onClick} className="font-medium text-brand underline-offset-2 hover:underline focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none">
      {children}
    </button>
  );
}

/** Vincula uma peça que já está no estoque da oficina a uma peça do catálogo da plataforma. */
export function CatalogLinkForm({ part, onCancel, onDone }: { part: NonNullable<InvoiceItem['part']>; onCancel: () => void; onDone: () => void }) {
  const [hit, setHit] = useState<CatalogHit | null>(null);
  const [error, setError] = useState<string | null>(null);
  const save = useMutation({
    mutationFn: (body: object) => putJson(`/api/parts/${part.id}/catalog-link`, body, 'Não foi possível vincular ao catálogo.'),
    onSuccess: onDone,
    onError: (e) => setError(e.message),
  });

  function submit(e: FormEvent) {
    e.preventDefault();
    if (!hit) return setError('Escolha a peça do catálogo na lista.');
    setError(null);
    save.mutate({ catalogSku: hit.sku });
  }

  const id = `catalog-${part.id}`;
  return (
    <FormShell title={`Vincular “${part.name}” ao catálogo`} onSubmit={submit} pending={save.isPending} error={error} onCancel={onCancel} submitLabel="Vincular">
      <Field id={`${id}-part`} label="Peça do catálogo" hint="A peça continua sendo a do seu estoque; o vínculo só diz qual peça do catálogo ela é.">
        <CatalogPartPicker id={`${id}-part`} value={hit} onChange={setHit} initialQuery={part.name} />
      </Field>
    </FormShell>
  );
}
