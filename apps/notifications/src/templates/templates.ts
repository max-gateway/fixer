import type { RenderedMessage } from '../channels/channel.js';
import type { OrderEvent } from '../contract/order-event.js';

export interface Brand {
  name: string;
  color: string;
}

const esc = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');

/** Só aceita cor hex: o valor vai para dentro de um atributo style. */
const safeColor = (c: string) => (/^#[0-9a-f]{3,8}$/i.test(c) ? c : '#C2410C');

const excerpt = (s: unknown, max = 500) => {
  const t = typeof s === 'string' ? s.trim() : '';
  return t.length > max ? `${t.slice(0, max - 1)}…` : t;
};

interface Copy {
  subject: string;
  title: string;
  paragraphs: string[];
  cta?: { label: string; url: string };
  quote?: string;
}

/** Layout único de e-mail (white-label: nome e cor vêm do tenant). Estilos inline por compatibilidade com clientes de e-mail. */
function layout(brand: Brand, copy: Copy): RenderedMessage {
  const color = safeColor(brand.color);
  const p = copy.paragraphs.map((t) => `<p style="margin:0 0 14px;line-height:1.55">${esc(t)}</p>`).join('');
  const quote = copy.quote
    ? `<blockquote style="margin:0 0 18px;padding:10px 14px;border-left:3px solid ${color};background:#f6f6f4;color:#1c2430;white-space:pre-wrap">${esc(copy.quote)}</blockquote>`
    : '';
  const cta = copy.cta
    ? `<p style="margin:22px 0 0"><a href="${esc(copy.cta.url)}" style="background:${color};color:#fff;text-decoration:none;padding:11px 20px;border-radius:6px;font-weight:600;display:inline-block">${esc(copy.cta.label)}</a></p>`
    : '';
  const html = `<!doctype html><html lang="pt-BR"><body style="margin:0;background:#f6f6f4;font-family:'Bai Jamjuree',Arial,Helvetica,sans-serif;color:#1c2430">
<div style="max-width:560px;margin:0 auto;padding:24px 16px">
<div style="font-weight:700;font-size:18px;color:${color};margin-bottom:16px">${esc(brand.name)}</div>
<div style="background:#fff;border-radius:8px;padding:24px;border:1px solid #e5e5e0">
<h1 style="margin:0 0 16px;font-size:20px">${esc(copy.title)}</h1>${p}${quote}${cta}</div>
<div style="font-size:12px;color:#6b7280;margin-top:14px">Você recebeu este e-mail por causa de uma ordem de serviço em ${esc(brand.name)}.</div>
</div></body></html>`;
  const text = [
    copy.title,
    '',
    ...copy.paragraphs,
    ...(copy.quote ? ['', copy.quote] : []),
    ...(copy.cta ? ['', `${copy.cta.label}: ${copy.cta.url}`] : []),
  ].join('\n');
  return { subject: copy.subject, text, html };
}

const vehicle = (e: OrderEvent) => `${e.order.vehicle.brand} ${e.order.vehicle.model} (${e.order.vehicle.plate})`;
const os = (e: OrderEvent) => `OS #${e.order.number}`;

export const STATUS_COPY: Record<string, { subject: string; title: string; text: string }> = {
  APPROVED: { subject: 'Orçamento aprovado', title: 'Orçamento aprovado', text: 'Recebemos a aprovação do orçamento e vamos programar o serviço.' },
  IN_PROGRESS: { subject: 'Serviço em andamento', title: 'Serviço em andamento', text: 'Começamos a trabalhar no seu veículo.' },
  AWAITING_PART: { subject: 'Aguardando peça', title: 'Aguardando peça', text: 'O serviço está parado aguardando a chegada de uma peça. Avisaremos quando for retomado.' },
  COMPLETED: { subject: 'Veículo pronto para retirada', title: 'Seu veículo está pronto', text: 'O serviço foi concluído. Você já pode retirar o veículo.' },
  DELIVERED: { subject: 'Veículo entregue', title: 'Veículo entregue', text: 'Obrigado pela confiança! Esperamos vê-lo novamente.' },
  CANCELLED: { subject: 'Ordem cancelada', title: 'Ordem cancelada', text: 'Esta ordem de serviço foi cancelada.' },
};

/** Template id -> renderizador. Chave estável: é gravada em `notifications.template` para auditoria. */
export const TEMPLATES = {
  'customer.order_created': (e, b) =>
    layout(b, {
      subject: `${os(e)} aberta — ${vehicle(e)}`,
      title: `Sua ordem de serviço #${e.order.number} foi aberta`,
      paragraphs: [`Olá, ${e.order.customer.name}. Registramos a entrada de ${vehicle(e)}.`, 'Acompanhe o andamento, converse com a oficina e responda ao checklist pelo link abaixo.'],
      cta: { label: 'Acompanhar ordem', url: e.order.portalUrl },
    }),

  'customer.status_changed': (e, b) => {
    const to = String(e.data.to ?? e.order.status);
    const c = STATUS_COPY[to] ?? { subject: 'Atualização da ordem', title: 'Atualização da ordem', text: `O status da ordem mudou para ${to}.` };
    return layout(b, {
      subject: `${os(e)}: ${c.subject}`,
      title: c.title,
      paragraphs: [`${os(e)} — ${vehicle(e)}.`, c.text],
      quote: excerpt(e.data.note) || undefined,
      cta: { label: 'Ver ordem', url: e.order.portalUrl },
    });
  },

  'customer.message_posted': (e, b) =>
    layout(b, {
      subject: `${os(e)}: nova mensagem da oficina`,
      title: 'Você recebeu uma mensagem',
      paragraphs: [`${e.actor.name ?? 'A oficina'} escreveu sobre ${os(e)} (${vehicle(e)}):`],
      quote: excerpt(e.data.body),
      cta: { label: 'Responder', url: e.order.portalUrl },
    }),

  'customer.checklist_item_added': (e, b) =>
    layout(b, {
      subject: `${os(e)}: a oficina pediu uma informação`,
      title: 'Há um novo item para você responder',
      paragraphs: [`Na ${os(e)} (${vehicle(e)}), a oficina adicionou ao checklist: "${excerpt(e.data.label, 160)}".`],
      cta: { label: 'Responder checklist', url: e.order.portalUrl },
    }),

  'staff.message_posted': (e, b) =>
    layout(b, {
      subject: `${os(e)}: cliente enviou mensagem`,
      title: `${e.order.customer.name} enviou uma mensagem`,
      paragraphs: [`${os(e)} — ${vehicle(e)}.`],
      quote: excerpt(e.data.body),
    }),

  'staff.problem_reported': (e, b) =>
    layout(b, {
      subject: `${os(e)}: cliente relatou um problema`,
      title: `${e.order.customer.name} relatou um problema`,
      paragraphs: [`${os(e)} — ${vehicle(e)}.`, ...(e.data.when ? [`Quando: ${excerpt(e.data.when, 200)}`] : [])],
      quote: excerpt(e.data.body),
    }),

  'staff.checklist_issue': (e, b) =>
    layout(b, {
      subject: `${os(e)}: cliente marcou problema no checklist`,
      title: 'Item do checklist com problema',
      paragraphs: [`${os(e)} — ${vehicle(e)}.`, `Item: "${excerpt(e.data.label, 160)}"`],
      quote: excerpt(e.data.note) || undefined,
    }),
} satisfies Record<string, (e: OrderEvent, b: Brand) => RenderedMessage>;

export type TemplateId = keyof typeof TEMPLATES;

export type Severity = 'info' | 'warning';

/** Versão curta para a caixa de entrada in-app (só mensagens para a equipe). */
export const IN_APP: Partial<Record<TemplateId, (e: OrderEvent) => { title: string; body: string; severity: Severity }>> = {
  'staff.message_posted': (e) => ({
    title: `${e.order.customer.name} enviou uma mensagem`,
    body: excerpt(e.data.body, 160),
    severity: 'info',
  }),
  'staff.problem_reported': (e) => ({
    title: `${e.order.customer.name} relatou um problema`,
    body: excerpt(e.data.body, 160),
    severity: 'warning',
  }),
  'staff.checklist_issue': (e) => ({
    title: 'Item do checklist com problema',
    body: `${excerpt(e.data.label, 100)}${e.data.note ? ` — ${excerpt(e.data.note, 100)}` : ''}`,
    severity: 'warning',
  }),
};
