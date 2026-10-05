'use client';

import { useEffect, useRef, useState } from 'react';

type Reading = {
  status: 'processing' | 'accepted' | 'pending_vote' | 'rejected';
  plate?: string | null;
  confidence?: number;
};

const POLL_MS = 1000;
const MAX_POLLS = 20;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Moldura de enquadramento (em fração do quadro do vídeo). Ela obriga a placa a
// ocupar uma fração razoável da imagem na resolução original do sensor (placa
// minúscula num quadro cheio não é detectada pelo reader).
//
// O recorte enviado NÃO pode ser justo na placa: o detector do reader descarta
// contornos acima de 35% da área da imagem (_MAX_PLATE_AREA_FRACTION em
// apps/plate-reader/app/pipeline/plate_detection.py), e uma placa bem recortada
// passa disso — medido: recorte justo ou com 12% de folga => 0 regiões detectadas.
// Por isso o recorte é bem folgado em volta da moldura (placa em ~10–20% da área).
const GUIDE = { w: 0.5, aspect: 3.2, cy: 0.55 };
const CROP_SCALE_W = 2.2; // largura do recorte / largura da moldura
const CROP_SCALE_H = 5; // altura do recorte / altura da moldura

/** Retângulo de recorte em pixels do vídeo, centrado na moldura e limitado ao quadro. */
export function guideCrop(vw: number, vh: number) {
  const gw = vw * GUIDE.w;
  const gh = gw / GUIDE.aspect;
  const w = Math.min(vw, gw * CROP_SCALE_W);
  const h = Math.min(vh, gh * CROP_SCALE_H);
  const x = (vw - w) / 2;
  const y = Math.max(0, Math.min(vh - h, vh * GUIDE.cy - h / 2));
  return { x: Math.round(x), y: Math.round(y), w: Math.round(w), h: Math.round(h) };
}

/**
 * Lê a placa via OCR (plate-reader). Abre a câmera com uma moldura para enquadrar a
 * placa de perto; se a câmera não estiver disponível, aceita um arquivo. O resultado
 * é assíncrono (polling) e a placa lida sempre pode ser corrigida pelo usuário.
 */
export function PlateCapture({ onPlate }: { onPlate: (plate: string) => void }) {
  const fileInput = useRef<HTMLInputElement>(null);
  const cameraInput = useRef<HTMLInputElement>(null);
  const video = useRef<HTMLVideoElement>(null);
  const stream = useRef<MediaStream | null>(null);
  const [cameraOn, setCameraOn] = useState(false);
  const [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => () => stopCamera(), []);

  function stopCamera() {
    stream.current?.getTracks().forEach((t) => t.stop());
    stream.current = null;
    setCameraOn(false);
  }

  async function startCamera() {
    setMessage(null);
    if (!navigator.mediaDevices?.getUserMedia) {
      // Sem HTTPS o navegador móvel bloqueia getUserMedia: abre a câmera nativa (capture) no lugar.
      cameraInput.current?.click();
      return;
    }
    try {
      stream.current = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 }, height: { ideal: 1080 } },
        audio: false,
      });
      setCameraOn(true);
      // O <video> só existe depois do render com cameraOn.
      requestAnimationFrame(() => {
        if (video.current && stream.current) {
          video.current.srcObject = stream.current;
          void video.current.play();
        }
      });
    } catch {
      setMessage('Não foi possível acessar a câmera (permissão negada?). Abrindo a câmera do aparelho…');
      cameraInput.current?.click();
    }
  }

  function capture() {
    const v = video.current;
    if (!v || !v.videoWidth) return;
    const { x, y, w, h } = guideCrop(v.videoWidth, v.videoHeight);
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    canvas.getContext('2d')!.drawImage(v, x, y, w, h, 0, 0, w, h);
    stopCamera();
    canvas.toBlob(
      (blob) => {
        if (blob) void read(blob, 'placa.jpg');
        else setMessage('Falha ao capturar a imagem.');
      },
      'image/jpeg',
      0.92,
    );
  }

  async function read(image: Blob, filename: string) {
    setBusy(true);
    setMessage('Lendo placa…');
    setPreview((old) => {
      if (old) URL.revokeObjectURL(old);
      return URL.createObjectURL(image);
    });
    try {
      const form = new FormData();
      form.set('image', image, filename);
      const sent = await fetch('/api/plate-readings', { method: 'POST', body: form });
      const sentBody = await sent.json().catch(() => ({}));
      if (!sent.ok) return setMessage(sentBody.message ?? 'Falha ao enviar a imagem.');

      for (let i = 0; i < MAX_POLLS; i++) {
        await sleep(POLL_MS);
        const res = await fetch(`/api/plate-readings/${sentBody.requestId}`);
        if (!res.ok) return setMessage('Falha ao consultar a leitura.');
        const reading = (await res.json()) as Reading;
        if (reading.status === 'processing') continue;

        if (reading.plate) {
          onPlate(reading.plate);
          const pct = Math.round(reading.confidence ?? 0);
          return setMessage(
            reading.status === 'accepted'
              ? `Placa lida: ${reading.plate} (${pct}%). Confira antes de continuar.`
              : `Leitura incerta: ${reading.plate} (${pct}%). Confira e corrija se preciso.`,
          );
        }
        return setMessage('Não foi possível ler a placa. Chegue mais perto, enquadre só a placa ou digite manualmente.');
      }
      setMessage('A leitura demorou demais. Digite a placa manualmente.');
    } catch {
      setMessage('Falha de rede.');
    } finally {
      setBusy(false);
      if (fileInput.current) fileInput.current.value = '';
    }
  }

  return (
    <div className="space-y-2">
      <input
        ref={fileInput}
        type="file"
        accept="image/jpeg,image/png"
        hidden
        onChange={(e) => e.target.files?.[0] && read(e.target.files[0], e.target.files[0].name)}
      />

      <input
        ref={cameraInput}
        type="file"
        accept="image/*"
        capture="environment"
        hidden
        onChange={(e) => e.target.files?.[0] && read(e.target.files[0], e.target.files[0].name)}
      />

      {cameraOn ? (
        <div className="max-w-md space-y-2">
          <div className="relative overflow-hidden rounded bg-black">
            <video ref={video} playsInline muted className="block w-full" />
            <div
              aria-hidden
              className="pointer-events-none absolute rounded border-2 border-white shadow-[0_0_0_9999px_rgba(0,0,0,0.5)]"
              style={{
                width: `${GUIDE.w * 100}%`,
                aspectRatio: String(GUIDE.aspect),
                left: `${((1 - GUIDE.w) / 2) * 100}%`,
                top: `${GUIDE.cy * 100}%`,
                transform: 'translateY(-50%)',
              }}
            />
          </div>
          <p className="text-sm text-slate-600">Enquadre só a placa dentro da moldura, de frente e bem iluminada.</p>
          <div className="flex gap-2">
            <button type="button" onClick={capture} className="rounded bg-brand px-4 py-2 transition hover:bg-brand-hover text-sm font-medium text-white">
              Capturar
            </button>
            <button type="button" onClick={stopCamera} className="rounded border border-slate-300 px-4 py-2 text-sm">
              Cancelar
            </button>
          </div>
        </div>
      ) : (
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            disabled={busy}
            onClick={startCamera}
            className="rounded border border-slate-300 px-4 py-2 text-sm disabled:opacity-60"
          >
            {busy ? 'Lendo…' : 'Ler placa com a câmera'}
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => fileInput.current?.click()}
            className="rounded border border-slate-300 px-4 py-2 text-sm disabled:opacity-60"
          >
            Enviar foto
          </button>
        </div>
      )}

      {preview && (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={preview} alt="Imagem enviada" className="max-h-40 rounded border border-slate-200" />
      )}
      {message && <p className="text-sm text-slate-600">{message}</p>}
    </div>
  );
}
