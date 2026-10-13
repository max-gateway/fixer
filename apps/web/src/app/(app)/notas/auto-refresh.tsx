'use client';

import { useRouter } from 'next/navigation';
import { useEffect } from 'react';

/** Reexecuta a página do servidor a cada minuto (só com a aba visível), para os tempos relativos não ficarem velhos. */
export function AutoRefresh({ everyMs = 60_000 }: { everyMs?: number }) {
  const router = useRouter();
  useEffect(() => {
    const id = setInterval(() => {
      if (document.visibilityState === 'visible') router.refresh();
    }, everyMs);
    return () => clearInterval(id);
  }, [router, everyMs]);
  return null;
}
