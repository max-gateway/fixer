'use client';

import { ChevronDown, SlidersHorizontal } from 'lucide-react';
import { useEffect, useState, type ReactNode } from 'react';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';

// Âncoras que moram dentro do painel: os avisos da página ("Registrar validação", "Ir para as tabelas") abrem o painel e rolam até elas.
const ANCHORS = ['ajustes', 'tabelas', 'validacao-contador'];

/** Ajustes manuais e validação do contador, recolhidos: a visão da página é o painel; aqui é só edição. */
export function AdjustmentsPanel({ children, pending }: { children: ReactNode; pending: boolean }) {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const go = () => {
      const id = window.location.hash.slice(1);
      if (!ANCHORS.includes(id)) return;
      setOpen(true);
      // O conteúdo só existe depois de aberto: rola no quadro seguinte.
      requestAnimationFrame(() => document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' }));
    };
    go();
    window.addEventListener('hashchange', go);
    return () => window.removeEventListener('hashchange', go);
  }, []);

  return (
    <Collapsible id="ajustes" open={open} onOpenChange={setOpen} className="scroll-mt-24 rounded-xl border bg-card shadow-xs">
      <CollapsibleTrigger className="group flex w-full items-center gap-3 rounded-xl p-5 text-left outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50">
        <span aria-hidden className="grid size-9 shrink-0 place-items-center rounded-lg bg-muted">
          <SlidersHorizontal className="size-4" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-semibold">
            Ajustes e validação do contador
            {pending && <span className="ml-2 rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-900">há pendências</span>}
          </span>
          <span className="block text-xs text-muted-foreground">Regime, ISS, receita, situação na SEFAZ, percentuais do contador e tabelas da lei. Só quando a fonte oficial não trouxe o valor.</span>
        </span>
        <ChevronDown aria-hidden className="size-4 shrink-0 text-muted-foreground transition-transform group-data-[state=open]:rotate-180" />
      </CollapsibleTrigger>
      <CollapsibleContent className="space-y-6 border-t p-5">{children}</CollapsibleContent>
    </Collapsible>
  );
}
