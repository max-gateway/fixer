'use client';

import { Info, TriangleAlert, X } from 'lucide-react';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { alertCopy, dismissKey, type CertificateAlert } from '@/lib/certificate-alert';

const TONE = {
  info: 'border-sky-200 bg-sky-50 text-sky-950',
  warn: 'border-amber-200 bg-amber-50 text-amber-950',
  error: 'border-red-200 bg-red-50 text-red-900',
} as const;

/** `localStorage` pode lançar (janela privada, dados bloqueados): nesse caso o aviso simplesmente continua visível. */
function readDismissed(key: string): boolean {
  try {
    return window.localStorage.getItem(key) === '1';
  } catch {
    return false;
  }
}

/** Faixa de vencimento do certificado digital, na área interna toda. Só a API decide nível e prazo. */
export function CertificateBanner({ alert, orgId }: { alert: CertificateAlert; orgId: string }) {
  const copy = alertCopy(alert);
  const key = dismissKey(orgId, alert);
  // Começa visível (sem esconder o que é crítico) e some depois da hidratação se já foi dispensado.
  const [hidden, setHidden] = useState(false);
  useEffect(() => setHidden(copy.dismissible && readDismissed(key)), [copy.dismissible, key]);
  if (hidden) return null;

  const Icon = copy.tone === 'info' ? Info : TriangleAlert;
  return (
    <div role={copy.tone === 'error' ? 'alert' : 'status'} className={`border-b ${TONE[copy.tone]}`}>
      <div className="mx-auto flex max-w-6xl items-start gap-3 px-4 py-3 text-sm sm:px-6">
        <Icon aria-hidden className="mt-0.5 size-4 shrink-0" />
        <p className="min-w-0 flex-1">
          <span className="font-semibold">{copy.title}</span> {copy.detail}{' '}
          <Link href="/configuracoes" className="font-medium underline underline-offset-2">
            Renovar certificado
          </Link>
        </p>
        {copy.dismissible && (
          <button
            type="button"
            aria-label="Dispensar aviso"
            className="-m-1 shrink-0 rounded p-1 hover:bg-black/5 focus-visible:outline-2"
            onClick={() => {
              try {
                window.localStorage.setItem(key, '1');
              } catch {
                /* sem armazenamento: dispensa só até recarregar */
              }
              setHidden(true);
            }}
          >
            <X aria-hidden className="size-4" />
          </button>
        )}
      </div>
    </div>
  );
}
