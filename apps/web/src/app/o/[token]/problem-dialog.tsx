'use client';

import { useEffect, useRef, useState } from 'react';
import { Icon } from '@/components/icons';
import { SYMPTOM_LABEL, WHEN_LABEL } from '@/lib/portal';

export type ProblemInput = { body: string; symptoms: string[]; when: string | null };

/** Relato guiado do problema: o cliente escolhe sintomas e quando ocorrem, e descreve com as próprias palavras. */
export function ProblemDialog({ open, onClose, onSubmit }: { open: boolean; onClose: () => void; onSubmit: (p: ProblemInput) => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  const [symptoms, setSymptoms] = useState<string[]>([]);
  const [when, setWhen] = useState<string | null>(null);
  const [body, setBody] = useState('');

  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);

  const valid = body.trim().length >= 3;
  const submit = () => {
    if (!valid) return;
    onSubmit({ body: body.trim(), symptoms, when });
    setBody('');
    setSymptoms([]);
    setWhen(null);
  };

  return (
    <dialog
      ref={ref}
      onClose={onClose}
      onClick={(e) => e.target === ref.current && onClose()}
      aria-labelledby="problem-title"
      className="m-0 mt-auto w-full max-w-none rounded-t-3xl bg-card p-0 text-foreground shadow-2xl backdrop:bg-black/50 backdrop:backdrop-blur-sm sm:m-auto sm:max-w-lg sm:rounded-3xl"
    >
      <div className="max-h-[90dvh] space-y-5 overflow-y-auto p-5 sm:p-6">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 id="problem-title" className="text-lg font-semibold">
              Conte o que está acontecendo
            </h2>
            <p className="text-sm text-slate-600">Quanto mais detalhes, mais rápido o diagnóstico.</p>
          </div>
          <button onClick={onClose} aria-label="Fechar" className="grid size-9 shrink-0 place-items-center rounded-full text-slate-500 hover:bg-slate-100">
            <Icon name="x" />
          </button>
        </div>

        <fieldset className="space-y-2">
          <legend className="text-sm font-medium text-slate-700">O que você notou? (pode marcar vários)</legend>
          <div className="flex flex-wrap gap-2">
            {Object.entries(SYMPTOM_LABEL).map(([key, label]) => {
              const on = symptoms.includes(key);
              return (
                <button
                  key={key}
                  type="button"
                  aria-pressed={on}
                  onClick={() => setSymptoms((s) => (on ? s.filter((x) => x !== key) : [...s, key]))}
                  className={`rounded-full border px-3.5 py-2 text-sm transition active:scale-95 ${on ? 'border-brand bg-brand text-white' : 'border-slate-200 hover:border-brand'}`}
                >
                  {label}
                </button>
              );
            })}
          </div>
        </fieldset>

        <fieldset className="space-y-2">
          <legend className="text-sm font-medium text-slate-700">Quando acontece?</legend>
          <div className="flex flex-wrap gap-2">
            {Object.entries(WHEN_LABEL).map(([key, label]) => {
              const on = when === key;
              return (
                <button
                  key={key}
                  type="button"
                  aria-pressed={on}
                  onClick={() => setWhen(on ? null : key)}
                  className={`rounded-full border px-3.5 py-2 text-sm transition active:scale-95 ${on ? 'border-brand bg-brand text-white' : 'border-slate-200 hover:border-brand'}`}
                >
                  {label}
                </button>
              );
            })}
          </div>
        </fieldset>

        <label className="block space-y-2">
          <span className="text-sm font-medium text-slate-700">Descreva com suas palavras</span>
          <textarea
            value={body}
            onChange={(e) => setBody(e.target.value.slice(0, 2000))}
            rows={4}
            placeholder="Ex.: desde segunda-feira ouço um barulho metálico na roda da frente direita ao passar em buracos…"
            className="w-full resize-none rounded-2xl border border-slate-200 px-4 py-3 text-[15px] outline-none focus:border-brand focus:ring-4 focus:ring-brand/10"
          />
        </label>

        <button
          onClick={submit}
          disabled={!valid}
          className="w-full rounded-2xl bg-brand py-3.5 font-semibold text-white shadow-sm transition enabled:active:scale-[0.99] disabled:bg-slate-200 disabled:text-slate-400"
        >
          Enviar para a oficina
        </button>
      </div>
    </dialog>
  );
}
