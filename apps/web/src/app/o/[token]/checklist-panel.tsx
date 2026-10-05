'use client';

import { useState } from 'react';
import { Icon } from '@/components/icons';
import type { ChecklistItem, ChecklistStatus } from '@/lib/portal';

type Answer = (id: string, status: ChecklistStatus, note: string | null) => void;

export function ChecklistPanel({ items, readOnly, onAnswer }: { items: ChecklistItem[]; readOnly: boolean; onAnswer: Answer }) {
  const answered = items.filter((i) => i.status !== 'PENDING').length;
  const sections = [...new Set(items.map((i) => i.section))];
  const pct = items.length ? Math.round((answered / items.length) * 100) : 0;

  return (
    <div className="space-y-5">
      <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="mb-2 flex items-baseline justify-between">
          <h2 className="font-semibold">Checklist de entrada</h2>
          <span className="text-sm tabular-nums text-slate-500">
            {answered}/{items.length}
          </span>
        </div>
        <div className="h-2 overflow-hidden rounded-full bg-slate-100" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} aria-label="Checklist respondido">
          <div className="h-full rounded-full bg-emerald-500 transition-all duration-500" style={{ width: `${pct}%` }} />
        </div>
        <p className="mt-3 text-sm text-slate-600">
          {answered === items.length && items.length > 0
            ? 'Tudo respondido. Obrigado! 🎉'
            : 'Confirme o estado do veículo na entrada. Isso protege você e a oficina.'}
        </p>
      </div>

      {sections.map((section) => (
        <section key={section} className="space-y-2">
          <h3 className="px-1 text-xs font-semibold uppercase tracking-widest text-slate-500">{section}</h3>
          {items
            .filter((i) => i.section === section)
            .map((item) => (
              <Item key={item.id} item={item} readOnly={readOnly} onAnswer={onAnswer} />
            ))}
        </section>
      ))}
    </div>
  );
}

function Item({ item, readOnly, onAnswer }: { item: ChecklistItem; readOnly: boolean; onAnswer: Answer }) {
  const [note, setNote] = useState(item.note ?? '');
  const ok = item.status === 'OK';
  const issue = item.status === 'ISSUE';

  const toggle = (target: 'OK' | 'ISSUE') => {
    if (readOnly) return;
    const next: ChecklistStatus = item.status === target ? 'PENDING' : target;
    onAnswer(item.id, next, next === 'ISSUE' ? note || null : null);
    if (next !== 'ISSUE') setNote('');
  };

  return (
    <div
      className={`rounded-2xl border bg-white p-4 shadow-sm transition-colors ${
        ok ? 'border-emerald-300 bg-emerald-50/40' : issue ? 'border-amber-300 bg-amber-50/40' : 'border-slate-200'
      }`}
    >
      <p className="mb-3 text-[15px] leading-snug">{item.label}</p>
      <div className="grid grid-cols-2 gap-2" role="group" aria-label={item.label}>
        <button
          onClick={() => toggle('OK')}
          disabled={readOnly}
          aria-pressed={ok}
          className={`flex items-center justify-center gap-1.5 rounded-xl border px-3 py-2.5 text-sm font-medium transition active:scale-[0.97] ${
            ok ? 'border-emerald-500 bg-emerald-500 text-white' : 'border-slate-200 text-slate-700 hover:border-emerald-400'
          }`}
        >
          {ok && (
            <svg viewBox="0 0 24 24" className="size-4" fill="none" stroke="currentColor" strokeWidth={3} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path className="animate-tick" d="M20 6 9 17l-5-5" />
            </svg>
          )}
          Tudo certo
        </button>
        <button
          onClick={() => toggle('ISSUE')}
          disabled={readOnly}
          aria-pressed={issue}
          className={`flex items-center justify-center gap-1.5 rounded-xl border px-3 py-2.5 text-sm font-medium transition active:scale-[0.97] ${
            issue ? 'border-amber-500 bg-amber-500 text-white' : 'border-slate-200 text-slate-700 hover:border-amber-400'
          }`}
        >
          <Icon name="alert" className="size-4" />
          Tem observação
        </button>
      </div>

      {/* grid-rows 0fr -> 1fr anima a altura do campo de observação sem medir o DOM */}
      <div className={`grid transition-all duration-300 ${issue ? 'mt-3 grid-rows-[1fr] opacity-100' : 'grid-rows-[0fr] opacity-0'}`}>
        <div className="overflow-hidden">
          <label className="block">
            <span className="sr-only">Observação</span>
            <textarea
              value={note}
              onChange={(e) => setNote(e.target.value.slice(0, 500))}
              onBlur={() => note.trim() !== (item.note ?? '') && onAnswer(item.id, 'ISSUE', note.trim() || null)}
              disabled={readOnly}
              tabIndex={issue ? 0 : -1}
              rows={2}
              placeholder="Descreva o que chamou atenção…"
              className="w-full resize-none rounded-xl border border-amber-200 bg-white px-3 py-2 text-sm outline-none focus:border-amber-500 focus:ring-4 focus:ring-amber-500/10"
            />
          </label>
        </div>
      </div>
    </div>
  );
}
