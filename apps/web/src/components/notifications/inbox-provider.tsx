'use client';

import { createContext, useContext, type ReactNode } from 'react';
import { useInboxStore, type InboxStore } from './use-inbox-store';

const Ctx = createContext<InboxStore | null>(null);

/** Uma única conexão SSE por aba, compartilhada pelo sino e pela página /notificacoes. */
export function InboxProvider({ children }: { children: ReactNode }) {
  return <Ctx.Provider value={useInboxStore()}>{children}</Ctx.Provider>;
}

export function useInbox(): InboxStore {
  const store = useContext(Ctx);
  if (!store) throw new Error('useInbox precisa estar dentro de <InboxProvider>');
  return store;
}
