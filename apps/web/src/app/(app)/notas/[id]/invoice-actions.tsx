'use client';

import { useMutation } from '@tanstack/react-query';
import { ArrowDown, CheckCheck, Link2, Loader2, PackageCheck, ShieldCheck, Tag } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Button, buttonVariants } from '@/components/ui/button';
import { postJson } from '@/lib/client-api';

/**
 * Ações no nível da nota. Há UMA ação principal por vez, a que leva ao próximo passo: dar a ciência, revisar a nota, vincular os
 * itens pendentes ou lançar a entrada. As demais ficam como secundárias.
 */
export function InvoiceActions({
  id,
  canManifest,
  needsReview,
  editable,
  ready,
  unresolvedCount = 0,
  firstPending = null,
  hasItems = false,
}: {
  id: string;
  canManifest: boolean;
  needsReview: boolean;
  editable: boolean;
  /** Nota READY: todos os itens resolvidos, falta só lançar a entrada. */
  ready: boolean;
  /** Itens ainda sem peça e o número do primeiro deles (a ação principal leva até ele). */
  unresolvedCount?: number;
  firstPending?: number | null;
  /** A página tem o passo de preços (itens vinculados): oferece o atalho "Revisar preços". */
  hasItems?: boolean;
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

  const reviewing = editable && needsReview;
  const linking = editable && !reviewing && unresolvedCount > 0 && firstPending !== null;
  const launching = ready && !reviewing;

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        {canManifest && (
          <Button type="button" onClick={() => manifest.mutate()} disabled={manifest.isPending}>
            {manifest.isPending ? <Loader2 aria-hidden className="animate-spin" /> : <ShieldCheck aria-hidden />} Dar ciência e baixar XML
          </Button>
        )}
        {reviewing && (
          <Button type="button" onClick={() => review.mutate()} disabled={review.isPending}>
            {review.isPending ? <Loader2 aria-hidden className="animate-spin" /> : <CheckCheck aria-hidden />} Revisei esta nota
          </Button>
        )}
        {linking && (
          <a href={`#item-${firstPending}`} className={buttonVariants()}>
            <Link2 aria-hidden /> Vincular {unresolvedCount === 1 ? '1 item pendente' : `${unresolvedCount} itens pendentes`} <ArrowDown aria-hidden />
          </a>
        )}
        {launching && (
          <Button type="button" onClick={() => confirm.mutate()} disabled={confirm.isPending}>
            {confirm.isPending ? <Loader2 aria-hidden className="animate-spin" /> : <PackageCheck aria-hidden />} Lançar entrada no estoque
          </Button>
        )}
        {launching && hasItems && (
          <a href="#precificar" className={buttonVariants({ variant: 'outline' })}>
            <Tag aria-hidden /> Revisar preços antes
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
