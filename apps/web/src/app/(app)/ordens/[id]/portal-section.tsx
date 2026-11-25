'use client';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useRef, useState } from 'react';
import { Conversation } from '@/components/conversation';
import { Icon } from '@/components/icons';
import type { ChecklistItem, OrderEvent } from '@/lib/portal';

/** Portal do cliente visto pela oficina: link de acesso, conversa em tempo quase real e checklist. */
export function PortalSection({
  orderId,
  portalUrl,
  customerName,
  customerPhone,
  whatsappLink,
  initialEvents,
  initialChecklist,
  closed,
}: {
  orderId: string;
  portalUrl: string;
  customerName: string;
  customerPhone: string | null;
  /** Vínculo do WhatsApp do cliente: `code` é o que ele envia pelo botão "Falar com a oficina" do portal. */
  whatsappLink: { linked: boolean; last4: string | null; code: string };
  initialEvents: OrderEvent[];
  initialChecklist: ChecklistItem[];
  closed: boolean;
}) {
  type OrderSnapshot = { events: OrderEvent[]; checklist: ChecklistItem[] };
  const queryKey = ['service-order', orderId] as const;
  const queryClient = useQueryClient();
  const inflight = useRef(0);
  const tmp = useRef(0);
  // Mensagens ainda não confirmadas pelo servidor (enviando ou com falha), exibidas após as do servidor.
  const [local, setLocal] = useState<OrderEvent[]>([]);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const { data } = useQuery({
    queryKey,
    queryFn: async ({ signal }): Promise<OrderSnapshot> => {
      const res = await fetch(`/api/service-orders/${orderId}`, { cache: 'no-store', signal });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return res.json();
    },
    initialData: { events: initialEvents, checklist: initialChecklist },
    staleTime: 4000,
    // Não consulta durante um envio (evita sobrescrever a mensagem recém-criada); pausa com a aba oculta.
    refetchInterval: () => (inflight.current > 0 ? false : 5000),
    refetchIntervalInBackground: false,
  });
  const events = [...data.events, ...local];
  const checklist = data.checklist;

  async function send(text: string, retryId?: string) {
    const id = retryId ?? `tmp-${++tmp.current}`;
    const optimistic: OrderEvent = { id, type: 'MESSAGE', author: 'SHOP', authorName: 'Você', body: text, data: null, createdAt: new Date().toISOString(), pending: true };
    setLocal((prev) => (retryId ? prev.map((e) => (e.id === id ? optimistic : e)) : [...prev, optimistic]));
    setError(null);
    inflight.current++;
    try {
      const res = await fetch(`/api/service-orders/${orderId}/messages`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ body: text }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.message ?? 'Falha ao enviar.');
      await queryClient.cancelQueries({ queryKey });
      queryClient.setQueryData<OrderSnapshot>(queryKey, (old) => old && { ...old, events: [...old.events, body] });
      setLocal((prev) => prev.filter((e) => e.id !== id));
    } catch (err) {
      setLocal((prev) => prev.map((e) => (e.id === id ? { ...e, pending: false, failed: true } : e)));
      setError(err instanceof Error ? err.message : 'Falha ao enviar.');
    } finally {
      inflight.current--;
    }
  }

  async function copy() {
    try {
      await navigator.clipboard.writeText(portalUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      window.prompt('Copie o link:', portalUrl);
    }
  }

  const digits = customerPhone?.replace(/\D/g, '') ?? '';
  const whatsapp =
    digits.length >= 10
      ? `https://wa.me/55${digits}?text=${encodeURIComponent(`Olá${/^\(/.test(customerName) ? '' : `, ${customerName.split(' ')[0]}`}! Acompanhe sua ordem de serviço, converse com a gente e complete seus dados por aqui: ${portalUrl}`)}`
      : null;

  const answered = checklist.filter((c) => c.status !== 'PENDING').length;
  const issues = checklist.filter((c) => c.status === 'ISSUE');

  return (
    <section className="space-y-4">
      <h2 className="text-lg font-semibold">Portal do cliente</h2>

      <div className="space-y-3 rounded-2xl border border-slate-200 bg-white p-4 text-sm">
        <p className="text-slate-600">Quem tem este link acessa a ordem sem login. Envie só para o cliente.</p>
        <div className="flex flex-col gap-2 sm:flex-row">
          <input readOnly value={portalUrl} onFocus={(e) => e.target.select()} aria-label="Link do portal" className="min-w-0 flex-1 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 font-mono text-xs" />
          <div className="flex gap-2">
            <button onClick={copy} className="flex items-center gap-1.5 rounded-xl border border-slate-300 px-3 py-2 font-medium hover:bg-slate-50">
              <Icon name={copied ? 'check' : 'copy'} className="size-4" />
              {copied ? 'Copiado!' : 'Copiar'}
            </button>
            {whatsapp ? (
              <a href={whatsapp} target="_blank" rel="noreferrer" className="flex items-center gap-1.5 rounded-xl bg-emerald-600 px-3 py-2 font-medium text-white hover:bg-emerald-700">
                <Icon name="send" className="size-4" /> WhatsApp
              </a>
            ) : (
              <span className="self-center text-xs text-slate-500">Sem telefone cadastrado</span>
            )}
          </div>
        </div>
      </div>

      <p
        className={`flex items-start gap-2 rounded-2xl px-4 py-3 text-sm ring-1 ${
          whatsappLink.linked ? 'bg-emerald-50 text-emerald-900 ring-emerald-200' : 'bg-slate-50 text-slate-700 ring-slate-200'
        }`}
      >
        <Icon name={whatsappLink.linked ? 'check' : 'clock'} className="mt-0.5 size-4 shrink-0" />
        {whatsappLink.linked ? (
          <span>WhatsApp do cliente conectado{whatsappLink.last4 ? ` (final ${whatsappLink.last4})` : ''}. As atualizações seguem por lá.</span>
        ) : (
          <span>
            Aguardando o cliente tocar em <b>Falar com a oficina</b> no portal: o número dele é capturado sozinho. Código da ordem:{' '}
            <span className="font-mono font-semibold">{whatsappLink.code}</span>
          </span>
        )}
      </p>

      <Conversation
        viewer="SHOP"
        events={events}
        onSend={(t) => void send(t)}
        onRetry={(id) => {
          const ev = events.find((e) => e.id === id);
          if (ev?.body) void send(ev.body, id);
        }}
        disabled={closed}
        disabledReason="Ordem encerrada: o histórico segue disponível, mas não aceita novas mensagens."
        quickReplies={['Seu orçamento está pronto. Pode conferir na aba Orçamento.', 'Precisamos de uma peça; avisamos assim que chegar.', 'Seu carro está pronto para retirada!']}
        className="h-[560px]"
      />
      {error && (
        <p role="alert" className="text-sm text-red-600">
          {error}
        </p>
      )}

      <div className="rounded-2xl border border-slate-200 bg-white p-4 text-sm">
        <h3 className="mb-2 font-semibold">
          Checklist de entrada <span className="font-normal text-slate-500">· {answered}/{checklist.length} respondidos</span>
        </h3>
        <ul className="space-y-1.5">
          {checklist.map((c) => (
            <li key={c.id} className="flex items-start gap-2">
              <span className={`mt-1 size-2.5 shrink-0 rounded-full ${c.status === 'OK' ? 'bg-emerald-500' : c.status === 'ISSUE' ? 'bg-amber-500' : 'bg-slate-300'}`} />
              <span>
                {c.label}
                {c.status === 'ISSUE' && <span className="block font-medium text-amber-800">⚠ {c.note ?? 'Sem detalhes'}</span>}
              </span>
            </li>
          ))}
        </ul>
        {issues.length > 0 && <p className="mt-3 rounded-xl bg-amber-50 px-3 py-2 text-amber-900">{issues.length} {issues.length === 1 ? 'observação registrada' : 'observações registradas'} pelo cliente.</p>}
      </div>
    </section>
  );
}
