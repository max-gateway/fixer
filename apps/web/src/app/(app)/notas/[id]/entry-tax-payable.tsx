'use client';

import { useMutation } from '@tanstack/react-query';
import { Loader2, Receipt } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { UnitInput } from '@/components/unit-input';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { postJson } from '@/lib/client-api';
import { parsePrice } from '@/lib/pricing';

/** Monta o corpo do POST /payables para o ICMS de entrada da nota. Valor estimado pelo Fixer; o vencimento é da pessoa. */
export function entryTaxPayableBody(input: { amount: number; dueDate: string; invoiceNumber: number | null; supplierName: string; estimated: boolean }) {
  const nf = input.invoiceNumber != null ? `NF ${input.invoiceNumber}` : 'nota de compra';
  return {
    supplierName: 'SEFAZ-PE',
    description: `ICMS de entrada (${input.estimated ? 'antecipação' : 'ST'}) · ${nf} · ${input.supplierName}`.slice(0, 300),
    category: 'Tributos de entrada',
    dueDate: input.dueDate,
    amount: Number(input.amount.toFixed(2)),
    installments: 1,
    notes: input.estimated
      ? 'Valor estimado pelo Fixer a partir do informativo da SEFAZ-PE. Confira o valor exato no extrato do sistema Fronteiras.'
      : 'Valor calculado pelo Fixer (RICMS-PE, Anexo 37). Confira com o extrato da SEFAZ-PE antes de pagar.',
  };
}

/**
 * "Criar conta a pagar" do ICMS que a oficina recolhe na entrada (UI §9.1). Nunca cria sozinho: abre com o valor calculado,
 * pede o vencimento (vem do extrato da SEFAZ-PE) e só grava ao confirmar.
 */
export function EntryTaxPayable({ amount, estimated, invoiceNumber, supplierName }: { amount: string; estimated: boolean; invoiceNumber: number | null; supplierName: string }) {
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState(Number(amount).toFixed(2).replace('.', ','));
  const [due, setDue] = useState('');
  const [submitted, setSubmitted] = useState(false);
  const create = useMutation({
    mutationFn: (body: object) => postJson('/api/payables', body, 'Não foi possível criar a conta a pagar.'),
  });
  const parsed = parsePrice(value);
  const errors = { value: parsed === null ? 'Informe o valor em reais' : null, due: due ? null : 'Informe o vencimento' };

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    setSubmitted(true);
    if (errors.value || errors.due) return;
    create.mutate(entryTaxPayableBody({ amount: parsed!, dueDate: due, invoiceNumber, supplierName, estimated }));
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button type="button" size="sm" variant="outline" className="mt-1">
          <Receipt aria-hidden /> Criar conta a pagar
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogTitle>Conta a pagar do ICMS de entrada</DialogTitle>
        <DialogDescription>
          {estimated ? 'O valor é uma estimativa.' : 'O valor foi calculado pelo Fixer.'} O vencimento e o valor exato estão no extrato da SEFAZ-PE.
        </DialogDescription>
        {create.isSuccess ? (
          <p role="status" className="text-sm text-emerald-800">
            Conta criada em Contas a pagar.
          </p>
        ) : (
          <form onSubmit={onSubmit} className="space-y-4" noValidate>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field id="etp-amount" label="Valor" error={submitted ? errors.value : null}>
                <UnitInput id="etp-amount" unit="R$" side="start" value={value} onChange={(e) => setValue(e.target.value)} error={submitted ? errors.value : null} />
              </Field>
              <Field id="etp-due" label="Vencimento" error={submitted ? errors.due : null}>
                <Input id="etp-due" type="date" value={due} onChange={(e) => setDue(e.target.value)} aria-invalid={submitted && errors.due ? true : undefined} />
              </Field>
            </div>
            {create.error && (
              <p role="alert" className="text-sm font-medium text-destructive">
                {create.error.message}
              </p>
            )}
            <Button type="submit" disabled={create.isPending}>
              {create.isPending && <Loader2 aria-hidden className="animate-spin" />} Criar conta
            </Button>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
