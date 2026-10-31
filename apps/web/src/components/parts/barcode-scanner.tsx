'use client';

import { Loader2, ScanBarcode, VideoOff } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';

type Detector = { detect: (source: CanvasImageSource) => Promise<{ rawValue: string }[]> };
type DetectorCtor = new (opts: { formats: string[] }) => Detector;

const FORMATS = ['ean_13', 'ean_8', 'upc_a', 'upc_e', 'itf', 'code_128'];

/** O navegador sabe ler código de barras da câmera? (Chrome/Edge sim; Safari e Firefox ainda não.) */
export function canScanBarcodes(): boolean {
  return typeof window !== 'undefined' && 'BarcodeDetector' in window && Boolean(navigator.mediaDevices?.getUserMedia);
}

/** Aponta a câmera para o código de barras da caixa da peça; ao ler, devolve os dígitos e fecha. */
export function BarcodeScanner({ open, onOpenChange, onDetect }: { open: boolean; onOpenChange: (open: boolean) => void; onDetect: (code: string) => void }) {
  const video = useRef<HTMLVideoElement>(null);
  const [state, setState] = useState<'starting' | 'scanning' | 'denied'>('starting');
  // Os callbacks mudam a cada render da página; se entrassem nas dependências do efeito, a câmera reiniciaria o tempo todo.
  const handlers = useRef({ onDetect, onOpenChange });
  handlers.current = { onDetect, onOpenChange };

  useEffect(() => {
    if (!open) return;
    let stop = false;
    let stream: MediaStream | undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;
    setState('starting');
    (async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' } }, audio: false });
        if (stop) return stream.getTracks().forEach((t) => t.stop());
        const el = video.current;
        if (!el) return;
        el.srcObject = stream;
        await el.play();
        setState('scanning');
        const Ctor = (window as unknown as { BarcodeDetector: DetectorCtor }).BarcodeDetector;
        const detector = new Ctor({ formats: FORMATS });
        const tick = async () => {
          if (stop) return;
          try {
            const [hit] = await detector.detect(el);
            if (hit?.rawValue) {
              navigator.vibrate?.(30);
              handlers.current.onDetect(hit.rawValue.replace(/\D/g, '') || hit.rawValue);
              handlers.current.onOpenChange(false);
              return;
            }
          } catch {
            /* quadro sem imagem ainda: tenta no próximo */
          }
          timer = setTimeout(tick, 150);
        };
        void tick();
      } catch {
        if (!stop) setState('denied');
      }
    })();
    return () => {
      stop = true;
      if (timer) clearTimeout(timer);
      stream?.getTracks().forEach((t) => t.stop());
    };
  }, [open]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md gap-4">
        <div>
          <DialogTitle>Ler código de barras</DialogTitle>
          <DialogDescription>Aponte a câmera para o código da caixa. A busca começa sozinha quando ele for lido.</DialogDescription>
        </div>
        <div className="relative aspect-[4/3] overflow-hidden rounded-xl bg-black">
          <video ref={video} playsInline muted className="size-full object-cover" />
          {state === 'scanning' && (
            <div aria-hidden className="pointer-events-none absolute inset-0 grid place-items-center">
              <div className="relative h-24 w-4/5 rounded-lg border-2 border-white/80 shadow-[0_0_0_999px_rgb(0_0_0/0.35)]">
                <span className="absolute inset-x-2 top-1/2 h-0.5 animate-pulse bg-red-500/90" />
              </div>
            </div>
          )}
          {state === 'starting' && (
            <div className="absolute inset-0 grid place-items-center text-white/80">
              <Loader2 aria-hidden className="size-6 animate-spin" />
            </div>
          )}
          {state === 'denied' && (
            <div role="alert" className="absolute inset-0 grid place-items-center gap-2 p-6 text-center text-sm text-white/90">
              <span>
                <VideoOff aria-hidden className="mx-auto mb-2 size-6" />
                Não foi possível usar a câmera. Libere o acesso nas permissões do navegador ou digite o código.
              </span>
            </div>
          )}
        </div>
        <p className="flex items-center gap-2 text-xs text-muted-foreground">
          <ScanBarcode aria-hidden className="size-4" /> Funciona com EAN-13, EAN-8, UPC e Code 128.
        </p>
      </DialogContent>
    </Dialog>
  );
}
