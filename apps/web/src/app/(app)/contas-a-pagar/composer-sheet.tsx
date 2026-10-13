'use client';

import { AlertTriangle, Loader2, ScanBarcode, Sparkles } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Field } from '@/components/ui/field';
import { Input, Textarea } from '@/components/ui/input';
import { Sheet, SheetContent, SheetDescription, SheetTitle } from '@/components/ui/sheet';
import { civilDate, formatCnpj, money, parseMoneyInput, todayIso, type BoletoInfo, type Supplier } from '@/lib/payables';
import { cn } from '@/lib/utils';
import { findDuplicates, lookupBarcode, type CreateInput } from './hooks';

type Dup = Awaited<ReturnType<typeof findDuplicates>>;

/**
 * Lançamento de conta avulsa. Colar a linha digitável do boleto preenche valor e vencimento; fornecedor e categoria
 * sugerem o que já existe; um aviso aparece se houver conta parecida (mesmo fornecedor, valor e data próxima).
 */
export function ComposerSheet({
  open,
  suppliers,
  categories,
  onClose,
  onSubmit,
}: {
  open: boolean;
  suppliers: Supplier[];
  categories: string[];
  onClose: () => void;
  onSubmit: (input: CreateInput, another: boolean) => Promise<void>;
}) {
  const blank = { supplier: '', category: '', description: '', doc: '', notes: '', amount: '', due: '', installments: '1', barcode: '' };
  const [f, setF] = useState(blank);
  const [boleto, setBoleto] = useState<BoletoInfo | 'loading' | null>(null);
  const [filled, setFilled] = useState<string | null>(null);
  const [dups, setDups] = useState<Dup>([]);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const first = useRef<HTMLInputElement>(null);
  const set = <K extends keyof typeof blank>(k: K, v: string) => setF((s) => ({ ...s, [k]: v }));

  useEffect(() => {
    if (open) {
      setF({ ...blank, due: '' });
      setBoleto(null);
      setFilled(null);
      setDups([]);
      setError(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // Linha digitável: ao completar 44/47/48 dígitos, consulta a API (que valida os dígitos verificadores).
  useEffect(() => {
    const digits = f.barcode.replace(/\D/g, '');
    if (digits.length < 44) return setBoleto(null);
    let live = true;
    setBoleto('loading');
    lookupBarcode(digits)
      .then((r) => {
        if (!live) return;
        setBoleto(r);
        if (r.ok) {
          const bits: string[] = [];
          if (r.amount) {
            set('amount', r.amount.replace('.', ','));
            bits.push(`valor ${money(r.amount)}`);
          }
          if (r.dueDate) {
            set('due', r.dueDate);
            bits.push(`vencimento ${civilDate(`${r.dueDate}T00:00:00Z`)}`);
          }
          setFilled(bits.length ? `Lido do boleto: ${bits.join(' e ')}.` : 'Boleto válido, sem valor ou vencimento embutidos.');
        } else setFilled(null);
      })
      .catch(() => live && setBoleto(null));
    return () => {
      live = false;
    };
  }, [f.barcode]);

  const amount = parseMoneyInput(f.amount);
  const installments = Math.max(1, Math.min(60, Number(f.installments) || 1));

  // Aviso de duplicidade, com debounce, quando fornecedor + valor + vencimento estão preenchidos.
  useEffect(() => {
    if (!f.supplier.trim() || !amount || amount <= 0 || !f.due) return setDups([]);
    let live = true;
    const id = setTimeout(() => {
      findDuplicates(f.supplier.trim(), installments > 1 ? Math.round((amount / installments) * 100) / 100 : amount, f.due)
        .then((r) => live && setDups(r))
        .catch(() => live && setDups([]));
    }, 350);
    return () => {
      live = false;
      clearTimeout(id);
    };
  }, [f.supplier, f.due, amount, installments]);

  const known = suppliers.find((s) => s.name.toLowerCase() === f.supplier.trim().toLowerCase());
  const barcodeBad = boleto && boleto !== 'loading' && !boleto.ok;
  const canSubmit = !!f.supplier.trim() && amount !== null && amount > 0 && !!f.due && !barcodeBad && !saving;

  const submit = async (another: boolean) => {
    if (!canSubmit || amount === null) return;
    setSaving(true);
    setError(null);
    try {
      await onSubmit(
        {
          supplierName: f.supplier.trim(),
          supplierCnpj: known?.cnpj ?? undefined,
          description: f.description.trim() || undefined,
          category: f.category.trim() || undefined,
          documentNumber: f.doc.trim() || undefined,
          barcode: f.barcode.replace(/\D/g, '') || undefined,
          notes: f.notes.trim() || undefined,
          dueDate: f.due,
          amount,
          installments,
        },
        another,
      );
      if (another) {
        // Mantém fornecedor e categoria (o caso comum é lançar várias do mesmo credor), limpa o resto.
        setF((s) => ({ ...blank, supplier: s.supplier, category: s.category }));
        setBoleto(null);
        setFilled(null);
        setDups([]);
        first.current?.focus();
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Sheet open={open} onOpenChange={(o) => !o && !saving && onClose()}>
      <SheetContent
        aria-describedby="composer-desc"
        onOpenAutoFocus={(e) => {
          e.preventDefault();
          first.current?.focus();
        }}
        onKeyDown={(e) => {
          if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
            e.preventDefault();
            void submit(false);
          }
        }}
      >
        <header className="border-b px-5 pt-5 pb-4 pr-12">
          <SheetTitle>Nova conta a pagar</SheetTitle>
          <SheetDescription id="composer-desc" className="mt-0.5">
            Para o que não vem em nota de compra: aluguel, energia, impostos, boletos avulsos.
          </SheetDescription>
        </header>

        <form
          className="flex min-h-0 flex-1 flex-col"
          onSubmit={(e) => {
            e.preventDefault();
            void submit(false);
          }}
        >
          <div className="flex-1 space-y-4 overflow-y-auto px-5 py-5">
            <Field
              id="c-barcode"
              label="Linha digitável do boleto"
              optional
              hint="Cole aqui e o valor e o vencimento são preenchidos para você."
              error={barcodeBad ? (boleto.reason === 'LENGTH' ? 'A linha digitável deve ter 47 ou 48 dígitos.' : 'Os dígitos não conferem: confira se copiou o número inteiro.') : null}
            >
              <div className="relative">
                <ScanBarcode aria-hidden className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
                <Input id="c-barcode" inputMode="numeric" autoComplete="off" value={f.barcode} onChange={(e) => set('barcode', e.target.value)} className="pr-9 pl-9" aria-invalid={!!barcodeBad} />
                {boleto === 'loading' && <Loader2 aria-hidden className="absolute top-1/2 right-3 size-4 -translate-y-1/2 animate-spin text-muted-foreground" />}
              </div>
            </Field>
            {filled && (
              <p role="status" className="-mt-2 flex items-start gap-2 rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-900">
                <Sparkles aria-hidden className="mt-0.5 size-4 shrink-0" /> {filled}
              </p>
            )}

            <Field id="c-supplier" label="Fornecedor ou credor" hint={known?.cnpj ? `CNPJ ${formatCnpj(known.cnpj)}` : undefined}>
              <Input ref={first} id="c-supplier" list="composer-suppliers" value={f.supplier} onChange={(e) => set('supplier', e.target.value)} required maxLength={200} autoComplete="off" />
              <datalist id="composer-suppliers">
                {suppliers.map((s) => (
                  <option key={`${s.cnpj}-${s.name}`} value={s.name} />
                ))}
              </datalist>
            </Field>

            <div className="grid grid-cols-2 gap-3">
              <Field id="c-amount" label="Valor total (R$)">
                <Input id="c-amount" inputMode="decimal" placeholder="0,00" value={f.amount} onChange={(e) => set('amount', e.target.value)} required />
              </Field>
              <Field id="c-due" label={installments > 1 ? 'Primeiro vencimento' : 'Vencimento'}>
                <Input id="c-due" type="date" value={f.due} min={undefined} onChange={(e) => set('due', e.target.value)} required />
              </Field>
            </div>

            {dups.length > 0 && (
              <div role="alert" className="rounded-lg bg-amber-50 px-3 py-2.5 text-sm text-amber-900">
                <p className="flex items-center gap-2 font-medium">
                  <AlertTriangle aria-hidden className="size-4 shrink-0" /> Parece que esta conta já existe
                </p>
                <ul className="mt-1 space-y-0.5 text-xs">
                  {dups.map((d) => (
                    <li key={d.id} className="tabular">
                      {d.supplierName} · {money(d.amount)} · vence {civilDate(d.dueDate)} · {d.status === 'PAID' ? 'já paga' : 'em aberto'}
                      {d.documentNumber ? ` · Doc ${d.documentNumber}` : ''}
                    </li>
                  ))}
                </ul>
                <p className="mt-1 text-xs">Se for outra conta mesmo, pode lançar.</p>
              </div>
            )}

            <div className="grid grid-cols-2 gap-3">
              <Field
                id="c-inst"
                label="Parcelas"
                hint={installments > 1 && amount ? `${installments}× de ${money(amount / installments)}, uma por mês` : 'Mensais, de valor igual'}
              >
                <Input id="c-inst" type="number" min={1} max={60} value={f.installments} onChange={(e) => set('installments', e.target.value)} />
              </Field>
              <Field id="c-doc" label="Nº do documento" optional>
                <Input id="c-doc" value={f.doc} onChange={(e) => set('doc', e.target.value)} maxLength={60} />
              </Field>
            </div>

            <Field id="c-cat" label="Categoria" optional>
              <Input id="c-cat" list="composer-categories" value={f.category} onChange={(e) => set('category', e.target.value)} maxLength={60} autoComplete="off" />
              <datalist id="composer-categories">
                {categories.map((c) => (
                  <option key={c} value={c} />
                ))}
              </datalist>
            </Field>
            <Field id="c-desc" label="Descrição" optional>
              <Input id="c-desc" value={f.description} onChange={(e) => set('description', e.target.value)} maxLength={300} />
            </Field>
            <Field id="c-notes" label="Observações" optional>
              <Textarea id="c-notes" value={f.notes} onChange={(e) => set('notes', e.target.value)} maxLength={1000} />
            </Field>

            {error && (
              <p role="alert" className="text-sm text-red-800">
                {error}
              </p>
            )}
          </div>

          <footer className={cn('flex flex-wrap items-center justify-end gap-2 border-t bg-background px-5 py-3')}>
            <span className="mr-auto hidden text-xs text-muted-foreground sm:block">Ctrl+Enter lança</span>
            <Button type="button" variant="outline" disabled={!canSubmit} onClick={() => void submit(true)}>
              Lançar e adicionar outra
            </Button>
            <Button type="submit" disabled={!canSubmit}>
              {saving && <Loader2 aria-hidden className="animate-spin" />} Lançar
            </Button>
          </footer>
        </form>
      </SheetContent>
    </Sheet>
  );
}

export { todayIso };
