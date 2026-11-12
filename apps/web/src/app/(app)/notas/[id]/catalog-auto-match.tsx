'use client';

import { useMutation } from '@tanstack/react-query';
import { Loader2, Sparkles } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useEffect, useRef } from 'react';
import { postJson } from '@/lib/client-api';

type Report = { resolved: number; created: number; unresolved: number };

/**
 * Ao abrir uma nota com itens sem peça, pede ao servidor para casá-los com o catálogo (GTIN ou código do fabricante) e já cadastrar/vincular a peça da
 * oficina. Roda uma vez por abertura; só recarrega a página se algo foi resolvido (sem laço). O catálogo é auxílio: falha some em silêncio e a conciliação
 * manual segue do mesmo jeito.
 */
export function CatalogAutoMatch({ invoiceId }: { invoiceId: string }) {
  const router = useRouter();
  const started = useRef(false);
  const match = useMutation({
    mutationFn: () => postJson<Report>(`/api/invoices/${invoiceId}/catalog-match`, {}, 'Não foi possível consultar o catálogo.'),
    onSuccess: (r) => {
      if (r.resolved > 0) router.refresh();
    },
  });

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    match.mutate();
  }, [match]);

  if (match.isPending) {
    return (
      <p role="status" className="flex items-center gap-2 rounded-lg border border-brand/30 bg-brand/5 px-3 py-2 text-sm text-muted-foreground">
        <Loader2 aria-hidden className="size-4 animate-spin" /> Conferindo os itens com o catálogo…
      </p>
    );
  }
  if (match.data && match.data.resolved > 0) {
    return (
      <p role="status" className="flex items-center gap-2 rounded-lg border border-brand/30 bg-brand/5 px-3 py-2 text-sm">
        <Sparkles aria-hidden className="size-4 text-brand" />
        {match.data.resolved} {match.data.resolved === 1 ? 'item foi ligado' : 'itens foram ligados'} sozinho ao catálogo
        {match.data.created > 0 && ` (${match.data.created} ${match.data.created === 1 ? 'peça cadastrada' : 'peças cadastradas'} na oficina)`}.
      </p>
    );
  }
  return null;
}
