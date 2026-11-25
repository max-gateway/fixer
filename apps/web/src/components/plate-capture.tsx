'use client';

import { CancelledError, useQueryClient } from '@tanstack/react-query';
import { Camera, Upload } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { PlateCameraSheet } from './plate-camera-sheet';
import { type PlateReading, PlateResult } from './plate-result';

type Reading = Omit<PlateReading, 'status'> & { status: 'processing' | PlateReading['status'] };

type Phase =
  | { kind: 'idle' }
  | { kind: 'camera' }
  | { kind: 'reading'; live: boolean; thumb: string }
  | { kind: 'result'; live: boolean; thumb: string; reading: PlateReading | null; error: string | null; n: number };

const POLL_MS = 1000;
const MAX_POLLS = 20;
class StillProcessing extends Error {}
class ReadingFailed extends Error {}
const isCancelled = (err: unknown) => err instanceof CancelledError;

/**
 * Lê a placa via OCR (plate-reader). A câmera abre em tela cheia com uma moldura grande (só a
 * placa, o carro não precisa aparecer); sem câmera, cai no seletor nativo. O resultado é
 * assíncrono (polling) e sempre passa por uma conferência do usuário antes de preencher o campo.
 * A geometria da moldura e do recorte está em plate-guide.ts.
 */
export function PlateCapture({
  onPlate,
  allowUpload = true,
  variant = 'default',
}: {
  onPlate: (plate: string) => void;
  allowUpload?: boolean;
  /** `inline`: botão de texto com ícone, para ficar numa linha de apoio abaixo do campo. */
  /** `tile`: botão quadrado só com ícone, para ficar ao lado do campo de placa (sem mensagens/upload). */
  variant?: 'default' | 'tile' | 'inline';
}) {
  const fileInput = useRef<HTMLInputElement>(null);
  const cameraInput = useRef<HTMLInputElement>(null);
  const thumb = useRef<string | null>(null);
  const run = useRef(0);
  const pending = useRef<unknown[] | null>(null);
  const queryClient = useQueryClient();
  const [phase, setPhase] = useState<Phase>({ kind: 'idle' });
  const [message, setMessage] = useState<string | null>(null);

  useEffect(
    () => () => {
      run.current++;
      if (pending.current) void queryClient.cancelQueries({ queryKey: pending.current });
      if (thumb.current) URL.revokeObjectURL(thumb.current);
    },
    [],
  );

  function openCamera() {
    setMessage(null);
    if (!navigator.mediaDevices?.getUserMedia) {
      // Sem HTTPS o navegador móvel bloqueia getUserMedia: abre a câmera nativa (capture) no lugar.
      cameraInput.current?.click();
      return;
    }
    setPhase({ kind: 'camera' });
  }

  function close() {
    run.current++; // descarta qualquer polling em andamento
    if (pending.current) void queryClient.cancelQueries({ queryKey: pending.current });
    setPhase({ kind: 'idle' });
  }

  function cameraUnavailable() {
    setPhase({ kind: 'idle' });
    setMessage('Não foi possível acessar a câmera (permissão negada?). Abrindo a câmera do aparelho…');
    cameraInput.current?.click();
  }

  async function read(image: Blob, filename: string, live: boolean) {
    const id = ++run.current;
    if (thumb.current) URL.revokeObjectURL(thumb.current);
    const url = (thumb.current = URL.createObjectURL(image));
    const done = (reading: PlateReading | null, error: string | null) => {
      if (run.current === id) setPhase({ kind: 'result', live, thumb: url, reading, error, n: id });
    };
    setPhase({ kind: 'reading', live, thumb: url });
    try {
      const form = new FormData();
      form.set('image', image, filename);
      const sent = await fetch('/api/plate-readings', { method: 'POST', body: form });
      const sentBody = await sent.json().catch(() => ({}));
      if (!sent.ok) return done(null, sentBody.message ?? 'Falha ao enviar a imagem.');

      // Polling via retry do TanStack Query: "processing" é lançado como erro retentável a cada POLL_MS.
      const key = ['plate-reading', sentBody.requestId];
      pending.current = key;
      const reading = await queryClient.fetchQuery({
        queryKey: key,
        staleTime: 0,
        gcTime: 0,
        retry: (count, err) => err instanceof StillProcessing && count < MAX_POLLS,
        retryDelay: POLL_MS,
        queryFn: async () => {
          const res = await fetch(`/api/plate-readings/${sentBody.requestId}`);
          if (!res.ok) throw new ReadingFailed();
          const r = (await res.json()) as Reading;
          if (r.status === 'processing') throw new StillProcessing();
          return r;
        },
      });
      if (run.current !== id) return;
      if (reading.plate) return done(reading as PlateReading, null);
      done(null, 'Chegue mais perto, enquadre só a placa ou digite manualmente.');
    } catch (err) {
      if (err instanceof StillProcessing) done(null, 'A leitura demorou demais. Digite a placa manualmente.');
      else if (err instanceof ReadingFailed) done(null, 'Falha ao consultar a leitura.');
      else if (!isCancelled(err)) done(null, 'Falha de rede.');
    } finally {
      if (fileInput.current) fileInput.current.value = '';
      if (cameraInput.current) cameraInput.current.value = '';
    }
  }

  function pickFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (file) void read(file, file.name, false);
  }

  function use(plate: string) {
    onPlate(plate);
    setMessage(`Placa ${plate} lida. Confira antes de continuar.`);
    close();
  }

  function typeInstead() {
    close();
    setMessage('Digite a placa no campo.');
  }

  const inline = variant === 'inline';
  const tile = variant === 'tile' || inline;

  return (
    <div className={tile ? 'contents' : 'space-y-2'}>
      {allowUpload && !tile && <input ref={fileInput} type="file" accept="image/jpeg,image/png" hidden onChange={pickFile} />}
      <input ref={cameraInput} type="file" accept="image/*" capture="environment" hidden onChange={pickFile} />

      {inline && (
        <button
          type="button"
          onClick={openCamera}
          className="inline-flex items-center gap-1.5 rounded-full bg-brand-soft px-3 py-1 text-sm font-semibold text-brand transition-colors hover:bg-brand hover:text-white focus-visible:ring-[3px] focus-visible:ring-ring/40 focus-visible:outline-none active:scale-95"
        >
          <Camera aria-hidden className="size-4" /> Ler com a câmera
        </button>
      )}
      {variant === 'tile' && (
        <button
          type="button"
          onClick={openCamera}
          aria-label="Ler placa com a câmera"
          title="Ler placa com a câmera"
          className="group grid w-20 shrink-0 place-items-center content-center gap-1 rounded-2xl border-2 border-brand/25 bg-brand-soft text-brand shadow-sm transition hover:border-brand hover:bg-brand hover:text-white focus-visible:ring-[3px] focus-visible:ring-ring/40 focus-visible:outline-none active:scale-95"
        >
          <Camera aria-hidden className="size-7 transition-transform group-hover:scale-110" />
          <span className="text-[11px] font-semibold uppercase tracking-wider">Câmera</span>
        </button>
      )}
      {!tile && <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={openCamera}
          className="inline-flex items-center gap-2 rounded bg-brand px-4 py-2 text-sm font-medium text-white transition hover:bg-brand-hover"
        >
          <Camera className="size-4" />
          Ler placa com a câmera
        </button>
        {allowUpload && (
          <button
            type="button"
            onClick={() => fileInput.current?.click()}
            className="inline-flex items-center gap-2 rounded border border-slate-300 px-4 py-2 text-sm"
          >
            <Upload className="size-4" />
            Enviar foto
          </button>
        )}
      </div>}

      {message && !tile && <p className="text-sm text-slate-600">{message}</p>}

      {phase.kind !== 'idle' && (
        <PlateCameraSheet
          live={phase.kind === 'camera' || phase.live}
          frozen={phase.kind !== 'camera'}
          onCapture={(blob) => void read(blob, 'placa.jpg', true)}
          onClose={close}
          onUnavailable={cameraUnavailable}
          onManual={typeInstead}
        >
          {phase.kind !== 'camera' && (
            <PlateResult
              key={phase.kind === 'result' ? phase.n : 'reading'}
              thumb={phase.thumb}
              busy={phase.kind === 'reading'}
              reading={phase.kind === 'result' ? phase.reading : null}
              error={phase.kind === 'result' ? phase.error : null}
              onUse={use}
              onRetry={() => (phase.live ? setPhase({ kind: 'camera' }) : openCamera())}
              onManual={typeInstead}
            />
          )}
        </PlateCameraSheet>
      )}
    </div>
  );
}
