'use client';

import { useMutation } from '@tanstack/react-query';
import { Loader2, PackagePlus, Link2, Undo2, Ban } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { describedBy, Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { postJson, putJson } from '@/lib/client-api';
import type { InvoiceItem } from '@/lib/invoices';
import { money, qty } from '@/lib/invoices';
import type { Part } from '@/lib/orders';
import type { WithCost } from '@/lib/invoice-cost';
import { CostBreakdown } from './cost-breakdown';
import { PartPicker } from './part-picker';

type Mode = 'idle' | 'link' | 'create';

const ORIGIN: Record<InvoiceItem['resolution'], string | null> = {
  UNRESOLVED: null,
  AUTO_MAP: 'Automático (vínculo do fornecedor)',
  AUTO_EAN: 'Automático (código de barras)',
  MANUAL: 'Escolhido por você',
  IGNORED: null,
};

const toNumber = (v: string) => {
  const n = Number(v.trim().replace(',', '.'));
  return v.trim() !== '' && Number.isFinite(n) ? n : null;
};

/** Um item da nota: dados do XML à esquerda, vínculo com a peça à direita, com as ações da conciliação. */
export function ItemRow({ invoiceId, item, editable }: { invoiceId: string; item: WithCost<InvoiceItem>; editable: boolean }) {
  const router = useRouter();
  const [mode, setMode] = useState<Mode>('idle');
  const [error, setError] = useState<string | null>(null);

  const done = () => {
    setMode('idle');
    setError(null);
    router.refresh();
  };
  const fail = (e: Error) => setError(e.message);

  const act = useMutation({
    mutationFn: (body: object) => putJson(`/api/invoices/${invoiceId}/items/${item.itemNumber}`, body, 'Não foi possível salvar o vínculo.'),
    onSuccess: done,
    onError: fail,
  });

  const resolved = item.resolution !== 'UNRESOLVED';
  const factor = Number(item.unitFactor);

  return (
    <li className="space-y-3 px-4 py-4">
      <div className="grid gap-x-6 gap-y-3 md:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)]">
        <div className="min-w-0">
          <p className="text-sm font-medium">
            <span className="tabular mr-2 text-muted-foreground">{item.itemNumber}.</span>
            {item.description}
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            Código {item.supplierCode}
            {item.ean && ` · GTIN ${item.ean}`} · NCM {item.ncm}
          </p>
          <p className="tabular mt-1 text-sm">
            {qty(item.quantity)} {item.unit} × {money(item.unitPrice)} = <strong>{money(item.totalPrice)}</strong>
          </p>
          {item.cost && <CostBreakdown cost={item.cost} />}
        </div>

        <div className="min-w-0 space-y-2">
          {item.resolution === 'IGNORED' && (
            <p className="flex items-center gap-2 text-sm">
              <Badge variant="secondary">Não é estoque</Badge>
              <span className="text-xs text-muted-foreground">Não entra no estoque.</span>
            </p>
          )}
          {resolved && item.part && (
            <div className="space-y-1">
              <p className="text-sm font-medium">{item.part.name}</p>
              <p className="text-xs text-muted-foreground">
                {item.part.sku} · {ORIGIN[item.resolution]}
              </p>
              <p className="tabular text-xs text-muted-foreground">
                Entra no estoque: <strong className="text-foreground">{qty(Number(item.quantity) * factor)}</strong> un
                {factor !== 1 && ` (${qty(factor)} por ${item.unit})`}
              </p>
            </div>
          )}
          {!resolved && <Badge variant="warning">Sem peça</Badge>}

          {editable && mode === 'idle' && (
            <div className="flex flex-wrap gap-2 pt-1">
              <Button type="button" size="sm" variant={resolved ? 'outline' : 'default'} onClick={() => setMode('link')}>
                <Link2 aria-hidden /> {item.part ? 'Trocar peça' : 'Vincular peça'}
              </Button>
              {!resolved && (
                <>
                  <Button type="button" size="sm" variant="outline" onClick={() => setMode('create')}>
                    <PackagePlus aria-hidden /> Cadastrar peça
                  </Button>
                  <Button type="button" size="sm" variant="ghost" disabled={act.isPending} onClick={() => act.mutate({ action: 'ignore' })}>
                    <Ban aria-hidden /> Não é estoque
                  </Button>
                </>
              )}
              {resolved && (
                <Button type="button" size="sm" variant="ghost" disabled={act.isPending} onClick={() => act.mutate({ action: 'reset' })}>
                  {act.isPending ? <Loader2 aria-hidden className="animate-spin" /> : <Undo2 aria-hidden />} Desfazer
                </Button>
              )}
            </div>
          )}
          {error && mode === 'idle' && (
            <p role="alert" className="text-xs font-medium text-destructive">
              {error}
            </p>
          )}
        </div>
      </div>

      {mode === 'link' && <LinkForm invoiceId={invoiceId} item={item} onCancel={() => setMode('idle')} onDone={done} />}
      {mode === 'create' && <CreatePartForm invoiceId={invoiceId} item={item} onCancel={() => setMode('idle')} onDone={done} />}
    </li>
  );
}

function FormShell({ title, onSubmit, children, pending, error, onCancel, submitLabel }: {
  title: string;
  onSubmit: (e: FormEvent) => void;
  children: React.ReactNode;
  pending: boolean;
  error: string | null;
  onCancel: () => void;
  submitLabel: string;
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
        <Button type="submit" size="sm" disabled={pending}>
          {pending && <Loader2 aria-hidden className="animate-spin" />} {submitLabel}
        </Button>
        <Button type="button" size="sm" variant="ghost" onClick={onCancel} disabled={pending}>
          Cancelar
        </Button>
      </div>
    </form>
  );
}

function FactorField({ id, unit, value, onChange, error }: { id: string; unit: string; value: string; onChange: (v: string) => void; error: string | null }) {
  const hint = `Quantas unidades de estoque vêm em 1 ${unit} da nota. Caixa com 4 peças: digite 4.`;
  return (
    <Field id={id} label="Unidades por embalagem" hint={hint} error={error}>
      <Input {...describedBy(id, error, hint)} inputMode="decimal" value={value} onChange={(e) => onChange(e.target.value)} className="max-w-32" />
    </Field>
  );
}

function RememberField({ id, checked, onChange }: { id: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label htmlFor={id} className="flex items-start gap-2 text-sm">
      <input id={id} type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} className="mt-0.5 size-4 accent-[var(--brand-primary)]" />
      <span>
        Lembrar este vínculo
        <span className="block text-xs text-muted-foreground">As próximas notas deste fornecedor com o mesmo código já entram ligadas a esta peça.</span>
      </span>
    </label>
  );
}

function LinkForm({ invoiceId, item, onCancel, onDone }: { invoiceId: string; item: InvoiceItem; onCancel: () => void; onDone: () => void }) {
  const [part, setPart] = useState<Pick<Part, 'id' | 'sku' | 'name'> | null>(item.part ? { id: item.part.id, sku: item.part.sku, name: item.part.name } : null);
  const [factor, setFactor] = useState(String(Number(item.unitFactor)).replace('.', ','));
  const [remember, setRemember] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const f = toNumber(factor);

  const save = useMutation({
    mutationFn: (body: object) => putJson(`/api/invoices/${invoiceId}/items/${item.itemNumber}`, body, 'Não foi possível salvar o vínculo.'),
    onSuccess: onDone,
    onError: (e) => setError(e.message),
  });

  function submit(e: FormEvent) {
    e.preventDefault();
    if (!part) return setError('Escolha a peça na lista.');
    if (f === null || f <= 0) return setError('Informe um número maior que zero para as unidades por embalagem.');
    setError(null);
    save.mutate({ action: 'link', partId: part.id, unitFactor: f, saveMapping: remember });
  }

  const id = `link-${item.id}`;
  return (
    <FormShell title="Vincular a uma peça do estoque" onSubmit={submit} pending={save.isPending} error={error} onCancel={onCancel} submitLabel="Salvar vínculo">
      <Field id={`${id}-part`} label="Peça">
        <PartPicker id={`${id}-part`} value={part} onChange={setPart} initialQuery={item.description} />
      </Field>
      <FactorField id={`${id}-factor`} unit={item.unit} value={factor} onChange={setFactor} error={null} />
      <RememberField id={`${id}-remember`} checked={remember} onChange={setRemember} />
    </FormShell>
  );
}

function CreatePartForm({ invoiceId, item, onCancel, onDone }: { invoiceId: string; item: InvoiceItem; onCancel: () => void; onDone: () => void }) {
  const [sku, setSku] = useState(item.supplierCode.toUpperCase());
  const [name, setName] = useState(item.description);
  const [price, setPrice] = useState('');
  const [factor, setFactor] = useState('1');
  const [remember, setRemember] = useState(true);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const p = toNumber(price);
  const f = toNumber(factor);
  const errors = {
    sku: sku.trim() === '' ? 'Informe o SKU' : null,
    name: name.trim() === '' ? 'Informe o nome' : null,
    price: p === null || p < 0 ? 'Informe o preço de venda' : null,
    factor: f === null || f <= 0 ? 'Informe um número maior que zero' : null,
  };
  const shown = submitted ? errors : { sku: null, name: null, price: null, factor: null };

  const create = useMutation({
    mutationFn: (body: object) => postJson(`/api/invoices/${invoiceId}/items/${item.itemNumber}/create-part`, body, 'Não foi possível cadastrar a peça.'),
    onSuccess: onDone,
    onError: (e) => setError(e.message),
  });

  function submit(e: FormEvent) {
    e.preventDefault();
    setSubmitted(true);
    if (Object.values(errors).some(Boolean)) return;
    setError(null);
    create.mutate({ sku: sku.trim(), name: name.trim(), sellPrice: p, unitFactor: f, saveMapping: remember });
  }

  const id = `new-${item.id}`;
  return (
    <FormShell title="Cadastrar peça com os dados da nota" onSubmit={submit} pending={create.isPending} error={error} onCancel={onCancel} submitLabel="Cadastrar e vincular">
      <p className="text-xs text-muted-foreground">
        NCM, CEST, origem, código de barras, unidade e o custo (com frete, IPI e ST) vêm do XML. Falta só o preço de venda.
      </p>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field id={`${id}-sku`} label="SKU" error={shown.sku}>
          <Input {...describedBy(`${id}-sku`, shown.sku)} value={sku} onChange={(e) => setSku(e.target.value)} />
        </Field>
        <Field id={`${id}-price`} label="Preço de venda (R$)" error={shown.price}>
          <Input {...describedBy(`${id}-price`, shown.price)} inputMode="decimal" value={price} onChange={(e) => setPrice(e.target.value)} className="max-w-40" />
        </Field>
      </div>
      <Field id={`${id}-name`} label="Nome" error={shown.name}>
        <Input {...describedBy(`${id}-name`, shown.name)} value={name} onChange={(e) => setName(e.target.value)} />
      </Field>
      <FactorField id={`${id}-factor`} unit={item.unit} value={factor} onChange={setFactor} error={shown.factor} />
      <RememberField id={`${id}-remember`} checked={remember} onChange={setRemember} />
    </FormShell>
  );
}
