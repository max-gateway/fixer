'use client';

import { AlertTriangle, Ban, Check, Copy, ExternalLink, FileText, Loader2, Pencil, Undo2 } from 'lucide-react';
import Link from 'next/link';
import { useEffect, useState, type ReactNode } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Field } from '@/components/ui/field';
import { Input, Textarea } from '@/components/ui/input';
import { Sheet, SheetContent, SheetDescription, SheetTitle } from '@/components/ui/sheet';
import {
  civilDate,
  daysUntil,
  describePayable,
  formatCnpj,
  initials,
  METHOD_LABEL,
  money,
  parseMoneyInput,
  relativeDue,
  sumAmounts,
  type PayableDetail,
  type PayableEvent,
} from '@/lib/payables';
import { cn } from '@/lib/utils';
import type { UpdateInput } from './hooks';

const FIELD_LABEL: Record<string, string> = {
  dueDate: 'Vencimento',
  amount: 'Valor',
  notes: 'Observações',
  category: 'Categoria',
  description: 'Descrição',
  barcode: 'Linha digitável',
  supplierName: 'Fornecedor',
};

export function DetailSheet({
  id,
  detail,
  loading,
  today,
  categories,
  perms,
  busy,
  onClose,
  onPay,
  onUnpay,
  onCancel,
  onSave,
  onCopy,
}: {
  id: string | null;
  detail: PayableDetail | undefined;
  loading: boolean;
  today: string;
  categories: string[];
  perms: { manage: boolean; pay: boolean };
  busy: boolean;
  onClose: () => void;
  onPay: (d: PayableDetail) => void;
  onUnpay: (d: PayableDetail) => void;
  onCancel: (d: PayableDetail) => void;
  onSave: (id: string, input: UpdateInput) => Promise<void>;
  onCopy: (text: string, what: string) => void;
}) {
  return (
    <Sheet open={!!id} onOpenChange={(o) => !o && onClose()}>
      <SheetContent aria-describedby={undefined}>
        {!detail ? (
          <div className="p-6">
            <SheetTitle className="sr-only">Detalhes da conta</SheetTitle>
            {loading ? <Loading /> : <p className="text-sm text-muted-foreground">Não foi possível carregar esta conta.</p>}
          </div>
        ) : (
          <Body key={detail.id} d={detail} today={today} categories={categories} perms={perms} busy={busy} onPay={onPay} onUnpay={onUnpay} onCancel={onCancel} onSave={onSave} onCopy={onCopy} />
        )}
      </SheetContent>
    </Sheet>
  );
}

const Loading = () => (
  <div className="space-y-4" aria-busy>
    <div className="skeleton h-6 w-2/3 rounded" />
    <div className="skeleton h-10 w-1/2 rounded" />
    <div className="skeleton h-32 w-full rounded-xl" />
  </div>
);

function Body({
  d,
  today,
  categories,
  perms,
  busy,
  onPay,
  onUnpay,
  onCancel,
  onSave,
  onCopy,
}: {
  d: PayableDetail;
  today: string;
  categories: string[];
  perms: { manage: boolean; pay: boolean };
  busy: boolean;
  onPay: (d: PayableDetail) => void;
  onUnpay: (d: PayableDetail) => void;
  onCancel: (d: PayableDetail) => void;
  onSave: (id: string, input: UpdateInput) => Promise<void>;
  onCopy: (text: string, what: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const s = describePayable(d, today);
  const open = d.status === 'OPEN';
  const days = daysUntil(d.dueDate, today);

  return (
    <>
      <header className="space-y-3 border-b px-5 pt-5 pb-4 pr-12">
        <div className="flex items-start gap-3">
          <span aria-hidden className="grid size-11 shrink-0 place-items-center rounded-xl bg-secondary text-sm font-semibold">
            {initials(d.supplierName)}
          </span>
          <div className="min-w-0">
            <SheetTitle className="truncate">{d.supplierName || 'Fornecedor não identificado'}</SheetTitle>
            <SheetDescription className="truncate">
              {d.supplierCnpj ? formatCnpj(d.supplierCnpj) : 'Sem CNPJ'}
              {d.documentNumber ? ` · Doc ${d.documentNumber}` : ''}
            </SheetDescription>
          </div>
        </div>
        <div className="flex flex-wrap items-end justify-between gap-2">
          <div>
            <p className="tabular text-3xl font-semibold tracking-tight">{money(d.status === 'PAID' && d.paidAmount ? d.paidAmount : d.amount)}</p>
            <p className="text-sm text-muted-foreground">
              {open ? `Vence ${civilDate(d.dueDate)} · ${relativeDue(d.dueDate, today)}` : d.status === 'PAID' ? `Paga em ${civilDate(d.paidAt)}` : `Venceria em ${civilDate(d.dueDate)}`}
            </p>
          </div>
          <Badge variant={s.tone}>{s.label}</Badge>
        </div>
        <div className="flex flex-wrap gap-2">
          {open && perms.pay && (
            <Button onClick={() => onPay(d)} disabled={busy}>
              <Check aria-hidden /> Pagar
            </Button>
          )}
          {d.status === 'PAID' && perms.pay && (
            <Button variant="outline" onClick={() => onUnpay(d)} disabled={busy}>
              {busy ? <Loader2 aria-hidden className="animate-spin" /> : <Undo2 aria-hidden />} Desfazer pagamento
            </Button>
          )}
          {open && perms.manage && !editing && (
            <Button variant="outline" onClick={() => setEditing(true)}>
              <Pencil aria-hidden /> Editar
            </Button>
          )}
          {open && perms.manage && (
            <Button variant="ghost" className="text-red-800 hover:bg-red-50 hover:text-red-900" onClick={() => onCancel(d)} disabled={busy}>
              <Ban aria-hidden /> Cancelar conta
            </Button>
          )}
        </div>
      </header>

      <div className="flex-1 space-y-6 overflow-y-auto px-5 py-5">
        {open && days < 0 && (
          <p role="note" className="flex items-start gap-2 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-900">
            <AlertTriangle aria-hidden className="mt-0.5 size-4 shrink-0" />
            Atrasada há {-days} {-days === 1 ? 'dia' : 'dias'}. Se houver juros, informe ao registrar o pagamento.
          </p>
        )}

        {editing ? (
          <EditForm
            d={d}
            categories={categories}
            onCancel={() => setEditing(false)}
            onSave={async (input) => {
              await onSave(d.id, input);
              setEditing(false);
            }}
          />
        ) : (
          <>
            <dl className="grid grid-cols-2 gap-x-4 gap-y-4 text-sm">
              <Item label="Vencimento">{civilDate(d.dueDate)}</Item>
              <Item label="Valor">{money(d.amount)}</Item>
              <Item label="Categoria">{d.category ?? <Muted>Sem categoria</Muted>}</Item>
              <Item label="Origem">{d.source === 'MANUAL' ? 'Lançada à mão' : 'Nota fiscal (XML)'}</Item>
              {d.installmentCount > 1 && (
                <Item label="Parcela">
                  {d.installment} de {d.installmentCount}
                </Item>
              )}
              {d.description && (
                <div className="col-span-2">
                  <Item label="Descrição">{d.description}</Item>
                </div>
              )}
              {d.notes && (
                <div className="col-span-2">
                  <Item label="Observações">
                    <span className="whitespace-pre-wrap">{d.notes}</span>
                  </Item>
                </div>
              )}
            </dl>

            {d.barcode && (
              <section aria-label="Linha digitável" className="rounded-xl border bg-muted/40 p-3">
                <p className="mb-1 text-xs font-medium text-muted-foreground">Linha digitável</p>
                <p className="tabular text-sm break-all">{maskBarcode(d.barcode)}</p>
                <Button variant="outline" size="sm" className="mt-2" onClick={() => onCopy(d.barcode!, 'Linha digitável copiada')}>
                  <Copy aria-hidden /> Copiar
                </Button>
              </section>
            )}
          </>
        )}

        {d.status === 'PAID' && <PaymentBlock d={d} />}
        {d.invoice && <InvoiceBlock d={d} today={today} />}

        <section aria-labelledby="timeline-title">
          <h3 id="timeline-title" className="mb-3 text-sm font-semibold">
            Histórico
          </h3>
          <Timeline d={d} />
        </section>
      </div>
    </>
  );
}

const Muted = ({ children }: { children: ReactNode }) => <span className="text-muted-foreground">{children}</span>;

function Item({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="mt-0.5 font-medium">{children}</dd>
    </div>
  );
}

const maskBarcode = (d: string) =>
  d.length === 47
    ? `${d.slice(0, 5)}.${d.slice(5, 10)} ${d.slice(10, 15)}.${d.slice(15, 21)} ${d.slice(21, 26)}.${d.slice(26, 32)} ${d[32]} ${d.slice(33)}`
    : (d.match(/.{1,12}/g) ?? [d]).join(' ');

function PaymentBlock({ d }: { d: PayableDetail }) {
  return (
    <section aria-labelledby="payment-title" className="rounded-xl border bg-emerald-50/60 p-4">
      <h3 id="payment-title" className="mb-2 text-sm font-semibold text-emerald-900">
        Pagamento
      </h3>
      <dl className="grid grid-cols-2 gap-x-4 gap-y-3 text-sm">
        <Item label="Pago em">{civilDate(d.paidAt)}</Item>
        <Item label="Valor pago">{d.paidAmount ? money(d.paidAmount) : '—'}</Item>
        <Item label="Forma">{d.paymentMethod ? (METHOD_LABEL[d.paymentMethod] ?? d.paymentMethod) : <Muted>Não informada</Muted>}</Item>
        {d.interest && <Item label="Juros e multa">{money(d.interest)}</Item>}
        {d.discount && <Item label="Desconto">{money(d.discount)}</Item>}
      </dl>
    </section>
  );
}

function InvoiceBlock({ d, today }: { d: PayableDetail; today: string }) {
  const inv = d.invoice!;
  const parts = sumAmounts(d.siblings.filter((x) => x.status !== 'CANCELED'));
  const diverges = d.siblings.length > 0 && Number(parts) !== Number(inv.totalAmount) && d.source === 'XML_INSTALLMENT';
  return (
    <section aria-labelledby="invoice-title" className="rounded-xl border p-4">
      <div className="mb-2 flex items-center justify-between gap-2">
        <h3 id="invoice-title" className="flex items-center gap-1.5 text-sm font-semibold">
          <FileText aria-hidden className="size-4" /> Nota fiscal {inv.number ?? ''}
          {inv.series != null ? `/${inv.series}` : ''}
        </h3>
        <Link href={`/notas/${inv.id}`} className="inline-flex items-center gap-1 text-xs font-medium text-brand hover:underline">
          Abrir nota <ExternalLink aria-hidden className="size-3" />
        </Link>
      </div>
      {d.source === 'XML_TOTAL' && <p className="mb-2 text-xs text-muted-foreground">O XML não traz duplicatas; a conta foi criada pelo pagamento declarado, vencendo na emissão. Ajuste o vencimento se for diferente.</p>}
      {d.siblings.length > 1 && (
        <ol className="space-y-1.5">
          {d.siblings.map((x) => (
            <li key={x.id} className={cn('flex items-center justify-between rounded-md px-2 py-1 text-sm', x.id === d.id && 'bg-brand-soft font-medium')}>
              <span>
                Parcela {x.installment} · {civilDate(x.dueDate)}
              </span>
              <span className="tabular flex items-center gap-2">
                {money(x.amount)}
                <span className={cn('text-xs', x.status === 'PAID' ? 'text-emerald-700' : x.status === 'CANCELED' ? 'text-muted-foreground' : daysUntil(x.dueDate, today) < 0 ? 'text-red-800' : 'text-muted-foreground')}>
                  {x.status === 'PAID' ? 'paga' : x.status === 'CANCELED' ? 'cancelada' : daysUntil(x.dueDate, today) < 0 ? 'atrasada' : 'aberta'}
                </span>
              </span>
            </li>
          ))}
        </ol>
      )}
      {diverges && (
        <p role="note" className="mt-2 flex items-start gap-2 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-900">
          <AlertTriangle aria-hidden className="mt-0.5 size-3.5 shrink-0" />
          As parcelas somam {money(parts)}, e a nota tem {money(inv.totalAmount)}. Pode haver frete, retenção ou duplicata fora do XML: confira com o fornecedor.
        </p>
      )}
    </section>
  );
}

function EditForm({ d, categories, onSave, onCancel }: { d: PayableDetail; categories: string[]; onSave: (i: UpdateInput) => Promise<void>; onCancel: () => void }) {
  const [dueDate, setDueDate] = useState(d.dueDate.slice(0, 10));
  const [amount, setAmount] = useState(String(Number(d.amount)).replace('.', ','));
  const [category, setCategory] = useState(d.category ?? '');
  const [description, setDescription] = useState(d.description ?? '');
  const [barcode, setBarcode] = useState(d.barcode ?? '');
  const [notes, setNotes] = useState(d.notes ?? '');
  const [supplierName, setSupplierName] = useState(d.supplierName);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const amt = parseMoneyInput(amount);

  useEffect(() => setError(null), [dueDate, amount, category, description, barcode, notes, supplierName]);

  const submit = async () => {
    if (amt === null || amt <= 0) return setError('Informe um valor maior que zero');
    setSaving(true);
    try {
      await onSave({
        dueDate,
        amount: amt,
        category: category.trim() || null,
        description: description.trim() || null,
        barcode: barcode.trim() || null,
        notes: notes.trim() || null,
        ...(d.source === 'MANUAL' ? { supplierName: supplierName.trim() } : {}),
      });
    } catch (e) {
      setError((e as Error).message);
      setSaving(false);
    }
  };

  return (
    <form
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
    >
      {d.source === 'MANUAL' && (
        <Field id="e-supplier" label="Fornecedor">
          <Input id="e-supplier" value={supplierName} onChange={(e) => setSupplierName(e.target.value)} required maxLength={200} />
        </Field>
      )}
      <div className="grid grid-cols-2 gap-3">
        <Field id="e-due" label="Vencimento">
          <Input id="e-due" type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} required />
        </Field>
        <Field id="e-amount" label="Valor (R$)">
          <Input id="e-amount" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} required />
        </Field>
      </div>
      <Field id="e-cat" label="Categoria" optional>
        <Input id="e-cat" list="payable-categories" value={category} onChange={(e) => setCategory(e.target.value)} maxLength={60} />
        <datalist id="payable-categories">
          {categories.map((c) => (
            <option key={c} value={c} />
          ))}
        </datalist>
      </Field>
      <Field id="e-desc" label="Descrição" optional>
        <Input id="e-desc" value={description} onChange={(e) => setDescription(e.target.value)} maxLength={300} />
      </Field>
      <Field id="e-barcode" label="Linha digitável" optional hint="Os dígitos são conferidos ao salvar.">
        <Input id="e-barcode" inputMode="numeric" value={barcode} onChange={(e) => setBarcode(e.target.value)} />
      </Field>
      <Field id="e-notes" label="Observações" optional>
        <Textarea id="e-notes" value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={1000} />
      </Field>
      {error && (
        <p role="alert" className="text-sm text-red-800">
          {error}
        </p>
      )}
      <div className="flex justify-end gap-2">
        <Button type="button" variant="ghost" onClick={onCancel} disabled={saving}>
          Descartar
        </Button>
        <Button type="submit" disabled={saving}>
          {saving && <Loader2 aria-hidden className="animate-spin" />} Salvar
        </Button>
      </div>
    </form>
  );
}

// ---------- histórico ----------

function describeEvent(e: PayableEvent): string {
  const data = (e.data ?? {}) as Record<string, any>;
  switch (e.type) {
    case 'CREATED':
      return e.actorName ? 'Conta lançada' : 'Conta criada';
    case 'PAID':
      return `Paga${data.paidAmount ? ` · ${money(data.paidAmount)}` : ''}${data.method ? ` via ${METHOD_LABEL[data.method] ?? data.method}` : ''}${data.bulk ? ' (em lote)' : ''}`;
    case 'UNPAID':
      return 'Pagamento desfeito';
    case 'CANCELED':
      return 'Conta cancelada';
    case 'EDITED': {
      const parts = Object.entries(data).map(([k, v]) => {
        const label = FIELD_LABEL[k] ?? k;
        const fmt = (x: unknown) => (x == null || x === '' ? 'vazio' : k === 'amount' ? money(String(x)) : k === 'dueDate' ? civilDate(`${x}T00:00:00Z`) : String(x));
        return `${label}: ${fmt(v?.from)} → ${fmt(v?.to)}`;
      });
      return parts.length ? `Editada · ${parts.join(' · ')}` : 'Editada';
    }
  }
}

function Timeline({ d }: { d: PayableDetail }) {
  // O ingest do XML não grava evento (não há usuário): a origem entra como o primeiro marco.
  const events = [...d.events];
  const hasCreated = events.some((e) => e.type === 'CREATED');
  return (
    <ol className="relative space-y-4 border-l pl-5">
      {events.map((e) => (
        <li key={e.id} className="relative">
          <span aria-hidden className="absolute top-1.5 -left-[1.6rem] size-2.5 rounded-full border-2 border-background bg-muted-foreground/60" />
          <p className="text-sm">{describeEvent(e)}</p>
          <p className="text-xs text-muted-foreground">
            {e.actorName ?? 'Sistema'} · {new Date(e.createdAt).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short', timeZone: 'America/Sao_Paulo' })}
          </p>
        </li>
      ))}
      {!hasCreated && (
        <li className="relative">
          <span aria-hidden className="absolute top-1.5 -left-[1.6rem] size-2.5 rounded-full border-2 border-background bg-brand" />
          <p className="text-sm">{d.invoice ? `Criada automaticamente a partir da NF-e ${d.invoice.number ?? ''}` : 'Conta criada'}</p>
          <p className="text-xs text-muted-foreground">
            Sistema · {new Date(d.createdAt).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short', timeZone: 'America/Sao_Paulo' })}
          </p>
        </li>
      )}
    </ol>
  );
}
