'use client';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Conversation } from '@/components/conversation';
import { Icon, type IconName } from '@/components/icons';
import { customerCompleteness, type ChecklistStatus, type OrderEvent, type PortalOrder } from '@/lib/portal';
import { ChecklistPanel } from './checklist-panel';
import { Hero } from './hero';
import { MyDataPanel, type LookupResult } from './my-data-panel';
import { PortalApiError, portalFetch } from './portal-api';
import { ProblemDialog, type ProblemInput } from './problem-dialog';
import { SummaryPanel } from './summary-panel';
import { WhatsappCard } from './whatsapp-card';

type Tab = 'conversa' | 'checklist' | 'dados' | 'resumo';
const POLL_MS = 5000;
const QUICK_REPLIES = ['Qual a previsão de entrega?', 'Pode começar o serviço', 'Posso retirar hoje?', 'Quero ver o orçamento'];

export function Portal({ token, initial, shop }: { token: string; initial: PortalOrder; shop: { name: string; logoUrl: string | null } }) {
  const queryClient = useQueryClient();
  const queryKey = ['portal-order', token] as const;
  const inflight = useRef(0);
  const tmp = useRef(0);
  // Mensagens ainda não confirmadas pelo servidor (enviando ou com falha), exibidas após as do servidor.
  const [local, setLocal] = useState<OrderEvent[]>([]);
  // Cadastro pendente (OS aberta só com o telefone): o primeiro passo é se identificar.
  const [tab, setTab] = useState<Tab>(initial.registrationPending ? 'dados' : 'conversa');
  const [seen, setSeen] = useState(initial.events.length);
  const [problemOpen, setProblemOpen] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  const notify = useCallback((message: string) => {
    setToast(message);
    setTimeout(() => setToast((t) => (t === message ? null : t)), 3200);
  }, []);

  // Polling: pausa com a aba oculta e não aplica a resposta enquanto há escrita em voo
  // (evita sobrescrever uma alteração otimista ou duplicar a mensagem recém-enviada).
  const { data: order, error } = useQuery({
    queryKey,
    queryFn: async (): Promise<PortalOrder> => {
      const fresh = await portalFetch<PortalOrder>(token, '');
      const current = queryClient.getQueryData<PortalOrder>(queryKey);
      if (inflight.current > 0 && current) return current;
      return { ...fresh, customer: current?.customer ?? fresh.customer }; // o formulário de dados é dono do próprio estado
    },
    initialData: initial,
    staleTime: 4000,
    refetchInterval: POLL_MS,
    refetchIntervalInBackground: false,
  });
  const offline = error instanceof PortalApiError && error.status === 0;
  const events = [...order.events, ...local];
  const patchOrder = (fn: (o: PortalOrder) => PortalOrder) => queryClient.setQueryData<PortalOrder>(queryKey, (o) => o && fn(o));
  const confirm = async (id: string, saved: OrderEvent) => {
    await queryClient.cancelQueries({ queryKey }); // uma consulta em voo não pode sobrescrever a mensagem recém-criada
    patchOrder((o) => ({ ...o, events: [...o.events, saved] }));
    setLocal((prev) => prev.filter((e) => e.id !== id));
  };

  // O polling traz o vínculo feito no WhatsApp: confirma na tela sem o cliente precisar recarregar.
  const wasLinked = useRef(initial.whatsapp.linked);
  useEffect(() => {
    if (order.whatsapp.linked && !wasLinked.current) notify('WhatsApp conectado ✓ Você já recebe as atualizações por lá.');
    wasLinked.current = order.whatsapp.linked;
  }, [order.whatsapp.linked, notify]);

  useEffect(() => {
    if (tab === 'conversa') setSeen(events.length);
  }, [tab, events.length]);

  const unread = tab === 'conversa' ? 0 : events.slice(seen).filter((e) => e.author === 'SHOP').length;

  // ---- escritas -----------------------------------------------------------

  async function post(path: string, body: unknown, method = 'POST') {
    inflight.current++;
    try {
      return await portalFetch<OrderEvent>(token, path, { method, body });
    } finally {
      inflight.current--;
    }
  }

  const sendMessage = useCallback(
    async (text: string, retryId?: string) => {
      const id = retryId ?? `tmp-${++tmp.current}`;
      const optimistic: OrderEvent = { id, type: 'MESSAGE', author: 'CUSTOMER', authorName: order.customer.name, body: text, data: null, createdAt: new Date().toISOString(), pending: true };
      setLocal((prev) => (retryId ? prev.map((e) => (e.id === id ? optimistic : e)) : [...prev, optimistic]));
      try {
        const saved = await post('/messages', { body: text });
        await confirm(id, saved);
      } catch (err) {
        setLocal((prev) => prev.map((e) => (e.id === id ? { ...e, pending: false, failed: true } : e)));
        notify(err instanceof Error ? err.message : 'Falha ao enviar.');
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [order.customer.name, notify, token],
  );

  const retry = (id: string) => {
    const ev = events.find((e) => e.id === id);
    if (ev?.body) void sendMessage(ev.body, id);
  };

  async function sendProblem(p: ProblemInput) {
    setProblemOpen(false);
    setTab('conversa');
    try {
      const saved = await post('/problem', p);
      patchOrder((o) => ({ ...o, events: [...o.events, saved] }));
      notify('Relato enviado para a oficina ✓');
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Falha ao enviar o relato.');
      setProblemOpen(true);
    }
  }

  async function answerChecklist(id: string, status: ChecklistStatus, note: string | null) {
    const before = order.checklist;
    patchOrder((o) => ({ ...o, checklist: o.checklist.map((c) => (c.id === id ? { ...c, status, note } : c)) }));
    try {
      await post(`/checklist/${encodeURIComponent(id)}`, { status, note }, 'PATCH');
      // O evento gerado entra na conversa no próximo ciclo de polling.
    } catch (err) {
      patchOrder((o) => ({ ...o, checklist: before }));
      notify(err instanceof Error ? err.message : 'Falha ao salvar.');
    }
  }

  async function saveCustomer(values: Omit<PortalOrder['customer'], 'document'>) {
    inflight.current++;
    try {
      await portalFetch(token, '/customer', { method: 'PUT', body: values });
      patchOrder((o) => ({ ...o, customer: { ...o.customer, ...values } }));
    } finally {
      inflight.current--;
    }
  }

  async function lookupCustomer(document: string): Promise<LookupResult> {
    return portalFetch<LookupResult>(token, `/customer-lookup?document=${encodeURIComponent(document)}`);
  }

  /** Primeiro acesso: grava CPF/CNPJ + dados (a API pode fundir com um cadastro existente) e recarrega a ordem. */
  async function identifyCustomer(document: string, values: Omit<PortalOrder['customer'], 'document'>) {
    inflight.current++;
    try {
      await portalFetch(token, '/customer', { method: 'PUT', body: { ...values, document } });
      const fresh = await portalFetch<PortalOrder>(token, '');
      queryClient.setQueryData(queryKey, fresh);
      notify('Cadastro confirmado ✓ Agora conte o que está acontecendo com o veículo.');
      setTab('conversa');
      setProblemOpen(true);
    } finally {
      inflight.current--;
    }
  }

  // ---- layout -------------------------------------------------------------

  const pendingChecklist = order.checklist.filter((c) => c.status === 'PENDING').length;
  const dataPct = customerCompleteness(order.customer);
  const tabs: { id: Tab; label: string; icon: IconName; badge?: number; dot?: boolean }[] = [
    { id: 'conversa', label: 'Conversa', icon: 'chat', badge: unread },
    { id: 'checklist', label: 'Checklist', icon: 'list', badge: pendingChecklist },
    { id: 'dados', label: 'Meus dados', icon: 'user', dot: order.registrationPending || dataPct < 100 },
    { id: 'resumo', label: 'Orçamento', icon: 'receipt' },
  ];

  return (
    <div className="min-h-dvh pb-24 sm:pb-10">
      <header className="sticky top-0 z-30 border-b border-slate-200 bg-white/85 backdrop-blur">
        <div className="mx-auto flex max-w-5xl items-center gap-3 px-4 py-3">
          {shop.logoUrl && <img src={shop.logoUrl} alt="" className="h-7 w-auto" />}
          <span className="font-semibold">{shop.name}</span>
          <span className="ml-auto flex items-center gap-1.5 text-xs text-slate-500">
            <Icon name="shield" className="size-3.5" /> Link privado
          </span>
        </div>
        {offline && (
          <p role="status" className="bg-amber-100 px-4 py-1.5 text-center text-xs font-medium text-amber-900">
            Sem conexão — tentando reconectar…
          </p>
        )}
      </header>

      <div className="mx-auto grid max-w-5xl gap-5 px-4 py-5 lg:grid-cols-[22rem_1fr] lg:items-start">
        <div className="space-y-4 lg:sticky lg:top-20">
          <Hero order={order} />
          <WhatsappCard whatsapp={order.whatsapp} readOnly={order.readOnly} />
          {order.readOnly && (
            <p className="flex items-center gap-2 rounded-2xl bg-slate-100 px-4 py-3 text-sm text-slate-700">
              <Icon name="lock" className="size-4 shrink-0" /> Esta ordem foi encerrada. O histórico continua disponível para consulta.
            </p>
          )}
        </div>

        <main>
          <nav
            role="tablist"
            aria-label="Seções"
            className="fixed inset-x-0 bottom-0 z-30 grid grid-cols-4 border-t border-slate-200 bg-white/95 pb-[env(safe-area-inset-bottom)] backdrop-blur sm:static sm:mb-4 sm:grid-cols-4 sm:gap-1 sm:rounded-2xl sm:border sm:bg-white sm:p-1 sm:shadow-sm"
          >
            {tabs.map((t) => {
              const active = tab === t.id;
              return (
                <button
                  key={t.id}
                  role="tab"
                  aria-selected={active}
                  aria-controls={`panel-${t.id}`}
                  onClick={() => setTab(t.id)}
                  className={`relative flex flex-col items-center gap-0.5 px-1 py-2.5 text-[11px] font-medium transition sm:flex-row sm:justify-center sm:gap-2 sm:rounded-xl sm:py-2.5 sm:text-sm ${
                    active ? 'text-brand sm:bg-brand/10' : 'text-slate-500 hover:text-slate-800'
                  }`}
                >
                  <span className="relative">
                    <Icon name={t.icon} className="size-5" />
                    {t.dot && !active && <span className="absolute -right-0.5 -top-0.5 size-2 rounded-full bg-amber-500 ring-2 ring-white" />}
                  </span>
                  {t.label}
                  {!!t.badge && (
                    <span className="absolute right-3 top-1.5 grid min-w-4 place-items-center rounded-full bg-red-500 px-1 text-[10px] font-bold text-white sm:static sm:ml-0.5">
                      {t.badge}
                    </span>
                  )}
                </button>
              );
            })}
          </nav>

          <div role="tabpanel" id={`panel-${tab}`} key={tab} className="animate-rise">
            {tab === 'conversa' && (
              <Conversation
                viewer="CUSTOMER"
                events={events}
                onSend={(t) => void sendMessage(t)}
                onRetry={retry}
                disabled={order.readOnly}
                disabledReason="Esta ordem foi encerrada e não aceita novas mensagens."
                quickReplies={QUICK_REPLIES}
                className="h-[68dvh] min-h-[460px]"
                actions={
                  <button
                    onClick={() => setProblemOpen(true)}
                    className="flex shrink-0 items-center gap-1.5 rounded-full bg-amber-100 px-3 py-1.5 text-sm font-medium text-amber-900 transition hover:bg-amber-200"
                  >
                    <Icon name="wrench" className="size-4" /> Relatar problema
                  </button>
                }
              />
            )}
            {tab === 'checklist' && <ChecklistPanel items={order.checklist} readOnly={order.readOnly} onAnswer={answerChecklist} />}
            {tab === 'dados' && (
              <MyDataPanel
                customer={order.customer}
                document={order.customer.document}
                pending={order.registrationPending}
                readOnly={order.readOnly}
                onSave={saveCustomer}
                onLookup={lookupCustomer}
                onIdentify={identifyCustomer}
              />
            )}
            {tab === 'resumo' && <SummaryPanel order={order} />}
          </div>
        </main>
      </div>

      <ProblemDialog open={problemOpen} onClose={() => setProblemOpen(false)} onSubmit={sendProblem} />

      {toast && (
        <div role="status" className="animate-rise fixed inset-x-0 bottom-20 z-50 mx-auto w-fit max-w-[90%] rounded-full bg-slate-900 px-5 py-2.5 text-sm font-medium text-white shadow-xl sm:bottom-8">
          {toast}
        </div>
      )}
    </div>
  );
}
