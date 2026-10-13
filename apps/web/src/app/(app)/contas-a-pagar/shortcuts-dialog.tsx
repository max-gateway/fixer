'use client';

import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { Kbd } from '@/components/nav/kbd';

const GROUPS: { title: string; items: [string[], string][] }[] = [
  {
    title: 'Navegar',
    items: [
      [['J'], 'Próxima conta'],
      [['K'], 'Conta anterior'],
      [['Enter'], 'Abrir detalhes'],
      [['Esc'], 'Fechar / limpar'],
      [['F'], 'Buscar'],
    ],
  },
  {
    title: 'Agir',
    items: [
      [['X'], 'Selecionar a conta em foco'],
      [['Shift', 'clique'], 'Selecionar um intervalo'],
      [['P'], 'Pagar (a conta em foco ou a seleção)'],
      [['C'], 'Nova conta'],
      [['A'], 'Selecionar todas as visíveis'],
    ],
  },
  {
    title: 'Abas',
    items: [
      [['1', '…', '6'], 'Em aberto, vencidas, 7 dias, pagas, canceladas, todas'],
      [['?'], 'Esta ajuda'],
    ],
  },
];

export function ShortcutsDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogTitle>Atalhos de teclado</DialogTitle>
        <DialogDescription className="mt-1">Funcionam quando o foco não está num campo de texto.</DialogDescription>
        <div className="mt-4 space-y-5">
          {GROUPS.map((g) => (
            <section key={g.title}>
              <h3 className="mb-2 text-xs font-semibold tracking-wide text-muted-foreground uppercase">{g.title}</h3>
              <dl className="space-y-1.5">
                {g.items.map(([keys, label]) => (
                  <div key={label} className="flex items-center justify-between gap-4 text-sm">
                    <dt>{label}</dt>
                    <dd className="flex shrink-0 gap-1">
                      {keys.map((k, i) => (
                        <Kbd key={i} className="text-foreground">
                          {k}
                        </Kbd>
                      ))}
                    </dd>
                  </div>
                ))}
              </dl>
            </section>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}
