'use client';

import { Check, Loader2 } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { Field } from '@/components/ui/field';
import { Input, Select } from '@/components/ui/input';
import { METHOD_LABEL, money, parseMoneyInput, payTotal, PAYMENT_METHODS, sumAmounts, todayIso, type PayableRow, type PaymentMethod } from '@/lib/payables';
import type { PayInput } from './hooks';

const LAST_METHOD = 'fixer.payables.method';
const readMethod = (): PaymentMethod | '' => {
  try {
    const v = localStorage.getItem(LAST_METHOD);
    return v && (PAYMENT_METHODS as readonly string[]).includes(v) ? (v as PaymentMethod) : '';
  } catch {
    return '';
  }
};

/**
 * Pagamento de uma conta (com juros e desconto) ou de várias de uma vez (cada uma pelo valor previsto). Lembra a última
 * forma de pagamento usada, que costuma se repetir.
 */
export function PayDialog({
  rows,
  onClose,
  onSubmit,
  pending,
}: {
  rows: PayableRow[] | null;
  onClose: () => void;
  onSubmit: (input: PayInput) => void;
  pending: boolean;
}) {
  const open = !!rows?.length;
  const single = rows?.length === 1 ? rows[0]! : null;
  const [paidAt, setPaidAt] = useState(todayIso());
  const [method, setMethod] = useState<PaymentMethod | ''>('');
  const [interest, setInterest] = useState('');
  const [discount, setDiscount] = useState('');

  useEffect(() => {
    if (!open) return;
    setPaidAt(todayIso());
    setMethod(readMethod());
    setInterest('');
    setDiscount('');
  }, [open]);

  const i = parseMoneyInput(interest) ?? 0;
  const d = parseMoneyInput(discount) ?? 0;
  const total = useMemo(() => (single ? payTotal(single.amount, i, d) : null), [single, i, d]);
  const invalid = !!single && (i < 0 || d < 0 || (total !== null && total <= 0));
  const bulkTotal = rows ? sumAmounts(rows) : '0.00';

  const submit = () => {
    if (invalid || pending) return;
    try {
      if (method) localStorage.setItem(LAST_METHOD, method);
    } catch {
      /* sem armazenamento: só não lembra */
    }
    onSubmit({ paidAt, method: method || undefined, ...(single ? { interest: i || undefined, discount: d || undefined } : {}) });
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && !pending && onClose()}>
      <DialogContent>
        <DialogTitle>{single ? 'Registrar pagamento' : `Pagar ${rows?.length ?? 0} contas`}</DialogTitle>
        <DialogDescription className="mt-1">
          {single ? (
            <>
              {single.supplierName}
              {single.documentNumber ? ` · Doc ${single.documentNumber}` : ''}
              {single.installmentCount > 1 ? ` · parcela ${single.installment}/${single.installmentCount}` : ''}
            </>
          ) : (
            'Cada conta é paga pelo valor previsto, na data e forma abaixo.'
          )}
        </DialogDescription>

        <form
          className="mt-4 space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
        >
          <div className="rounded-xl bg-muted/70 px-4 py-3">
            <p className="text-xs text-muted-foreground">{single ? 'Valor da conta' : 'Total a pagar'}</p>
            <p className="tabular text-2xl font-semibold tracking-tight">{money(single ? single.amount : bulkTotal)}</p>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <Field id="pay-date" label="Data do pagamento">
              <Input id="pay-date" type="date" value={paidAt} max={todayIso()} onChange={(e) => setPaidAt(e.target.value)} required />
            </Field>
            <Field id="pay-method" label="Forma" optional>
              <Select id="pay-method" value={method} onChange={(e) => setMethod(e.target.value as PaymentMethod | '')}>
                <option value="">Não informar</option>
                {PAYMENT_METHODS.map((m) => (
                  <option key={m} value={m}>
                    {METHOD_LABEL[m]}
                  </option>
                ))}
              </Select>
            </Field>
          </div>

          {single && (
            <div className="grid grid-cols-2 gap-3">
              <Field id="pay-interest" label="Juros e multa" optional>
                <Input id="pay-interest" inputMode="decimal" placeholder="0,00" value={interest} onChange={(e) => setInterest(e.target.value)} />
              </Field>
              <Field id="pay-discount" label="Desconto" optional>
                <Input id="pay-discount" inputMode="decimal" placeholder="0,00" value={discount} onChange={(e) => setDiscount(e.target.value)} />
              </Field>
            </div>
          )}

          {single && total !== null && (i > 0 || d > 0) && (
            <p className={invalid ? 'text-sm text-red-800' : 'tabular text-sm text-muted-foreground'} role={invalid ? 'alert' : undefined}>
              {invalid ? 'O desconto não pode zerar a conta.' : <>Total pago: <strong className="text-foreground">{money(total)}</strong></>}
            </p>
          )}

          <div className="flex justify-end gap-2 pt-1">
            <Button type="button" variant="ghost" onClick={onClose} disabled={pending}>
              Cancelar
            </Button>
            <Button type="submit" disabled={invalid || pending}>
              {pending ? <Loader2 aria-hidden className="animate-spin" /> : <Check aria-hidden />} Confirmar pagamento
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
