import type { ReactNode } from 'react';
import { QueryProvider } from '@/components/query-provider';

// Portal público do cliente (fora de (app)): precisa do próprio provider do TanStack Query.
export default function PortalLayout({ children }: { children: ReactNode }) {
  return <QueryProvider>{children}</QueryProvider>;
}
