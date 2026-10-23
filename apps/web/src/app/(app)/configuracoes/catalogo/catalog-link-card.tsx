'use client';

import { useMutation } from '@tanstack/react-query';
import { CircleCheck, Library, Loader2, ScanSearch, TriangleAlert } from 'lucide-react';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import type { LinkReport } from '@/lib/catalog';
import { postJson } from '@/lib/client-api';

const URL = '/api/parts/catalog-links/by-barcode';

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** O resultado em palavras: só as linhas que existem, no tom de quem explica o que fazer. `linked` esconde "podem ser vinculadas" (já foram). */
function summaryLines(s: LinkReport['summary'], applied: boolean): string[] {
  const lines: string[] = [];
  if (!applied && s.linkable > 0) lines.push(plural(s.linkable, 'pode ser vinculada', 'podem ser vinculadas'));
  if (s.ambiguousCatalog > 0) lines.push(plural(s.ambiguousCatalog, 'tem mais de uma peça no catálogo com o mesmo código', 'têm mais de uma peça no catálogo com o mesmo código'));
  if (s.ambiguousLocal > 0) lines.push(plural(s.ambiguousLocal, 'tem código de barras repetido no seu estoque', 'têm código de barras repetido no seu estoque'));
  if (s.conflict > 0) lines.push(plural(s.conflict, 'já é de outra peça do seu estoque', 'já são de outra peça do seu estoque'));
  if (s.noMatch > 0) lines.push(`${s.noMatch} sem correspondência no catálogo`);
  return lines;
}

/**
 * Vínculo em lote das peças do estoque com o catálogo da plataforma, pelo código de barras. Em duas etapas deliberadas: verificar (só simula, não grava
 * nada) e vincular (pede confirmação). Só o que casa com exatamente uma peça livre do catálogo é vinculado; o resto é decisão da pessoa, item a item.
 */
export function CatalogLinkCard() {
  const [report, setReport] = useState<LinkReport | null>(null);
  const [applied, setApplied] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const check = useMutation({
    mutationFn: () => postJson<LinkReport>(URL, {}, 'Não foi possível verificar as peças.'),
    onSuccess: (r) => {
      setReport(r);
      setApplied(false);
      setConfirming(false);
      setError(null);
    },
    onError: (e) => setError(e.message),
  });
  const apply = useMutation({
    mutationFn: () => postJson<LinkReport>(URL, { apply: true }, 'Não foi possível vincular as peças.'),
    onSuccess: (r) => {
      setReport(r);
      setApplied(true);
      setConfirming(false);
      setError(null);
    },
    onError: (e) => {
      setConfirming(false);
      setError(e.message);
    },
  });

  const busy = check.isPending || apply.isPending;
  const linkable = report?.summary.linkable ?? 0;
  const lines = report ? summaryLines(report.summary, applied) : [];

  return (
    <section aria-labelledby="catalogo-title" className="space-y-4 rounded-2xl border bg-card p-5 shadow-xs">
      <div className="flex items-start gap-3">
        <span aria-hidden className="grid size-9 shrink-0 place-items-center rounded-lg bg-brand/10 text-brand">
          <Library className="size-5" />
        </span>
        <div className="min-w-0">
          <h2 id="catalogo-title" className="text-base font-semibold">
            Vincular peças ao catálogo
          </h2>
          <p className="text-sm text-muted-foreground">
            O catálogo da plataforma tem milhares de peças com nome, número e compatibilidade. Aqui o Fixer procura, pelo código de barras, a peça do catálogo que corresponde a cada peça do seu estoque. Verificar não altera nada; vincular só
            acontece depois da sua confirmação.
          </p>
        </div>
      </div>

      {error && (
        <p role="alert" className="flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 p-3 text-sm font-medium text-red-900">
          <TriangleAlert aria-hidden className="mt-0.5 size-4 shrink-0" /> {error}
        </p>
      )}

      {report && (
        <div className="space-y-2 rounded-lg bg-muted/50 p-4 text-sm">
          <p className="font-medium">{plural(report.scanned, 'peça verificada', 'peças verificadas')}</p>
          {applied && (
            <p className="flex items-center gap-1.5 font-medium text-emerald-800">
              <CircleCheck aria-hidden className="size-4" /> {plural(report.summary.linked, 'peça vinculada', 'peças vinculadas')}
            </p>
          )}
          {lines.length > 0 && (
            <ul className="list-disc space-y-0.5 pl-5">
              {lines.map((l) => (
                <li key={l}>{l}</li>
              ))}
            </ul>
          )}
          {!applied && linkable === 0 && <p className="text-muted-foreground">Nenhuma peça para vincular agora.</p>}
          {report.truncated && <p className="text-xs text-muted-foreground">Há mais peças para verificar: rode a verificação de novo depois de vincular.</p>}
        </div>
      )}

      {confirming ? (
        <div className="space-y-3 rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-950">
          <p className="font-medium">Vincular {plural(linkable, 'peça', 'peças')} ao catálogo pelo código de barras?</p>
          <p className="text-xs">O vínculo pode ser desfeito peça a peça depois.</p>
          <div className="flex flex-wrap gap-2">
            <Button type="button" size="sm" disabled={busy} onClick={() => apply.mutate()}>
              {apply.isPending && <Loader2 aria-hidden className="animate-spin" />} Confirmar
            </Button>
            <Button type="button" size="sm" variant="ghost" disabled={busy} onClick={() => setConfirming(false)}>
              Cancelar
            </Button>
          </div>
        </div>
      ) : (
        <div className="flex flex-wrap gap-2">
          {report && !applied && linkable > 0 && (
            <Button type="button" disabled={busy} onClick={() => setConfirming(true)}>
              {linkable === 1 ? 'Vincular a peça' : `Vincular as ${linkable} peças`}
            </Button>
          )}
          <Button type="button" variant={report && !applied && linkable > 0 ? 'outline' : 'default'} disabled={busy} onClick={() => check.mutate()}>
            {check.isPending ? <Loader2 aria-hidden className="animate-spin" /> : <ScanSearch aria-hidden />} {report ? 'Verificar de novo' : 'Verificar peças'}
          </Button>
        </div>
      )}
    </section>
  );
}
