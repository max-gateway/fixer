'use client';

import { useMutation } from '@tanstack/react-query';
import { CheckCheck, FileDown, PackageCheck, Loader2, ShieldCheck } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Button, buttonVariants } from '@/components/ui/button';
import { postJson } from '@/lib/client-api';

/** Ações no nível da nota: lançar a entrada, baixar o XML, dar a ciência da operação e liberar a revisão. */
export function InvoiceActions({
  id,
  hasXml,
  canManifest,
  needsReview,
  editable,
  ready,
}: {
  id: string;
  hasXml: boolean;
  canManifest: boolean;
  needsReview: boolean;
  editable: boolean;
  /** Nota READY: todos os itens resolvidos, falta só lançar a entrada. */
  ready: boolean;
}) {
  const router = useRouter();
  const [message, setMessage] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null);

  const manifest = useMutation({
    mutationFn: () => postJson<{ status: string; message: string | null }>(`/api/invoices/${id}/manifest`, {}, 'Não foi possível dar a ciência.'),
    onSuccess: (r) => {
      setMessage(
        r.message
          ? { tone: 'error', text: `A SEFAZ recusou: ${r.message}` }
          : { tone: 'ok', text: 'Ciência registrada. O XML completo chega na próxima sincronização (até 1 hora).' },
      );
      router.refresh();
    },
    onError: (e) => setMessage({ tone: 'error', text: e.message }),
  });

  const review = useMutation({
    mutationFn: () => postJson(`/api/invoices/${id}/clear-review`, {}, 'Não foi possível liberar a nota.'),
    onSuccess: () => router.refresh(),
    onError: (e) => setMessage({ tone: 'error', text: e.message }),
  });

  const confirm = useMutation({
    mutationFn: () => postJson(`/api/invoices/${id}/confirm`, {}, 'Não foi possível lançar a entrada.'),
    onSuccess: () => {
      setMessage({ tone: 'ok', text: 'Entrada lançada no estoque.' });
      router.refresh();
    },
    onError: (e) => setMessage({ tone: 'error', text: e.message }),
  });

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-2">
        {ready && (
          <Button type="button" onClick={() => confirm.mutate()} disabled={confirm.isPending}>
            {confirm.isPending ? <Loader2 aria-hidden className="animate-spin" /> : <PackageCheck aria-hidden />} Lançar entrada no estoque
          </Button>
        )}
        {canManifest && (
          <Button type="button" onClick={() => manifest.mutate()} disabled={manifest.isPending}>
            {manifest.isPending ? <Loader2 aria-hidden className="animate-spin" /> : <ShieldCheck aria-hidden />} Dar ciência e baixar XML
          </Button>
        )}
        {editable && needsReview && (
          <Button type="button" variant="outline" onClick={() => review.mutate()} disabled={review.isPending}>
            {review.isPending ? <Loader2 aria-hidden className="animate-spin" /> : <CheckCheck aria-hidden />} Revisei esta nota
          </Button>
        )}
        {hasXml && (
          // O proxy não repassa Content-Disposition; `download` força o salvamento em vez de abrir o XML na aba.
          <a href={`/api/invoices/${id}/xml`} download className={buttonVariants({ variant: 'outline' })}>
            <FileDown aria-hidden /> Baixar XML
          </a>
        )}
      </div>
      {message && (
        <p role={message.tone === 'error' ? 'alert' : 'status'} className={message.tone === 'error' ? 'text-sm font-medium text-destructive' : 'text-sm text-emerald-800'}>
          {message.text}
        </p>
      )}
    </div>
  );
}
