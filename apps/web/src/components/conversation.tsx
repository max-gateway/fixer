'use client';

import { Fragment, useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { STATUS_LABEL, type OrderStatus } from '@/lib/orders';
import { dayLabel, SYMPTOM_LABEL, timeLabel, WHEN_LABEL, type EventAuthor, type OrderEvent } from '@/lib/portal';
import { Icon } from './icons';

/**
 * Linha do tempo + composer da ordem de serviço, usada nos dois lados:
 * no portal do cliente (viewer = CUSTOMER) e no painel da oficina (viewer = SHOP).
 * Mensagens de quem está vendo ficam à direita; o resto da conversa, à esquerda.
 */
export function Conversation({
  events,
  viewer,
  onSend,
  onRetry,
  disabled,
  disabledReason,
  quickReplies = [],
  actions,
  className = '',
}: {
  events: OrderEvent[];
  viewer: Exclude<EventAuthor, 'SYSTEM'>;
  onSend: (text: string) => void;
  onRetry?: (id: string) => void;
  disabled?: boolean;
  disabledReason?: string;
  quickReplies?: string[];
  actions?: ReactNode;
  className?: string;
}) {
  const scroller = useRef<HTMLDivElement>(null);
  const stick = useRef(true);
  const lastCount = useRef(events.length);
  const [unseen, setUnseen] = useState(0);

  const toBottom = (smooth = true) => {
    const el = scroller.current;
    if (el) el.scrollTo({ top: el.scrollHeight, behavior: smooth ? 'smooth' : 'instant' });
  };

  useLayoutEffect(() => toBottom(false), []);

  // Cola no fim se o leitor já estava lá (ou se foi ele quem escreveu); senão avisa.
  useLayoutEffect(() => {
    const added = events.length - lastCount.current;
    lastCount.current = events.length;
    if (added <= 0) return;
    const mine = events[events.length - 1]?.author === viewer;
    if (stick.current || mine) toBottom();
    else setUnseen((n) => n + added);
  }, [events, viewer]);

  const groups = groupByDay(events);

  return (
    <div className={`flex flex-col overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-sm ${className}`}>
      <div className="relative min-h-0 flex-1">
        <div
          ref={scroller}
          role="log"
          aria-live="polite"
          aria-label="Conversa da ordem de serviço"
          onScroll={(e) => {
            const el = e.currentTarget;
            stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
            if (stick.current) setUnseen(0);
          }}
          className="h-full space-y-1 overflow-y-auto bg-[radial-gradient(circle_at_1px_1px,theme(--color-slate-200)_1px,transparent_0)] bg-[length:22px_22px] px-3 py-4 sm:px-5"
        >
          {events.length === 0 && (
            <p className="py-10 text-center text-sm text-slate-500">Nenhuma mensagem ainda. Diga olá! 👋</p>
          )}
          {groups.map(([day, items]) => (
            <Fragment key={day}>
              <div className="sticky top-0 z-10 flex justify-center py-2">
                <span className="rounded-full bg-white/90 px-3 py-1 text-xs font-medium text-slate-500 shadow-sm ring-1 ring-slate-200 backdrop-blur">
                  {day}
                </span>
              </div>
              {items.map((ev, i) => (
                <EventView key={ev.id} ev={ev} viewer={viewer} continued={isContinued(items[i - 1], ev)} onRetry={onRetry} />
              ))}
            </Fragment>
          ))}
        </div>
        {unseen > 0 && (
          <button
            onClick={() => {
              toBottom();
              setUnseen(0);
            }}
            className="animate-pop absolute bottom-3 left-1/2 flex -translate-x-1/2 items-center gap-1.5 rounded-full bg-slate-900 px-4 py-2 text-sm font-medium text-white shadow-lg"
          >
            <Icon name="down" className="size-4" />
            {unseen === 1 ? 'Nova mensagem' : `${unseen} novas mensagens`}
          </button>
        )}
      </div>

      {disabled ? (
        <div className="flex items-center gap-2 border-t border-slate-200 bg-slate-50 px-5 py-4 text-sm text-slate-600">
          <Icon name="lock" className="size-4 shrink-0" />
          {disabledReason}
        </div>
      ) : (
        <Composer onSend={onSend} quickReplies={quickReplies} actions={actions} />
      )}
    </div>
  );
}

const MAX = 2000;

function Composer({ onSend, quickReplies, actions }: { onSend: (t: string) => void; quickReplies: string[]; actions?: ReactNode }) {
  const [text, setText] = useState('');
  const box = useRef<HTMLTextAreaElement>(null);

  // Autosize: cresce com o conteúdo até ~6 linhas.
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 140)}px`;
  }, [text]);

  const trimmed = text.trim();
  const submit = () => {
    if (!trimmed) return;
    onSend(trimmed);
    setText('');
    box.current?.focus();
  };
  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      submit();
    }
  };

  return (
    <div className="space-y-2 border-t border-slate-200 bg-white p-3">
      {(quickReplies.length > 0 || actions) && !text && (
        <div className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1 [scrollbar-width:none]">
          {actions}
          {quickReplies.map((q) => (
            <button
              key={q}
              onClick={() => {
                setText(q);
                box.current?.focus();
              }}
              className="shrink-0 rounded-full border border-slate-200 bg-slate-50 px-3 py-1.5 text-sm text-slate-700 transition hover:border-brand hover:text-brand"
            >
              {q}
            </button>
          ))}
        </div>
      )}
      <div className="flex items-end gap-2">
        <textarea
          ref={box}
          value={text}
          onChange={(e) => setText(e.target.value.slice(0, MAX))}
          onKeyDown={onKey}
          rows={1}
          placeholder="Escreva uma mensagem…"
          aria-label="Mensagem"
          className="max-h-36 min-h-11 flex-1 resize-none rounded-2xl border border-slate-200 bg-slate-50 px-4 py-2.5 text-[15px] outline-none transition focus:border-brand focus:bg-white focus:ring-4 focus:ring-brand/10"
        />
        <button
          onClick={submit}
          disabled={!trimmed}
          aria-label="Enviar mensagem"
          className="grid size-11 shrink-0 place-items-center rounded-full bg-brand text-white shadow-sm transition enabled:hover:scale-105 enabled:active:scale-95 disabled:bg-slate-200 disabled:text-slate-400"
        >
          <Icon name="send" className="size-5" />
        </button>
      </div>
      {text.length > MAX - 200 && (
        <p className="text-right text-xs text-slate-500">
          {text.length}/{MAX}
        </p>
      )}
    </div>
  );
}

function EventView({
  ev,
  viewer,
  continued,
  onRetry,
}: {
  ev: OrderEvent;
  viewer: EventAuthor;
  continued: boolean;
  onRetry?: (id: string) => void;
}) {
  switch (ev.type) {
    case 'MESSAGE':
      return <Bubble ev={ev} mine={ev.author === viewer} continued={continued} onRetry={onRetry} />;
    case 'PROBLEM_REPORT':
      return <ProblemCard ev={ev} mine={ev.author === viewer} />;
    case 'STATUS_CHANGE':
      return <StatusMilestone ev={ev} />;
    case 'CHECKLIST_UPDATE':
      return <SystemChip ev={ev} tone={ev.data?.status === 'ISSUE' ? 'warn' : 'ok'} icon={ev.data?.status === 'ISSUE' ? 'alert' : 'check'}>
        {ev.data?.status === 'PENDING' ? 'desfez a resposta de' : ev.data?.status === 'ISSUE' ? 'registrou observação em' : 'confirmou'}{' '}
        <b className="font-medium">“{String(ev.data?.label ?? 'item')}”</b>
        {ev.body && <span className="block text-slate-500">{ev.body}</span>}
      </SystemChip>;
    case 'WHATSAPP_LINK': {
      const conflict = ev.data?.result === 'conflict';
      return <SystemChip ev={ev} actor={null} tone={conflict ? 'warn' : 'ok'} icon={conflict ? 'alert' : 'check'}>{ev.body}</SystemChip>;
    }
    case 'CUSTOMER_DATA_UPDATE':
      return <SystemChip ev={ev} tone="info" icon="user">
        atualizou os dados cadastrais: <b className="font-medium">{((ev.data?.fields as string[]) ?? []).join(', ')}</b>
      </SystemChip>;
  }
}

function Bubble({ ev, mine, continued, onRetry }: { ev: OrderEvent; mine: boolean; continued: boolean; onRetry?: (id: string) => void }) {
  return (
    <div className={`animate-rise flex flex-col ${mine ? 'items-end' : 'items-start'} ${continued ? 'pt-0.5' : 'pt-3'}`}>
      {!mine && !continued && <span className="mb-1 ml-3 text-xs font-medium text-slate-500">{ev.authorName}</span>}
      <div
        className={`max-w-[85%] whitespace-pre-wrap break-words rounded-3xl px-4 py-2.5 text-[15px] leading-snug shadow-sm sm:max-w-[75%] ${
          mine ? 'rounded-br-lg bg-brand text-white' : 'rounded-bl-lg bg-white text-slate-800 ring-1 ring-slate-200'
        } ${ev.pending ? 'opacity-60' : ''} ${ev.failed ? 'ring-2 ring-red-400' : ''}`}
      >
        {ev.body}
      </div>
      <div className="mt-0.5 flex items-center gap-2 px-2 text-[11px] text-slate-400">
        {ev.failed ? (
          <button onClick={() => onRetry?.(ev.id)} className="font-medium text-red-600 underline">
            Não enviada · tentar de novo
          </button>
        ) : ev.pending ? (
          <span className="flex items-center gap-1"><Icon name="clock" className="size-3" />enviando…</span>
        ) : (
          timeLabel(ev.createdAt)
        )}
      </div>
    </div>
  );
}

function ProblemCard({ ev, mine }: { ev: OrderEvent; mine: boolean }) {
  const symptoms = (ev.data?.symptoms as string[] | undefined) ?? [];
  const when = ev.data?.when as string | null | undefined;
  return (
    <div className={`animate-rise flex pt-3 ${mine ? 'justify-end' : 'justify-start'}`}>
      <div className="w-full max-w-[90%] overflow-hidden rounded-3xl bg-white shadow-sm ring-1 ring-amber-200 sm:max-w-[80%]">
        <div className="flex items-center gap-2 bg-amber-50 px-4 py-2 text-sm font-semibold text-amber-900">
          <Icon name="wrench" className="size-4" />
          Problema relatado
          <span className="ml-auto text-[11px] font-normal text-amber-700">{timeLabel(ev.createdAt)}</span>
        </div>
        <div className="space-y-3 px-4 py-3 text-[15px]">
          <p className="whitespace-pre-wrap break-words">{ev.body}</p>
          {(symptoms.length > 0 || when) && (
            <div className="flex flex-wrap gap-1.5">
              {symptoms.map((s) => (
                <span key={s} className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-medium text-slate-700">
                  {SYMPTOM_LABEL[s] ?? s}
                </span>
              ))}
              {when && (
                <span className="rounded-full bg-amber-100 px-2.5 py-1 text-xs font-medium text-amber-900">
                  {WHEN_LABEL[when] ?? when}
                </span>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function StatusMilestone({ ev }: { ev: OrderEvent }) {
  const to = ev.data?.to as OrderStatus | undefined;
  const label = to ? STATUS_LABEL[to] : null;
  const cancelled = to === 'CANCELLED';
  return (
    <div className="animate-rise flex justify-center py-3">
      <div className={`flex max-w-[92%] items-start gap-3 rounded-2xl px-4 py-3 text-sm shadow-sm ring-1 ${cancelled ? 'bg-red-50 text-red-900 ring-red-200' : 'bg-slate-900 text-white ring-slate-900'}`}>
        <span className={`mt-0.5 grid size-6 shrink-0 place-items-center rounded-full ${cancelled ? 'bg-red-200' : 'bg-white/15'}`}>
          <Icon name={cancelled ? 'x' : 'check'} className="size-3.5" />
        </span>
        <div>
          <p className="font-semibold">{label ? `Status: ${label}` : ev.body}</p>
          {label && ev.body && <p className={cancelled ? 'text-red-800' : 'text-slate-300'}>{ev.body}</p>}
          <p className={`mt-0.5 text-[11px] ${cancelled ? 'text-red-700' : 'text-slate-400'}`}>
            {ev.authorName ? `${ev.authorName} · ` : ''}
            {timeLabel(ev.createdAt)}
          </p>
        </div>
      </div>
    </div>
  );
}

/** `actor`: quem fez (padrão: o autor do evento); `null` para avisos do sistema, sem nome na frente. */
function SystemChip({ ev, icon, tone, actor, children }: { ev: OrderEvent; icon: 'check' | 'alert' | 'user'; tone: 'ok' | 'warn' | 'info'; actor?: string | null; children: ReactNode }) {
  const who = actor === undefined ? (ev.authorName ?? 'Cliente') : actor;
  const palette = { ok: 'bg-emerald-50 text-emerald-900 ring-emerald-200', warn: 'bg-amber-50 text-amber-900 ring-amber-200', info: 'bg-sky-50 text-sky-900 ring-sky-200' }[tone];
  return (
    <div className="animate-rise flex justify-center py-1.5">
      <div className={`flex max-w-[92%] items-start gap-2 rounded-2xl px-3 py-1.5 text-xs ring-1 ${palette}`}>
        <Icon name={icon} className="mt-0.5 size-3.5 shrink-0" />
        <div>
          {who && <span className="font-semibold">{who} </span>}
          {children}
          <span className="ml-2 text-[10px] opacity-60">{timeLabel(ev.createdAt)}</span>
        </div>
      </div>
    </div>
  );
}

function groupByDay(events: OrderEvent[]): [string, OrderEvent[]][] {
  const out: [string, OrderEvent[]][] = [];
  for (const ev of events) {
    const day = dayLabel(ev.createdAt);
    const last = out[out.length - 1];
    if (last?.[0] === day) last[1].push(ev);
    else out.push([day, [ev]]);
  }
  return out;
}

/** Mensagens seguidas do mesmo autor, em até 5 min, colam umas nas outras. */
function isContinued(prev: OrderEvent | undefined, ev: OrderEvent) {
  return (
    !!prev &&
    prev.type === 'MESSAGE' &&
    ev.type === 'MESSAGE' &&
    prev.author === ev.author &&
    new Date(ev.createdAt).getTime() - new Date(prev.createdAt).getTime() < 5 * 60_000
  );
}
