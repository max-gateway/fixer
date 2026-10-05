import type { ServiceOrderStatus } from '@fixer/db';
import { isTerminal } from '../service-orders/status.js';
import { phoneKey } from './phone.js';

export type LinkDecision =
  /** Vincula. `fillCustomerPhone`: o cadastro não tinha telefone, passa a ter o do WhatsApp. */
  | { kind: 'link'; fillCustomerPhone: boolean }
  /** Mesmo WhatsApp já vinculado (cliente reenviou o código): nada a fazer. */
  | { kind: 'already_linked' }
  /** Outro número: nunca sobrescreve, a oficina decide. */
  | { kind: 'conflict'; reason: 'linked_phone' | 'customer_phone' }
  /** Ordem encerrada: o código deixa de valer. */
  | { kind: 'closed' };

/**
 * Regra de vínculo, pura e sem I/O (por isso fácil de testar exaustivamente).
 *
 * Por que nunca sobrescrever: o código aparece na página do portal e viaja no link. Se a oficina
 * digitou o telefone errado, quem recebeu o link é um desconhecido; deixá-lo trocar o número
 * entregaria a conversa e as notificações da ordem a ele. O conflito vira um registro para a
 * oficina resolver, em vez de uma decisão automática.
 */
export function decideLink(
  order: { status: ServiceOrderStatus; whatsappLinkedPhone: string | null; customerPhone: string | null },
  from: string,
): LinkDecision {
  if (isTerminal(order.status)) return { kind: 'closed' };

  const key = phoneKey(from);
  if (order.whatsappLinkedPhone) {
    return phoneKey(order.whatsappLinkedPhone) === key
      ? { kind: 'already_linked' }
      : { kind: 'conflict', reason: 'linked_phone' };
  }

  const registered = phoneKey(order.customerPhone);
  if (registered !== '' && registered !== key) return { kind: 'conflict', reason: 'customer_phone' };
  return { kind: 'link', fillCustomerPhone: registered === '' };
}
