'use client';

import { ImageOff } from 'lucide-react';
import { useState } from 'react';
import { cn } from '@/lib/utils';

/**
 * Foto da peça. Enquanto carrega mostra o brilho de espera e entra com fade; sem foto (ou se ela não carregar) mostra um ícone neutro,
 * para a linha manter o mesmo tamanho. Quem chama dá o tamanho e o arredondamento em `className` e usa `key={url}` para reiniciar ao trocar de peça.
 */
export function PartImage({ url, className }: { url?: string; className?: string }) {
  const [state, setState] = useState<'loading' | 'ready' | 'failed'>(url ? 'loading' : 'failed');
  return (
    <span aria-hidden className={cn('relative grid shrink-0 place-items-center overflow-hidden border bg-muted', className)}>
      {state === 'loading' && <span className="skeleton absolute inset-0" />}
      {state === 'failed' && <ImageOff className="size-1/3 text-muted-foreground/60" />}
      {url && state !== 'failed' && (
        <img
          src={url}
          alt=""
          loading="lazy"
          referrerPolicy="no-referrer"
          onLoad={() => setState('ready')}
          onError={() => setState('failed')}
          className={cn('size-full object-contain transition-opacity duration-300', state === 'ready' ? 'opacity-100' : 'opacity-0')}
        />
      )}
    </span>
  );
}
