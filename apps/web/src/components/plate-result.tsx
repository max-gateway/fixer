'use client';

import { useRef, useState } from 'react';
import { plateCharOk } from './plate-guide';

export type PlateReading = { status: 'accepted' | 'pending_vote' | 'rejected'; plate?: string | null; confidence?: number };

/**
 * Folha de resultado: recorte enviado, placa em 7 caixas editáveis e ações. Caracteres que
 * violam o formato (letra onde vai número e vice-versa) ficam destacados e bloqueiam "Usar placa".
 * `plate` ausente significa que não houve leitura: mostra só a mensagem e as saídas.
 */
export function PlateResult({
  thumb,
  reading,
  error,
  busy,
  onUse,
  onRetry,
  onManual,
}: {
  thumb: string | null;
  reading: PlateReading | null;
  error: string | null;
  busy: boolean;
  onUse: (plate: string) => void;
  onRetry: () => void;
  onManual: () => void;
}) {
  const [chars, setChars] = useState<string[]>(() => normalize(reading?.plate));
  const cells = useRef<(HTMLInputElement | null)[]>([]);
  const hasPlate = !!reading?.plate;
  const bad = chars.map((c, i) => !plateCharOk(i, c));
  const valid = !bad.some(Boolean);
  const uncertain = reading?.status === 'pending_vote';
  const pct = Math.round(reading?.confidence ?? 0);

  function write(index: number, raw: string) {
    const v = raw.toUpperCase().replace(/[^A-Z0-9]/g, '');
    const next = [...chars];
    if (!v) next[index] = '';
    for (let k = 0; k < v.length && index + k < 7; k++) next[index + k] = v[k]!;
    setChars(next);
    if (v) cells.current[Math.min(6, index + v.length)]?.focus();
  }

  return (
    <div className="absolute inset-x-0 bottom-0 z-30 grid gap-4 rounded-t-3xl bg-card p-4 pb-[max(1rem,env(safe-area-inset-bottom))] text-slate-900 shadow-2xl animate-in slide-in-from-bottom duration-300">
      <div className="grid grid-cols-[112px_minmax(0,1fr)] items-center gap-4">
        <div className="relative overflow-hidden rounded-lg border border-slate-200 bg-black">
          {thumb && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={thumb} alt="Recorte enviado" className="block w-full" />
          )}
          {busy && <div className="absolute inset-x-0 top-0 h-1/4 animate-pulse bg-gradient-to-b from-transparent via-brand/60 to-transparent" />}
        </div>
        <div className="grid min-w-0 gap-1" aria-live="polite">
          {busy ? (
            <>
              <b className="text-base">Lendo placa…</b>
              <span className="text-sm text-slate-600">Enviando só o recorte da placa.</span>
            </>
          ) : hasPlate ? (
            <>
              <span className={`w-fit rounded-full px-2.5 py-0.5 text-xs font-semibold ${uncertain || !valid ? 'bg-amber-100 text-amber-800' : 'bg-green-100 text-green-800'}`}>
                {uncertain || !valid ? 'Leitura incerta' : `Leitura confiável · ${pct}%`}
              </span>
              <b className="text-base">{valid && !uncertain ? 'Placa lida' : 'Confira a placa'}</b>
              <span className="text-sm text-slate-600">
                {valid ? 'Confira antes de continuar.' : 'Corrija o caractere em destaque.'}
              </span>
            </>
          ) : (
            <>
              <span className="w-fit rounded-full bg-amber-100 px-2.5 py-0.5 text-xs font-semibold text-amber-800">Sem leitura</span>
              <b className="text-base">Não encontrei a placa</b>
              <span className="text-sm text-slate-600">{error ?? 'Chegue mais perto e enquadre só a placa, ou digite.'}</span>
            </>
          )}
        </div>
      </div>

      {hasPlate && !busy && (
        <div className="overflow-hidden rounded-xl border-2 border-slate-800 bg-slate-100">
          <div className="bg-blue-800 py-0.5 text-center text-[10px] font-bold tracking-[0.3em] text-white">BRASIL</div>
          <div className="grid grid-cols-7 gap-1 px-2.5 pb-2 pt-2">
            {chars.map((c, i) => (
              <div key={i} className="grid gap-1">
                <input
                  ref={(el) => {
                    cells.current[i] = el;
                  }}
                  value={c}
                  maxLength={7}
                  autoComplete="off"
                  aria-label={`Caractere ${i + 1} da placa`}
                  aria-invalid={bad[i]}
                  onFocus={(e) => e.target.select()}
                  onChange={(e) => write(i, e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Backspace' && !c && i > 0) cells.current[i - 1]?.focus();
                    if (e.key === 'Enter' && valid) onUse(chars.join(''));
                  }}
                  className={`h-14 w-full rounded-md text-center text-3xl font-bold uppercase text-slate-900 caret-brand outline-none focus:bg-brand/10 ${bad[i] ? 'animate-pulse bg-amber-200/70' : 'bg-transparent'}`}
                />
                <div className={`h-1 rounded-full ${bad[i] ? 'bg-amber-500' : 'bg-green-700/70'}`} />
              </div>
            ))}
          </div>
        </div>
      )}

      {!busy && (
        <div className="flex gap-2">
          <button type="button" onClick={hasPlate ? onRetry : onManual} className="h-11 flex-1 rounded-lg border border-slate-300 text-sm font-medium">
            {hasPlate ? 'Refazer' : 'Digitar'}
          </button>
          {hasPlate ? (
            <button
              type="button"
              disabled={!valid}
              onClick={() => onUse(chars.join(''))}
              className="h-11 flex-[1.6] rounded-lg bg-brand text-sm font-semibold text-white transition hover:bg-brand-hover disabled:cursor-not-allowed disabled:opacity-45"
            >
              Usar placa
            </button>
          ) : (
            <button type="button" onClick={onRetry} className="h-11 flex-[1.6] rounded-lg bg-brand text-sm font-semibold text-white transition hover:bg-brand-hover">
              Tentar de novo
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function normalize(plate?: string | null): string[] {
  const v = (plate ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 7);
  return Array.from({ length: 7 }, (_, i) => v[i] ?? '');
}
