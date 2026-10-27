'use client';

import { Kbd } from '@/components/nav/kbd';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';

const SHORTCUTS: [string[], string][] = [
  [['/'], 'Ir para a busca'],
  [['↑', '↓'], 'Navegar nas sugestões'],
  [['j', 'k'], 'Próxima / anterior peça da lista'],
  [['Enter'], 'Abrir a peça selecionada'],
  [['c'], 'Copiar o código da peça selecionada'],
  [['x'], 'Marcar a peça para comparar'],
  [['v'], 'Alternar entre lista e grade'],
  [['['], 'Página anterior'],
  [[']'], 'Próxima página'],
  [['Esc'], 'Fechar ou limpar a busca'],
  [['?'], 'Mostrar esta ajuda'],
];

export function ShortcutsDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogTitle>Atalhos de teclado</DialogTitle>
        <DialogDescription className="mb-3">Funcionam fora dos campos de texto.</DialogDescription>
        <dl className="divide-y text-sm">
          {SHORTCUTS.map(([keys, label]) => (
            <div key={label} className="flex items-center justify-between gap-4 py-2">
              <dt>{label}</dt>
              <dd className="flex gap-1">
                {keys.map((k) => (
                  <Kbd key={k} className="text-muted-foreground">
                    {k}
                  </Kbd>
                ))}
              </dd>
            </div>
          ))}
        </dl>
      </DialogContent>
    </Dialog>
  );
}
