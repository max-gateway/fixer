import type { OrderStatus } from '@/lib/orders';

/*
 * CONCEITO — dados fictícios. Nada aqui vem da API; serve para estudar a tela.
 * O "agora" é fixo para o servidor e o navegador renderizarem a mesma coisa (sem erro de hidratação).
 */
export const NOW = Date.parse('2026-10-30T14:30:00-03:00');
const H = 3_600_000;
const ago = (hours: number) => new Date(NOW - hours * H).toISOString();
const ahead = (hours: number) => new Date(NOW + hours * H).toISOString();

export type Priority = 'normal' | 'high' | 'urgent';

export type Mechanic = { id: string; name: string; bays: number };

export const MECHANICS: Mechanic[] = [
  { id: 'm1', name: 'Rogério Lima', bays: 3 },
  { id: 'm2', name: 'Davi Nunes', bays: 3 },
  { id: 'm3', name: 'Marcos Teixeira', bays: 2 },
  { id: 'm4', name: 'Aline Prado', bays: 2 },
];
export const BAYS_TOTAL = MECHANICS.reduce((n, m) => n + m.bays, 0);

export type MockOrder = {
  id: string;
  number: number;
  status: OrderStatus;
  priority: Priority;
  createdAt: string;
  /** Última movimentação (status, mensagem, peça…). */
  updatedAt: string;
  /** Prazo prometido ao cliente. */
  promisedAt: string | null;
  customer: { name: string; phone: string };
  vehicle: { plate: string; brand: string; model: string; year: number };
  services: { name: string; price: number }[];
  parts: { name: string; qty: number; price: number }[];
  mechanicId: string | null;
  checklist: { done: number; total: number };
  whatsappLinked: boolean;
  portalViewed: boolean;
  /** Cliente aprovou o orçamento pelo portal, mas a oficina ainda não confirmou. */
  customerApproved?: boolean;
  /** Previsão de chegada da peça (só em AWAITING_PART). */
  partEta?: string;
  invoice: 'none' | 'pending' | 'issued';
  /** Último aviso enviado ao cliente pelo WhatsApp. */
  notifiedAt?: string;
  timeline: { at: string; text: string; by: string }[];
};

export const orderTotal = (o: MockOrder) =>
  o.services.reduce((n, s) => n + s.price, 0) + o.parts.reduce((n, p) => n + p.price * p.qty, 0);

type Seed = Omit<MockOrder, 'id' | 'priority' | 'parts' | 'checklist' | 'whatsappLinked' | 'portalViewed' | 'invoice' | 'timeline' | 'updatedAt'> &
  Partial<Pick<MockOrder, 'priority' | 'parts' | 'checklist' | 'whatsappLinked' | 'portalViewed' | 'invoice' | 'timeline'>> & { updatedHoursAgo: number };

function make(s: Seed): MockOrder {
  const { updatedHoursAgo, ...rest } = s;
  return {
    id: `os-${s.number}`,
    priority: 'normal',
    parts: [],
    checklist: { done: 0, total: 12 },
    whatsappLinked: true,
    portalViewed: false,
    invoice: 'none',
    timeline: [{ at: s.createdAt, text: 'Ordem aberta pela placa', by: 'Recepção' }],
    ...rest,
    updatedAt: ago(updatedHoursAgo),
  };
}

export const INITIAL_ORDERS: MockOrder[] = [
  // Orçamento
  make({ number: 1061, status: 'QUOTE', createdAt: ago(75), updatedHoursAgo: 70, promisedAt: null, customer: { name: 'Patrícia Moreira', phone: '(11) 98812-4410' }, vehicle: { plate: 'RIO2A18', brand: 'Hyundai', model: 'HB20 1.0', year: 2021 }, services: [{ name: 'Revisão 40.000 km', price: 890 }], parts: [{ name: 'Kit filtros', qty: 1, price: 214 }], mechanicId: null, portalViewed: true }),
  make({ number: 1068, status: 'QUOTE', createdAt: ago(30), updatedHoursAgo: 2, promisedAt: null, customer: { name: 'Eduardo Salgado', phone: '(11) 97733-9021' }, vehicle: { plate: 'FZK4D77', brand: 'Jeep', model: 'Compass', year: 2020 }, services: [{ name: 'Suspensão dianteira', price: 1480 }], parts: [{ name: 'Amortecedor dianteiro', qty: 2, price: 612 }], mechanicId: null, customerApproved: true, portalViewed: true, priority: 'high' }),
  make({ number: 1072, status: 'QUOTE', createdAt: ago(5), updatedHoursAgo: 5, promisedAt: null, customer: { name: 'Transportadora Vale Norte', phone: '(11) 3344-1209' }, vehicle: { plate: 'QXA9B30', brand: 'Fiat', model: 'Fiorino', year: 2018 }, services: [{ name: 'Diagnóstico injeção eletrônica', price: 260 }], mechanicId: null }),
  // Aprovada
  make({ number: 1064, status: 'APPROVED', createdAt: ago(52), updatedHoursAgo: 20, promisedAt: ahead(26), customer: { name: 'Luciana Barros', phone: '(11) 99120-7783' }, vehicle: { plate: 'BRA7C44', brand: 'Chevrolet', model: 'Onix Plus', year: 2022 }, services: [{ name: 'Embreagem completa', price: 1350 }], parts: [{ name: 'Kit embreagem', qty: 1, price: 1190 }], mechanicId: 'm2', portalViewed: true }),
  make({ number: 1070, status: 'APPROVED', createdAt: ago(20), updatedHoursAgo: 3, promisedAt: ahead(5), customer: { name: 'Henrique Tavares', phone: '(11) 98455-2210' }, vehicle: { plate: 'GHJ1K92', brand: 'Volkswagen', model: 'T-Cross', year: 2023 }, services: [{ name: 'Pastilhas de freio dianteiras', price: 320 }, { name: 'Disco de freio', price: 280 }], parts: [{ name: 'Jogo de pastilhas', qty: 1, price: 238 }, { name: 'Par de discos', qty: 1, price: 410 }], mechanicId: 'm3', priority: 'urgent' }),
  // Em andamento
  make({ number: 1055, status: 'IN_PROGRESS', createdAt: ago(100), updatedHoursAgo: 4, promisedAt: ago(2.5), customer: { name: 'Fernando Alcântara', phone: '(11) 97001-3388' }, vehicle: { plate: 'EEL3F61', brand: 'Toyota', model: 'Corolla', year: 2019 }, services: [{ name: 'Correia dentada e tensor', price: 780 }, { name: 'Bomba d’água', price: 240 }], parts: [{ name: 'Kit correia dentada', qty: 1, price: 695 }], mechanicId: 'm1', checklist: { done: 9, total: 12 }, portalViewed: true, priority: 'urgent' }),
  make({ number: 1058, status: 'IN_PROGRESS', createdAt: ago(80), updatedHoursAgo: 1, promisedAt: ahead(2), customer: { name: 'Camila Duarte', phone: '(11) 96610-4492' }, vehicle: { plate: 'SPK5M08', brand: 'Honda', model: 'HR-V', year: 2021 }, services: [{ name: 'Revisão 60.000 km', price: 1180 }], parts: [{ name: 'Óleo 5W30 sintético', qty: 4, price: 62 }, { name: 'Kit filtros', qty: 1, price: 289 }], mechanicId: 'm1', checklist: { done: 8, total: 12 }, portalViewed: true }),
  make({ number: 1060, status: 'IN_PROGRESS', createdAt: ago(60), updatedHoursAgo: 2, promisedAt: ahead(3.5), customer: { name: 'Rafael Quintão', phone: '(11) 98200-1175' }, vehicle: { plate: 'LMN8P25', brand: 'Renault', model: 'Duster', year: 2020 }, services: [{ name: 'Alinhamento e balanceamento', price: 190 }], parts: [], mechanicId: 'm2', checklist: { done: 4, total: 12 } }),
  make({ number: 1063, status: 'IN_PROGRESS', createdAt: ago(46), updatedHoursAgo: 6, promisedAt: ahead(20), customer: { name: 'Bianca Furtado', phone: '(11) 99877-6034' }, vehicle: { plate: 'TUV2R19', brand: 'Fiat', model: 'Argo', year: 2022 }, services: [{ name: 'Ar-condicionado: higienização e gás', price: 360 }], parts: [{ name: 'Filtro de cabine', qty: 1, price: 58 }], mechanicId: 'm4', checklist: { done: 6, total: 12 }, whatsappLinked: false }),
  make({ number: 1066, status: 'IN_PROGRESS', createdAt: ago(28), updatedHoursAgo: 0.7, promisedAt: ahead(26), customer: { name: 'Otávio Mendes', phone: '(11) 97456-8821' }, vehicle: { plate: 'ABC1D23', brand: 'Ford', model: 'Ranger', year: 2017 }, services: [{ name: 'Troca de óleo e filtros', price: 210 }, { name: 'Troca de pneus (4)', price: 160 }], parts: [{ name: 'Pneu 265/65 R17', qty: 4, price: 890 }], mechanicId: 'm3', checklist: { done: 2, total: 12 }, portalViewed: true }),
  // Aguardando peça
  make({ number: 1052, status: 'AWAITING_PART', createdAt: ago(150), updatedHoursAgo: 30, promisedAt: ago(20), customer: { name: 'Sônia Vasconcelos', phone: '(11) 98011-5547' }, vehicle: { plate: 'KJH6S77', brand: 'Volkswagen', model: 'Polo', year: 2020 }, services: [{ name: 'Bomba de combustível', price: 420 }], parts: [{ name: 'Bomba de combustível', qty: 1, price: 760 }], mechanicId: 'm2', partEta: ago(1), checklist: { done: 5, total: 12 }, portalViewed: true, priority: 'high' }),
  make({ number: 1057, status: 'AWAITING_PART', createdAt: ago(96), updatedHoursAgo: 40, promisedAt: ahead(30), customer: { name: 'Thiago Pimentel', phone: '(11) 99340-2278' }, vehicle: { plate: 'DFG4T56', brand: 'Nissan', model: 'Kicks', year: 2022 }, services: [{ name: 'Cubo de roda traseiro', price: 380 }], parts: [{ name: 'Cubo de roda', qty: 1, price: 540 }], mechanicId: 'm4', partEta: ahead(22), checklist: { done: 3, total: 12 } }),
  // Concluída (pronta para retirada)
  make({ number: 1049, status: 'COMPLETED', createdAt: ago(170), updatedHoursAgo: 52, promisedAt: ago(60), customer: { name: 'Marta Albuquerque', phone: '(11) 98720-9916' }, vehicle: { plate: 'RTY9U12', brand: 'Chevrolet', model: 'Tracker', year: 2021 }, services: [{ name: 'Revisão 30.000 km', price: 740 }], parts: [{ name: 'Kit filtros', qty: 1, price: 232 }], mechanicId: 'm1', checklist: { done: 12, total: 12 }, portalViewed: true, invoice: 'pending' }),
  make({ number: 1059, status: 'COMPLETED', createdAt: ago(70), updatedHoursAgo: 3, promisedAt: ago(1), customer: { name: 'Gustavo Peixoto', phone: '(11) 97882-1304' }, vehicle: { plate: 'WER5V90', brand: 'Hyundai', model: 'Creta', year: 2023 }, services: [{ name: 'Pastilhas e fluido de freio', price: 410 }], parts: [{ name: 'Jogo de pastilhas', qty: 1, price: 246 }], mechanicId: 'm3', checklist: { done: 12, total: 12 }, portalViewed: true, invoice: 'pending' }),
  make({ number: 1062, status: 'COMPLETED', createdAt: ago(48), updatedHoursAgo: 9, promisedAt: ago(4), customer: { name: 'Débora Siqueira', phone: '(11) 96655-7019' }, vehicle: { plate: 'XCV3W48', brand: 'Fiat', model: 'Mobi', year: 2019 }, services: [{ name: 'Troca de bateria', price: 90 }], parts: [{ name: 'Bateria 60Ah', qty: 1, price: 480 }], mechanicId: 'm4', checklist: { done: 12, total: 12 }, invoice: 'issued' }),
  // Entregue
  make({ number: 1044, status: 'DELIVERED', createdAt: ago(230), updatedHoursAgo: 26, promisedAt: ago(30), customer: { name: 'Ricardo Bastos', phone: '(11) 98123-4455' }, vehicle: { plate: 'MNB7X31', brand: 'Volkswagen', model: 'Gol', year: 2016 }, services: [{ name: 'Troca de óleo e filtros', price: 180 }], parts: [{ name: 'Kit filtros', qty: 1, price: 164 }], mechanicId: 'm2', checklist: { done: 12, total: 12 }, invoice: 'issued' }),
  make({ number: 1047, status: 'DELIVERED', createdAt: ago(200), updatedHoursAgo: 50, promisedAt: ago(60), customer: { name: 'Isadora Coutinho', phone: '(11) 99001-2233' }, vehicle: { plate: 'POI8Y64', brand: 'Honda', model: 'Fit', year: 2018 }, services: [{ name: 'Alinhamento e balanceamento', price: 190 }], mechanicId: 'm1', checklist: { done: 12, total: 12 }, invoice: 'issued' }),
];

// ── Regras de negócio (espelham status.ts da API, usadas só no conceito) ────────────────────────────

/** Para onde cada status pode ir. O painel lateral usa isto para listar os movimentos possíveis. */
export const TRANSITIONS: Record<OrderStatus, OrderStatus[]> = {
  QUOTE: ['APPROVED', 'CANCELLED'],
  APPROVED: ['IN_PROGRESS', 'CANCELLED'],
  IN_PROGRESS: ['AWAITING_PART', 'COMPLETED', 'CANCELLED'],
  AWAITING_PART: ['IN_PROGRESS', 'CANCELLED'],
  COMPLETED: ['DELIVERED', 'IN_PROGRESS'],
  DELIVERED: [],
  CANCELLED: [],
};

/** Ação principal de cada etapa: o botão de destaque do painel lateral. */
export const PRIMARY_NEXT: Partial<Record<OrderStatus, { to: OrderStatus; label: string }>> = {
  QUOTE: { to: 'APPROVED', label: 'Aprovar' },
  APPROVED: { to: 'IN_PROGRESS', label: 'Iniciar' },
  IN_PROGRESS: { to: 'COMPLETED', label: 'Concluir' },
  AWAITING_PART: { to: 'IN_PROGRESS', label: 'Retomar' },
  COMPLETED: { to: 'DELIVERED', label: 'Entregar' },
};

export const brl0 = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 });

export const isActive = (o: MockOrder) => o.status !== 'DELIVERED' && o.status !== 'CANCELLED';

// ── Prazo e alertas ─────────────────────────────────────────────────────────────────────────────────

export type Health = 'late' | 'risk' | 'ok' | 'none';

/** Só quem está na oficina (aprovada, em andamento, aguardando peça) tem prazo correndo. */
export function health(o: MockOrder): Health {
  if (!o.promisedAt || !['APPROVED', 'IN_PROGRESS', 'AWAITING_PART'].includes(o.status)) return 'none';
  const left = Date.parse(o.promisedAt) - NOW;
  if (left < 0) return 'late';
  return left < 4 * H ? 'risk' : 'ok';
}

const hhmm = (iso: string) => new Date(iso).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', timeZone: 'America/Sao_Paulo' });
const dayKey = (t: number) => new Date(t).toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' });

/** "atrasada 2 h", "hoje 17:00", "amanhã 10:00", "02/11". */
export function dueLabel(o: MockOrder): string | null {
  if (!o.promisedAt) return null;
  const t = Date.parse(o.promisedAt);
  const diff = t - NOW;
  if (diff < 0) {
    const h = Math.round(-diff / H);
    return h < 1 ? 'atrasada agora' : h < 24 ? `atrasada ${h} h` : `atrasada ${Math.round(h / 24)} d`;
  }
  if (dayKey(t) === dayKey(NOW)) return `hoje ${hhmm(o.promisedAt)}`;
  if (dayKey(t) === dayKey(NOW + 24 * H)) return `amanhã ${hhmm(o.promisedAt)}`;
  return new Date(t).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', timeZone: 'America/Sao_Paulo' });
}

export const hoursSince = (iso: string) => (NOW - Date.parse(iso)) / H;

export function sinceLabel(iso: string): string {
  const h = hoursSince(iso);
  if (h < 1) return `${Math.max(1, Math.round(h * 60))} min`;
  if (h < 24) return `${Math.round(h)} h`;
  return `${Math.floor(h / 24)} d`;
}

// ── De quem é a vez ─────────────────────────────────────────────────────────────────────────────────

/**
 * A tela agrupa pelo que a ordem espera, não pelo status: a oficina precisa agir, o carro está sendo trabalhado,
 * o cliente precisa responder/retirar, a peça precisa chegar. Status vira detalhe do painel lateral.
 */
export type Lane = 'yours' | 'shop' | 'customer' | 'part' | 'done';

export const LANES: { id: Lane; label: string; hint: string }[] = [
  { id: 'yours', label: 'Sua vez', hint: 'Parado esperando uma ação da oficina' },
  { id: 'shop', label: 'Na oficina', hint: 'Sendo trabalhado, dentro do combinado' },
  { id: 'customer', label: 'Esperando o cliente', hint: 'Orçamento enviado ou carro pronto para retirar' },
  { id: 'part', label: 'Esperando peça', hint: 'Parado até a peça chegar' },
  { id: 'done', label: 'Entregues', hint: 'Saíram da oficina' },
];

/** Mover de etapa, avisar o cliente pelo WhatsApp, ou abrir o painel (quando a decisão pede escolha, como o mecânico). */
export type Next = { label: string; to: OrderStatus } | { label: string; notify: true } | { label: string; open: true };

/** Onde a ordem está, a frase que explica o porquê e o único botão que resolve. */
export type Situation = { lane: Lane; text: string; late: boolean; next: Next | null; weight: number };

/** Avisado há menos de 12 h: a bola voltou para o cliente. */
const recentlyNotified = (o: MockOrder) => !!o.notifiedAt && hoursSince(o.notifiedAt) < 12;

export function situation(o: MockOrder): Situation {
  const h = health(o);
  const late = h === 'late';
  const partArrived = o.status === 'AWAITING_PART' && !!o.partEta && Date.parse(o.partEta) <= NOW;
  const service = o.services[0]?.name ?? 'Sem serviço';

  switch (o.status) {
    case 'QUOTE':
      if (o.customerApproved) return { lane: 'yours', weight: 0, late: false, text: 'Cliente aprovou o orçamento pelo portal', next: { label: 'Confirmar', to: 'APPROVED' } };
      if (hoursSince(o.updatedAt) > 48 && !recentlyNotified(o))
        return { lane: 'yours', weight: 4, late: false, text: `Orçamento de ${brl0(orderTotal(o))} sem resposta há ${sinceLabel(o.updatedAt)}`, next: { label: 'Cobrar', notify: true } };
      return { lane: 'customer', weight: 0, late: false, text: recentlyNotified(o) ? `Cliente cobrado há ${sinceLabel(o.notifiedAt!)}` : `Orçamento enviado há ${sinceLabel(o.updatedAt)}`, next: null };
    case 'APPROVED':
      if (!o.mechanicId) return { lane: 'yours', weight: 3, late, text: 'Aprovada, falta escolher o mecânico', next: { label: 'Atribuir', open: true } };
      if (h === 'risk' || late) return { lane: 'yours', weight: 2, late, text: `${late ? 'Prazo estourado' : `Prazo ${dueLabel(o)}`} e ainda não começou`, next: { label: 'Iniciar', to: 'IN_PROGRESS' } };
      return { lane: 'shop', weight: 1, late: false, text: `Aprovada, na fila · ${service}`, next: { label: 'Iniciar', to: 'IN_PROGRESS' } };
    case 'IN_PROGRESS':
      if (late && !recentlyNotified(o)) return { lane: 'yours', weight: 1, late, text: `Atrasado ${dueLabel(o)!.replace('atrasada ', '')} · o cliente ainda não sabe`, next: { label: 'Avisar cliente', notify: true } };
      return { lane: 'shop', weight: 0, late, text: late ? `${service} · cliente avisado do atraso` : service, next: { label: 'Concluir', to: 'COMPLETED' } };
    case 'AWAITING_PART':
      if (partArrived) return { lane: 'yours', weight: 1, late, text: `${o.parts[0]?.name ?? 'Peça'} chegou · carro parado há ${sinceLabel(o.updatedAt)}`, next: { label: 'Retomar', to: 'IN_PROGRESS' } };
      return { lane: 'part', weight: 0, late, text: `${o.parts[0]?.name ?? 'Peça'} prevista ${o.partEta ? dueLabel({ ...o, promisedAt: o.partEta }) : 'sem data'}`, next: null };
    case 'COMPLETED':
      if (hoursSince(o.updatedAt) > 24 && !recentlyNotified(o))
        return { lane: 'yours', weight: 3, late: false, text: `Pronto há ${sinceLabel(o.updatedAt)} e o cliente não retirou`, next: { label: 'Cobrar retirada', notify: true } };
      return { lane: 'customer', weight: 1, late: false, text: recentlyNotified(o) ? `Pronto · cliente avisado há ${sinceLabel(o.notifiedAt!)}` : `Pronto há ${sinceLabel(o.updatedAt)} · aguardando retirada`, next: { label: 'Entregar', to: 'DELIVERED' } };
    default:
      return { lane: 'done', weight: 0, late: false, text: `${o.status === 'CANCELLED' ? 'Cancelada' : 'Entregue'} há ${sinceLabel(o.updatedAt)}`, next: null };
  }
}
