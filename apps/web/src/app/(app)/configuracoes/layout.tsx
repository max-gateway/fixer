import type { ReactNode } from 'react';
import { SettingsNav } from './settings-nav';

// Moldura comum das configurações: a navegação entre as seções fica fixa no topo; cada página traz o próprio título.
export default function ConfiguracoesLayout({ children }: { children: ReactNode }) {
  return (
    <div className="space-y-6">
      <SettingsNav />
      {children}
    </div>
  );
}
