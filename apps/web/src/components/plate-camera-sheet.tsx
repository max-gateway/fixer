'use client';

import { Camera, X, Zap, ZapOff } from 'lucide-react';
import { type ReactNode, useCallback, useEffect, useRef, useState } from 'react';
import { type Hint, analyzeFraming, judgeFraming } from './plate-framing';
import { analysisRegion, guideCrop, guideRect } from './plate-guide';

type ZoomCaps = { min: number; max: number };

const ANALYSIS_W = 256; // largura (px) da região analisada ao vivo
const TICK_MS = 120;
const STABLE_MS = 900; // tempo parado no enquadramento certo até a captura automática
const NO_HINT: Hint = { key: 'none', text: 'Aponte para a placa' };
const RING = 2 * Math.PI * 34;

/**
 * Câmera em tela cheia (modal no desktop) para fotografar só a placa. Mantém o stream aberto
 * enquanto o resultado é exibido por cima (`frozen`), para o usuário poder refazer sem pedir
 * a câmera de novo. Sem `live`, só mostra o fundo escuro (envio de arquivo).
 */
export function PlateCameraSheet({
  live,
  frozen,
  onCapture,
  onClose,
  onUnavailable,
  onManual,
  children,
}: {
  live: boolean;
  frozen: boolean;
  onCapture: (image: Blob) => void;
  onClose: () => void;
  onUnavailable: () => void;
  onManual: () => void;
  children?: ReactNode;
}) {
  const box = useRef<HTMLDivElement>(null);
  const video = useRef<HTMLVideoElement>(null);
  const track = useRef<MediaStreamTrack | null>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  const [zoomCaps, setZoomCaps] = useState<ZoomCaps | null>(null);
  const [zoom, setZoom] = useState(1);
  const [hasTorch, setHasTorch] = useState(false);
  const [torch, setTorch] = useState(false);
  const [flash, setFlash] = useState(false);
  const [hint, setHint] = useState<Hint>(NO_HINT);
  const [progress, setProgress] = useState(0);
  const [dark, setDark] = useState(false);
  const [auto, setAuto] = useState(true);
  const autoRef = useRef(true);
  const captureRef = useRef<() => void>(() => {});

  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const measure = () => setSize({ w: el.clientWidth, h: el.clientHeight });
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    document.body.style.overflow = 'hidden';
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => {
      document.body.style.overflow = '';
      window.removeEventListener('keydown', onKey);
    };
  }, [onClose]);

  useEffect(() => {
    if (!live) return;
    let cancelled = false;
    let stream: MediaStream | null = null;
    (async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 }, height: { ideal: 1080 } },
          audio: false,
        });
        if (cancelled) return stream.getTracks().forEach((t) => t.stop());
        const t = stream.getVideoTracks()[0];
        track.current = t;
        const caps = (t.getCapabilities?.() ?? {}) as { zoom?: ZoomCaps; torch?: boolean };
        setZoomCaps(caps.zoom && caps.zoom.max > caps.zoom.min ? caps.zoom : null);
        setHasTorch(!!caps.torch);
        if (video.current) {
          video.current.srcObject = stream;
          void video.current.play();
        }
      } catch {
        if (!cancelled) onUnavailable();
      }
    })();
    return () => {
      cancelled = true;
      stream?.getTracks().forEach((t) => t.stop());
      track.current = null;
    };
    // onUnavailable é estável o bastante: só importa no primeiro getUserMedia.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [live]);

  // Com o resultado aberto o quadro congela e a lanterna apaga; ao refazer, volta ao vivo.
  useEffect(() => {
    const v = video.current;
    if (!v || !live) return;
    if (frozen) {
      v.pause();
      void applyTorch(false);
    } else {
      void v.play();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [frozen, live]);

  // Detector de enquadramento: a cada TICK_MS analisa a região da moldura e orienta o usuário.
  // A dica só muda quando duas leituras seguidas concordam; parado em "ok" por STABLE_MS captura.
  useEffect(() => {
    if (!live || frozen || !size.w) return;
    const v = video.current;
    if (!v) return;
    const canvas = document.createElement('canvas');
    const c2d = canvas.getContext('2d', { willReadFrequently: true });
    if (!c2d) return;
    setHint(NO_HINT);
    setProgress(0);
    let stable = 0;
    let lastKey: Hint['key'] | null = null;
    let agree = 0;
    let shownKey: Hint['key'] = 'none';
    const id = setInterval(() => {
      if (!v.videoWidth || v.paused) return;
      const { region, guide } = analysisRegion(size.w, size.h, v.videoWidth, v.videoHeight);
      const k = ANALYSIS_W / region.w;
      const w = ANALYSIS_W;
      const h = Math.max(8, Math.round(region.h * k));
      canvas.width = w;
      canvas.height = h;
      c2d.drawImage(v, region.x, region.y, region.w, region.h, 0, 0, w, h);
      const { data } = c2d.getImageData(0, 0, w, h);
      const gray = new Uint8Array(w * h);
      for (let i = 0; i < gray.length; i++) gray[i] = (data[i * 4]! * 77 + data[i * 4 + 1]! * 150 + data[i * 4 + 2]! * 29) >> 8;
      const f = analyzeFraming(gray, w, h, { x: guide.x * k, y: guide.y * k, w: guide.w * k, h: guide.h * k });
      const next = judgeFraming(f);
      agree = next.key === lastKey ? agree + 1 : 1;
      lastKey = next.key;
      setDark(f.brightness < 70);
      if (agree < 2) return;
      if (next.key === 'ok' && shownKey !== 'ok') navigator.vibrate?.(20);
      shownKey = next.key;
      setHint((old) => (old.key === next.key && old.text === next.text ? old : next));
      stable = next.key === 'ok' && autoRef.current ? stable + TICK_MS : 0;
      setProgress(Math.min(1, stable / STABLE_MS));
      if (stable >= STABLE_MS) {
        stable = 0;
        captureRef.current();
      }
    }, TICK_MS);
    return () => clearInterval(id);
  }, [live, frozen, size.w, size.h]);

  const applyTorch = useCallback(async (on: boolean) => {
    try {
      await track.current?.applyConstraints({ advanced: [{ torch: on } as MediaTrackConstraintSet] });
      setTorch(on);
    } catch {
      setTorch(false);
    }
  }, []);

  async function applyZoom(level: number) {
    if (!zoomCaps) return;
    const value = Math.min(zoomCaps.max, zoomCaps.min * level);
    try {
      await track.current?.applyConstraints({ advanced: [{ zoom: value } as MediaTrackConstraintSet] });
      setZoom(level);
    } catch {
      /* aparelho recusou o zoom: mantém o atual */
    }
  }

  function capture() {
    const v = video.current;
    if (!v || !v.videoWidth || !size.w) return;
    const { x, y, w, h } = guideCrop(size.w, size.h, v.videoWidth, v.videoHeight);
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    canvas.getContext('2d')!.drawImage(v, x, y, w, h, 0, 0, w, h);
    navigator.vibrate?.(30);
    setFlash(true);
    setTimeout(() => setFlash(false), 250);
    canvas.toBlob((blob) => blob && onCapture(blob), 'image/jpeg', 0.92);
  }

  captureRef.current = capture;
  autoRef.current = auto;

  const g = size.w ? guideRect(size.w, size.h) : null;
  const guideTone = hint.key === 'ok' ? 'border-green-400' : hint.key === 'none' ? 'border-white' : 'border-amber-400';
  const hintTone = hint.key === 'ok' ? 'bg-green-400 text-green-950' : hint.key === 'none' ? 'bg-slate-900/80 text-white' : 'bg-amber-400 text-amber-950';
  const zoomLevels = zoomCaps ? [1, 2, 3].filter((l) => zoomCaps.min * l <= zoomCaps.max) : [];

  return (
    <div role="dialog" aria-modal="true" aria-label="Ler placa" className="fixed inset-0 z-50 md:grid md:place-items-center md:bg-black/60">
      <div
        ref={box}
        className="relative h-dvh w-full overflow-hidden bg-black text-white md:h-[min(92vh,780px)] md:max-w-[460px] md:rounded-2xl"
      >
        {live && <video ref={video} playsInline muted className="absolute inset-0 h-full w-full object-cover" />}

        {live && g && (
          <>
            <div
              aria-hidden
              className="pointer-events-none absolute rounded-xl shadow-[0_0_0_100vmax_rgba(6,10,16,0.6)]"
              style={{ left: g.x, top: g.y, width: g.w, height: g.h }}
            >
              {['left-0 top-0 border-l-4 border-t-4 rounded-tl-xl', 'right-0 top-0 border-r-4 border-t-4 rounded-tr-xl', 'bottom-0 left-0 border-b-4 border-l-4 rounded-bl-xl', 'bottom-0 right-0 border-b-4 border-r-4 rounded-br-xl'].map((c) => (
                <i key={c} className={`absolute size-7 transition-colors ${guideTone} ${c}`} />
              ))}
            </div>
            {!frozen && (
              <>
                <p
                  role="status"
                  aria-live="polite"
                  className={`pointer-events-none absolute left-1/2 max-w-[92%] -translate-x-1/2 -translate-y-full whitespace-nowrap rounded-full px-4 py-2 text-[15px] font-semibold transition-colors ${hintTone}`}
                  style={{ top: g.y - 16 }}
                >
                  {hint.text}
                </p>
                <div
                  className="pointer-events-none absolute inset-x-4 grid justify-items-center gap-2 text-center text-sm text-white/85"
                  style={{ top: g.y + g.h + 16 }}
                >
                  <p>Só a placa dentro da moldura. O carro não precisa aparecer.</p>
                  {dark && !torch && (
                    <p className="rounded-full bg-amber-400/20 px-3 py-1 font-medium text-amber-300">
                      Pouca luz{hasTorch ? ': ligue a lanterna' : ''}
                    </p>
                  )}
                </div>
              </>
            )}
          </>
        )}

        <div className="absolute inset-x-0 top-0 z-10 flex items-center gap-3 p-3">
          <button type="button" onClick={onClose} aria-label="Fechar" className="grid size-10 place-items-center rounded-full bg-white/15 backdrop-blur">
            <X className="size-5" />
          </button>
          <h2 className="flex-1 text-base font-semibold">Ler placa</h2>
          {live && hasTorch && !frozen && (
            <button
              type="button"
              onClick={() => applyTorch(!torch)}
              aria-pressed={torch}
              aria-label="Lanterna"
              className={`grid size-10 place-items-center rounded-full backdrop-blur ${torch ? 'bg-amber-400 text-slate-900' : 'bg-white/15'}`}
            >
              {torch ? <Zap className="size-5" /> : <ZapOff className="size-5" />}
            </button>
          )}
        </div>

        {live && !frozen && (
          <div className="absolute inset-x-0 bottom-0 z-10 flex flex-col items-center gap-4 bg-gradient-to-t from-black/85 to-transparent px-4 pb-[max(1.25rem,env(safe-area-inset-bottom))] pt-12">
            {zoomLevels.length > 1 && (
              <div role="group" aria-label="Zoom" className="flex gap-1 rounded-full bg-white/15 p-1">
                {zoomLevels.map((l) => (
                  <button
                    key={l}
                    type="button"
                    onClick={() => applyZoom(l)}
                    aria-pressed={zoom === l}
                    className={`h-8 min-w-11 rounded-full text-sm font-semibold ${zoom === l ? 'bg-white text-slate-900' : ''}`}
                  >
                    {l}×
                  </button>
                ))}
              </div>
            )}
            <div className="grid w-full grid-cols-[1fr_auto_1fr] items-center gap-2">
              <button
                type="button"
                onClick={() => setAuto((a) => !a)}
                aria-pressed={auto}
                className={`h-9 w-fit justify-self-start rounded-full border px-3 text-sm font-medium ${auto ? 'border-green-400 bg-green-400/15 text-green-300' : 'border-white/25 bg-white/10'}`}
              >
                Captura auto
              </button>
              <button
                type="button"
                onClick={capture}
                aria-label="Capturar placa"
                className="relative grid size-19 place-items-center rounded-full active:scale-95"
              >
                <svg viewBox="0 0 76 76" className="absolute inset-0" aria-hidden>
                  <circle cx="38" cy="38" r="34" fill="none" stroke="rgba(255,255,255,.35)" strokeWidth="4" />
                  <circle
                    cx="38"
                    cy="38"
                    r="34"
                    fill="none"
                    stroke="#4ade80"
                    strokeWidth="4"
                    strokeLinecap="round"
                    strokeDasharray={RING}
                    strokeDashoffset={RING * (1 - progress)}
                    transform="rotate(-90 38 38)"
                    className="transition-[stroke-dashoffset] duration-100"
                  />
                </svg>
                <span className={`grid size-14.5 place-items-center rounded-full text-slate-900 transition-colors ${hint.key === 'ok' ? 'bg-green-400' : 'bg-white'}`}>
                  <Camera className="size-6" />
                </span>
              </button>
              <button type="button" onClick={onManual} className="h-9 w-fit justify-self-end rounded-full border border-white/25 bg-white/10 px-3 text-sm font-medium">
                Digitar
              </button>
            </div>
          </div>
        )}

        {flash && <div aria-hidden className="pointer-events-none absolute inset-0 z-20 animate-out fade-out bg-white duration-300" />}
        {children}
      </div>
    </div>
  );
}
