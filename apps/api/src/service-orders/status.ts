import type { ServiceOrderStatus } from '@fixer/db';

/**
 * Máquina de estados da ordem de serviço. DELIVERED e CANCELLED são terminais.
 * O estoque é debitado em QUOTE -> APPROVED e devolvido se a ordem for
 * cancelada depois de aprovada (ver ServiceOrdersService.transition).
 */
const TRANSITIONS: Record<ServiceOrderStatus, readonly ServiceOrderStatus[]> = {
  QUOTE: ['APPROVED', 'CANCELLED'],
  APPROVED: ['IN_PROGRESS', 'CANCELLED'],
  IN_PROGRESS: ['AWAITING_PART', 'COMPLETED', 'CANCELLED'],
  AWAITING_PART: ['IN_PROGRESS', 'CANCELLED'],
  COMPLETED: ['DELIVERED'],
  DELIVERED: [],
  CANCELLED: [],
};

export const canTransition = (from: ServiceOrderStatus, to: ServiceOrderStatus) =>
  TRANSITIONS[from].includes(to);

export const isTerminal = (status: ServiceOrderStatus) => TRANSITIONS[status].length === 0;

export const nextStatuses = (from: ServiceOrderStatus) => TRANSITIONS[from];

/** Estoque já foi debitado para ordens em qualquer status posterior a QUOTE. */
export const hasDebitedStock = (status: ServiceOrderStatus) => status !== 'QUOTE';
