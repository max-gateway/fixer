import { describe, expect, it, vi } from 'vitest';
import { generateLinkCode, LINK_CODE_PATTERN, whatsappDeepLink } from './link-code.js';
import { decideLink } from './link.policy.js';
import { WhatsappLinkService } from './link.service.js';
import { last4, phoneKey, samePhone, toE164, toNational } from './phone.js';
import type { OrderCodeReceived } from './inbound-event.js';

describe('link code', () => {
  it('gera no formato OS-XXXX-XXXX, sem caracteres ambíguos, e sem repetir', () => {
    const codes = new Set(Array.from({ length: 500 }, generateLinkCode));
    expect(codes.size).toBe(500);
    for (const c of codes) expect(c).toMatch(LINK_CODE_PATTERN);
  });

  it('deep link do wa.me leva o código no texto; sem número da oficina não há link', () => {
    const url = whatsappDeepLink('+55 (11) 99999-0000', 'OS-K7Q2-X9MA')!;
    expect(url.startsWith('https://wa.me/5511999990000?text=')).toBe(true);
    expect(decodeURIComponent(url)).toContain('OS-K7Q2-X9MA');
    expect(whatsappDeepLink(undefined, 'OS-K7Q2-X9MA')).toBeNull();
    expect(whatsappDeepLink('123', 'OS-K7Q2-X9MA')).toBeNull();
  });
});

describe('phone', () => {
  it('é o mesmo telefone com ou sem formatação, DDI ou nono dígito', () => {
    for (const v of ['(11) 98765-4321', '+55 11 98765-4321', '5511987654321', '11987654321', '551187654321']) {
      expect(phoneKey(v)).toBe('11987654321');
    }
    expect(samePhone('(11) 98765-4321', '551187654321')).toBe(true);
    expect(samePhone('(11) 98765-4321', '5511987654322')).toBe(false);
  });

  it('vazio nunca é igual a vazio', () => {
    expect(samePhone(null, null)).toBe(false);
    expect(samePhone('', '')).toBe(false);
  });

  it('formata para cadastro (nacional) e para o serviço de WhatsApp (E.164)', () => {
    expect(toNational('5511987654321')).toBe('11987654321');
    expect(toE164('(11) 98765-4321')).toBe('5511987654321');
    expect(last4('5511987654321')).toBe('4321');
  });
});

describe('decideLink', () => {
  const open = { status: 'QUOTE' as const, whatsappLinkedPhone: null, customerPhone: null };
  const from = '5511987654321';

  it('cadastro sem telefone: vincula e preenche o telefone', () => {
    expect(decideLink(open, from)).toEqual({ kind: 'link', fillCustomerPhone: true });
  });

  it('telefone cadastrado igual ao do WhatsApp (mesmo com formatação diferente): vincula sem sobrescrever', () => {
    expect(decideLink({ ...open, customerPhone: '(11) 98765-4321' }, from)).toEqual({ kind: 'link', fillCustomerPhone: false });
  });

  it('telefone cadastrado diferente: conflito, nunca troca', () => {
    expect(decideLink({ ...open, customerPhone: '11911112222' }, from)).toEqual({ kind: 'conflict', reason: 'customer_phone' });
  });

  it('já vinculado ao mesmo número: nada a fazer; a outro número: conflito', () => {
    expect(decideLink({ ...open, whatsappLinkedPhone: '5511987654321' }, '551187654321')).toEqual({ kind: 'already_linked' });
    expect(decideLink({ ...open, whatsappLinkedPhone: '5511987654321' }, '5521999998888')).toEqual({ kind: 'conflict', reason: 'linked_phone' });
  });

  it.each(['DELIVERED', 'CANCELLED'] as const)('ordem %s: o código deixa de valer', (status) => {
    expect(decideLink({ ...open, status }, from)).toEqual({ kind: 'closed' });
  });
});

describe('WhatsappLinkService.handle', () => {
  const event = (over: Partial<OrderCodeReceived['data']> = {}): OrderCodeReceived => ({
    id: '3f2c1d0e-6b1a-4c1e-9d55-0a1b2c3d4e5f',
    type: 'whatsapp.order_code_received',
    version: 1,
    occurredAt: '2026-10-05T12:00:00.000Z',
    tenant: 'local',
    source: 'whatsapp',
    data: { wamid: 'wamid.1', from: '5511987654321', code: 'OS-K7Q2-X9MA', sentAt: '2026-10-05T12:00:00.000Z', ...over },
  });

  function setup(order: Record<string, unknown> | null, { duplicate = false, seenConflict = false } = {}) {
    const tx = {
      processedInboundEvent: { createMany: vi.fn().mockResolvedValue({ count: duplicate ? 0 : 1 }) },
      $queryRaw: vi.fn().mockResolvedValue([]),
      serviceOrder: {
        findUnique: vi.fn().mockResolvedValue(order),
        // emitOrderEvent relê a ordem para montar o snapshot
        findUniqueOrThrow: vi.fn().mockResolvedValue({
          id: 'o1', number: 7, status: 'QUOTE', portalToken: 't', customerId: 'c1',
          customer: { id: 'c1', name: 'Maria', email: null, phone: '11987654321' },
          vehicle: { plate: 'ABC1D23', brand: 'VW', model: 'Gol' }, createdBy: null, assignedTo: null,
        }),
        update: vi.fn(),
      },
      customer: { update: vi.fn() },
      serviceOrderEvent: {
        create: vi.fn(),
        findFirst: vi.fn().mockResolvedValue(seenConflict ? { id: 'e1' } : null),
      },
      outboxEvent: { create: vi.fn() },
    };
    const prisma = { $transaction: (fn: (t: typeof tx) => unknown) => fn(tx) };
    return { tx, service: new WhatsappLinkService(prisma as never) };
  }

  const base = (over: Record<string, unknown> = {}) => ({
    id: 'o1', status: 'QUOTE', whatsappLinkedPhone: null, customerId: 'c1',
    customer: { name: 'Maria', phone: null }, ...over,
  });
  const emitted = (tx: ReturnType<typeof setup>['tx']) => tx.outboxEvent.create.mock.calls.map((c) => c[0].data.type);

  it('vincula: grava telefone na ordem e no cadastro, registra na linha do tempo e emite order.whatsapp_linked', async () => {
    const { tx, service } = setup(base());
    await expect(service.handle(event())).resolves.toBe('linked');
    expect(tx.serviceOrder.update).toHaveBeenCalledWith({
      where: { id: 'o1' },
      data: { whatsappLinkedAt: expect.any(Date), whatsappLinkedPhone: '5511987654321' },
    });
    expect(tx.customer.update).toHaveBeenCalledWith({ where: { id: 'c1' }, data: { phone: '11987654321' } });
    expect(tx.serviceOrderEvent.create.mock.calls[0]![0].data).toMatchObject({ type: 'WHATSAPP_LINK', author: 'SYSTEM' });
    expect(emitted(tx)).toEqual(['order.whatsapp_linked']);
  });

  it('não mexe no cadastro quando o telefone já era o mesmo', async () => {
    const { tx, service } = setup(base({ customer: { name: 'Maria', phone: '(11) 98765-4321' } }));
    await expect(service.handle(event())).resolves.toBe('linked');
    expect(tx.customer.update).not.toHaveBeenCalled();
  });

  it('evento repetido é no-op: não toca na ordem nem emite nada', async () => {
    const { tx, service } = setup(base(), { duplicate: true });
    await expect(service.handle(event())).resolves.toBe('duplicate_event');
    expect(tx.serviceOrder.findUnique).not.toHaveBeenCalled();
    expect(tx.outboxEvent.create).not.toHaveBeenCalled();
  });

  it('código desconhecido: silêncio (nenhum evento, nenhuma escrita)', async () => {
    const { tx, service } = setup(null);
    await expect(service.handle(event())).resolves.toBe('unknown_code');
    expect(tx.serviceOrderEvent.create).not.toHaveBeenCalled();
    expect(tx.outboxEvent.create).not.toHaveBeenCalled();
  });

  it('reenvio do mesmo número já vinculado: silêncio', async () => {
    const { tx, service } = setup(base({ whatsappLinkedPhone: '5511987654321' }));
    await expect(service.handle(event())).resolves.toBe('already_linked');
    expect(tx.outboxEvent.create).not.toHaveBeenCalled();
  });

  it('ordem encerrada: silêncio', async () => {
    const { tx, service } = setup(base({ status: 'DELIVERED' }));
    await expect(service.handle(event())).resolves.toBe('closed');
    expect(tx.serviceOrder.update).not.toHaveBeenCalled();
  });

  it('número diferente do cadastrado: NÃO sobrescreve, registra o conflito para a oficina e emite o evento', async () => {
    const { tx, service } = setup(base({ customer: { name: 'Maria', phone: '11911112222' } }));
    await expect(service.handle(event())).resolves.toBe('conflict');
    expect(tx.serviceOrder.update).not.toHaveBeenCalled();
    expect(tx.customer.update).not.toHaveBeenCalled();
    expect(tx.serviceOrderEvent.create.mock.calls[0]![0].data.data).toMatchObject({ result: 'conflict', reason: 'customer_phone', phoneLast4: '4321' });
    expect(emitted(tx)).toEqual(['order.whatsapp_link_conflict']);
  });

  it('o mesmo número insistindo não repete o registro de conflito', async () => {
    const { tx, service } = setup(base({ customer: { name: 'Maria', phone: '11911112222' } }), { seenConflict: true });
    await expect(service.handle(event())).resolves.toBe('conflict');
    expect(tx.serviceOrderEvent.create).not.toHaveBeenCalled();
    expect(tx.outboxEvent.create).not.toHaveBeenCalled();
  });

  it('trava a linha da ordem antes de decidir (sem corrida entre dois números)', async () => {
    const { tx, service } = setup(base());
    await service.handle(event());
    expect(tx.$queryRaw).toHaveBeenCalledTimes(1);
    expect(tx.$queryRaw.mock.invocationCallOrder[0]!).toBeLessThan(tx.serviceOrder.findUnique.mock.invocationCallOrder[0]!);
  });
});
