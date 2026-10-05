import type { ChannelName, RenderedMessage } from '../channels/channel.js';
import type { WebhookEndpoint } from '../config/config.js';
import type { OrderEvent } from '../contract/order-event.js';
import { IN_APP, STATUS_COPY, TEMPLATES, type Brand, type TemplateId } from '../templates/templates.js';

export interface Intent {
  /** Identifica a regra que gerou a intenção; compõe a chave de deduplicação. */
  ruleId: string;
  channel: ChannelName;
  recipientKind: 'customer' | 'staff' | 'integration';
  recipient: string;
  template: string;
  message: RenderedMessage;
}

interface EmailRule {
  id: string;
  /** null = a regra não se aplica a este evento. */
  to: 'customer' | 'staff';
  template: TemplateId;
  when: (e: OrderEvent) => boolean;
}

/**
 * Quem é notificado de quê. Regra de ouro: o autor da ação não é notificado
 * da própria ação (cliente age -> avisa a oficina; oficina age -> avisa o cliente).
 */
const EMAIL_RULES: EmailRule[] = [
  { id: 'created.customer', to: 'customer', template: 'customer.order_created', when: (e) => e.type === 'order.created' },
  { id: 'status.customer', to: 'customer', template: 'customer.status_changed', when: (e) => e.type === 'order.status_changed' },
  { id: 'message.customer', to: 'customer', template: 'customer.message_posted', when: (e) => e.type === 'order.message_posted' && e.actor.kind !== 'customer' },
  { id: 'checklist-added.customer', to: 'customer', template: 'customer.checklist_item_added', when: (e) => e.type === 'order.checklist_item_added' },
  { id: 'message.staff', to: 'staff', template: 'staff.message_posted', when: (e) => e.type === 'order.message_posted' && e.actor.kind === 'customer' },
  { id: 'problem.staff', to: 'staff', template: 'staff.problem_reported', when: (e) => e.type === 'order.problem_reported' },
  { id: 'checklist-issue.staff', to: 'staff', template: 'staff.checklist_issue', when: (e) => e.type === 'order.checklist_item_answered' && e.data.status === 'ISSUE' },
];

/** Responsável pela ordem; se não houver, quem a abriu. */
const staffEmail = (e: OrderEvent) => (e.order.assignedTo?.email ?? e.order.createdBy?.email ?? null)?.trim().toLowerCase() || null;

const matches = (pattern: string, type: string) =>
  pattern === type || (pattern.endsWith('*') && type.startsWith(pattern.slice(0, -1)));

/** Função pura: evento -> intenções de notificação. Sem I/O, trivial de testar. */
export function route(event: OrderEvent, cfg: { brand: Brand; webhooks: WebhookEndpoint[]; whatsapp?: boolean }): Intent[] {
  const intents: Intent[] = [];

  // WhatsApp do cliente: só o essencial (abertura com o link do portal e mudança de status);
  // conversa e checklist acontecem no portal, e o cliente é avisado por lá/e-mail.
  const phone = event.order.customer.phone?.trim();
  if (cfg.whatsapp && phone) {
    const reference = { orderId: event.order.id, eventType: event.type };
    if (event.type === 'order.created') {
      intents.push({
        ruleId: 'created.customer.whatsapp',
        channel: 'whatsapp',
        recipientKind: 'customer',
        recipient: phone,
        template: 'os_portal_link',
        message: {
          body: { type: 'template', template: 'os_portal_link', variables: [String(event.order.number), cfg.brand.name, event.order.portalUrl], reference },
        },
      });
    } else if (event.type === 'order.whatsapp_linked' && event.data.result === 'linked') {
      // O cliente acabou de escrever (botão do portal), então a janela de 24h está aberta e texto
      // livre é permitido: sem template, sem custo, e a resposta chega no mesmo chat.
      const { vehicle } = event.order;
      intents.push({
        ruleId: 'linked.customer.whatsapp',
        channel: 'whatsapp',
        recipientKind: 'customer',
        recipient: phone,
        template: 'whatsapp.linked_confirmation',
        message: {
          body: {
            type: 'text',
            text: `Pronto! Sua ordem de serviço #${event.order.number} (${vehicle.brand} ${vehicle.model}) na ${cfg.brand.name} está conectada a este WhatsApp. Avisaremos por aqui a cada atualização. Para parar de receber, responda PARAR.`,
            reference,
          },
        },
      });
    } else if (event.type === 'order.status_changed') {
      const to = String(event.data.to ?? event.order.status);
      const label = STATUS_COPY[to]?.subject;
      if (label) {
        intents.push({
          ruleId: 'status.customer.whatsapp',
          channel: 'whatsapp',
          recipientKind: 'customer',
          recipient: phone,
          template: 'os_status_update',
          message: {
            body: { type: 'template', template: 'os_status_update', variables: [String(event.order.number), label, event.order.portalUrl], reference },
          },
        });
      }
    }
  }

  for (const rule of EMAIL_RULES) {
    if (!rule.when(event)) continue;
    const recipient = rule.to === 'customer' ? event.order.customer.email?.trim().toLowerCase() || null : staffEmail(event);
    if (!recipient) continue; // sem e-mail cadastrado: nada a entregar neste canal
    intents.push({
      ruleId: rule.id,
      channel: 'email',
      recipientKind: rule.to,
      recipient,
      template: rule.template,
      message: TEMPLATES[rule.template](event, cfg.brand),
    });

    // A equipe também recebe na caixa de entrada do sistema (sino), em tempo real.
    const inApp = rule.to === 'staff' ? IN_APP[rule.template]?.(event) : undefined;
    if (inApp) {
      intents.push({
        ruleId: `${rule.id}.inapp`,
        channel: 'inapp',
        recipientKind: 'staff',
        recipient,
        template: rule.template,
        message: { subject: inApp.title, text: inApp.body, body: { severity: inApp.severity, orderNumber: event.order.number } },
      });
    }
  }

  // Integrações: recebem o evento cru, assinado, para qualquer mudança que assinaram.
  for (const hook of cfg.webhooks) {
    if (!hook.events.some((p) => matches(p, event.type))) continue;
    intents.push({
      ruleId: 'webhook',
      channel: 'webhook',
      recipientKind: 'integration',
      recipient: hook.url,
      template: 'webhook.raw_event',
      message: { body: event },
    });
  }

  return intents;
}
