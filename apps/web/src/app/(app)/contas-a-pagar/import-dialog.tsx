'use client';

import { FileDown, Loader2 } from 'lucide-react';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { money, todayIso, type ImportResult } from '@/lib/payables';
import { cn } from '@/lib/utils';

type Run = (input: { settleBefore?: string; dryRun: boolean }) => Promise<ImportResult>;

/**
 * Importa as contas das notas de compra já recebidas, lendo o XML guardado de cada uma. Mostra uma prévia ao vivo
 * (sem gravar) e deixa escolher o que fazer com o que já venceu: notas antigas costumam ter parcelas já pagas, e
 * importar tudo "em aberto" encheria a aba de vencidas.
 */
export function ImportDialog({ open, onClose, run, onDone }: { open: boolean; onClose: () => void; run: Run; onDone: (r: ImportResult) => void }) {
  const [mode, setMode] = useState<'open' | 'settle'>('open');
  const [date, setDate] = useState(todayIso());
  const [preview, setPreview] = useState<ImportResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [importing, setImporting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const seq = useRef(0);

  useEffect(() => {
    if (open) {
      setMode('open');
      setDate(todayIso());
      setPreview(null);
      setError(null);
    }
  }, [open]);

  // Prévia ao vivo; respostas fora de ordem (o usuário mexeu na data de novo) são descartadas.
  useEffect(() => {
    if (!open || (mode === 'settle' && !date)) return;
    const mine = ++seq.current;
    setLoading(true);
    const id = setTimeout(() => {
      run({ dryRun: true, ...(mode === 'settle' ? { settleBefore: date } : {}) })
        .then((r) => {
          if (mine === seq.current) {
            setPreview(r);
            setError(null);
          }
        })
        .catch((e: Error) => mine === seq.current && setError(e.message))
        .finally(() => mine === seq.current && setLoading(false));
    }, 250);
    return () => clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, mode, date]);

  const toCreate = (preview?.open.count ?? 0) + (preview?.settled.count ?? 0);

  const submit = async () => {
    setImporting(true);
    setError(null);
    try {
      onDone(await run({ dryRun: false, ...(mode === 'settle' ? { settleBefore: date } : {}) }));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setImporting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && !importing && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogTitle>Importar das notas já recebidas</DialogTitle>
        <DialogDescription className="mt-1">
          As parcelas vêm das duplicatas do XML original de cada nota de compra. Pode repetir quando quiser: o que já foi importado é pulado.
        </DialogDescription>

        <fieldset className="mt-4 space-y-2">
          <legend className="mb-1 text-sm font-medium">O que fazer com parcelas que já venceram?</legend>
          <Choice checked={mode === 'open'} onChange={() => setMode('open')} title="Deixar tudo em aberto" hint="Você confere e dá baixa depois (dá para pagar várias de uma vez)." />
          <Choice
            checked={mode === 'settle'}
            onChange={() => setMode('settle')}
            title="Marcar como pagas as que venceram antes de uma data"
            hint="Para o histórico que já foi quitado. Entram como pagas na data do vencimento."
          >
            {mode === 'settle' && (
              <label className="mt-2 flex items-center gap-2 text-sm">
                Vencidas antes de
                <Input type="date" value={date} max={todayIso()} onChange={(e) => setDate(e.target.value)} className="h-8 w-40" />
              </label>
            )}
          </Choice>
        </fieldset>

        <div className={cn('mt-4 rounded-xl border bg-muted/40 p-4 text-sm transition-opacity', loading && 'opacity-60')} aria-live="polite" aria-busy={loading}>
          {!preview ? (
            error ? (
              <p role="alert" className="text-red-800">
                {error}
              </p>
            ) : (
              <p className="flex items-center gap-2 text-muted-foreground">
                <Loader2 aria-hidden className="size-4 animate-spin" /> Lendo as notas…
              </p>
            )
          ) : (
            <>
              <p>
                <strong>{preview.invoices}</strong> {preview.invoices === 1 ? 'nota com cobrança' : 'notas com cobrança'} · <strong>{preview.installments}</strong>{' '}
                {preview.installments === 1 ? 'parcela' : 'parcelas'}
                {preview.alreadyExisting > 0 && <span className="text-muted-foreground"> ({preview.alreadyExisting} já importadas)</span>}
              </p>
              {toCreate === 0 ? (
                <p className="mt-2 font-medium">{preview.installments === 0 ? 'Nenhuma nota com duplicatas para importar.' : 'Tudo já está importado.'}</p>
              ) : (
                <ul className="mt-2 space-y-1">
                  {preview.open.count > 0 && (
                    <li>
                      <strong>{preview.open.count}</strong> {preview.open.count === 1 ? 'conta entra' : 'contas entram'} em aberto · <span className="tabular">{money(preview.open.amount)}</span>
                    </li>
                  )}
                  {preview.settled.count > 0 && (
                    <li>
                      <strong>{preview.settled.count}</strong> {preview.settled.count === 1 ? 'conta entra' : 'contas entram'} como paga · <span className="tabular">{money(preview.settled.amount)}</span>
                    </li>
                  )}
                </ul>
              )}
              {(preview.withoutBilling > 0 || preview.unreadable > 0) && (
                <p className="mt-2 text-xs text-muted-foreground">
                  {preview.withoutBilling > 0 && `${preview.withoutBilling} ${preview.withoutBilling === 1 ? 'nota não informa' : 'notas não informam'} cobrança no XML. `}
                  {preview.unreadable > 0 && `${preview.unreadable} XML não pôde ser lido.`}
                </p>
              )}
            </>
          )}
        </div>

        {error && preview && (
          <p role="alert" className="mt-2 text-sm text-red-800">
            {error}
          </p>
        )}

        <div className="mt-5 flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose} disabled={importing}>
            Cancelar
          </Button>
          <Button onClick={submit} disabled={importing || loading || toCreate === 0}>
            {importing ? <Loader2 aria-hidden className="animate-spin" /> : <FileDown aria-hidden />}{' '}
            {toCreate > 0 ? `Importar ${toCreate} ${toCreate === 1 ? 'conta' : 'contas'}` : 'Importar'}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function Choice({ checked, onChange, title, hint, children }: { checked: boolean; onChange: () => void; title: string; hint: string; children?: ReactNode }) {
  return (
    <label className={cn('block cursor-pointer rounded-xl border p-3 transition-colors', checked ? 'border-brand bg-brand-soft' : 'hover:bg-muted/50')}>
      <span className="flex items-start gap-2.5">
        <input type="radio" checked={checked} onChange={onChange} className="mt-1 accent-[var(--brand-primary)]" />
        <span>
          <span className="block text-sm font-medium">{title}</span>
          <span className="block text-xs text-muted-foreground">{hint}</span>
        </span>
      </span>
      {children}
    </label>
  );
}
