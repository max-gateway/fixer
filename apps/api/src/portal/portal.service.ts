import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { TenantContext } from '../tenancy/tenant-context.js';
import type { Prisma } from '@fixer/db';
import { emitOrderEvent } from '../outbox/order-events.js';
import { RateLimiter } from '../common/rate-limit.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { appendEvent, EVENT_SELECT } from '../service-orders/events.js';
import type { MessageInput } from '../service-orders/schema.js';
import { isTerminal } from '../service-orders/status.js';
import { whatsappDeepLink } from '../whatsapp-link/link-code.js';
import type { ChecklistAnswerInput, CustomerDataInput, ProblemReportInput } from './schema.js';

type ProfileField = Exclude<keyof CustomerDataInput, 'document'>;
const CUSTOMER_FIELDS: [ProfileField, string][] = [
  ['name', 'Nome'],
  ['phone', 'Telefone'],
  ['email', 'E-mail'],
  ['zipCode', 'CEP'],
  ['street', 'Rua'],
  ['number', 'Número'],
  ['complement', 'Complemento'],
  ['district', 'Bairro'],
  ['city', 'Cidade'],
  ['state', 'UF'],
];

const customerActor = (order: { customerId: string; customer: { name: string } }) => ({
  kind: 'customer' as const,
  id: order.customerId,
  name: order.customer.name,
});

const digits = (v: string | null | undefined) => (v ?? '').replace(/\D/g, '');
const samePhone = (a: string | null, b: string | null) => digits(a) !== '' && digits(a) === digits(b);

const isLinkConflict = (e: { type: string; data: unknown }) =>
  e.type === 'WHATSAPP_LINK' && (e.data as { result?: string } | null)?.result === 'conflict';

/**
 * Estado do vínculo com o WhatsApp para o portal. `url` (botão "Falar com a oficina") só existe
 * enquanto há o que vincular: ordem aberta, ainda não vinculada e número da oficina configurado.
 */
function whatsappState(order: { status: Parameters<typeof isTerminal>[0]; linkCode: string; whatsappLinkedAt: Date | null; whatsappLinkedPhone: string | null }) {
  const linked = order.whatsappLinkedAt !== null;
  return {
    linked,
    phoneLast4: linked && order.whatsappLinkedPhone ? order.whatsappLinkedPhone.slice(-4) : null,
    url: linked || isTerminal(order.status) ? null : whatsappDeepLink(process.env.WHATSAPP_BUSINESS_PHONE, order.linkCode),
  };
}

/** CPF/CNPJ nunca sai inteiro por um link público: só os 2 últimos dígitos. */
const maskDocument = (doc: string) => `${'•'.repeat(Math.max(doc.length - 2, 0))}${doc.slice(-2)}`;

/**
 * Portal do cliente. O token da ordem (ServiceOrder.portalToken) é a credencial:
 * quem tem o link lê e escreve na ordem, sem login. Por isso o token é de alta
 * entropia, nada daqui devolve dados de outras ordens e as escritas têm rate limit.
 */
@Injectable()
export class PortalService {
  private readonly writes = new RateLimiter(30, 60_000);
  private readonly lookups = new RateLimiter(10, 60_000);

  constructor(private readonly prisma: PrismaService) {}

  async view(token: string) {
    const order = await this.prisma.serviceOrder.findUnique({
      where: { portalToken: token },
      include: {
        customer: true,
        vehicle: true,
        partLines: { orderBy: { createdAt: 'asc' } },
        serviceLines: { orderBy: { createdAt: 'asc' } },
        checklist: { orderBy: { position: 'asc' } },
        events: { orderBy: { createdAt: 'asc' }, select: EVENT_SELECT },
      },
    });
    if (!order) throw new NotFoundException('Link inválido ou expirado');

    const { customer, vehicle } = order;
    const total =
      order.partLines.reduce((sum, l) => sum + Number(l.quantity) * Number(l.unitPrice), 0) +
      order.serviceLines.reduce((sum, l) => sum + Number(l.price), 0);

    return {
      number: order.number,
      status: order.status,
      createdAt: order.createdAt,
      readOnly: isTerminal(order.status),
      description: order.description,
      mileageAtEntry: order.mileageAtEntry,
      vehicle: {
        plate: vehicle.plate,
        brand: vehicle.brand,
        model: vehicle.model,
        year: vehicle.year,
        color: vehicle.color,
      },
      // Cadastro pendente: ainda não há nome nem documento reais, o cliente informa no portal.
      registrationPending: customer.document === null,
      customer: {
        name: customer.document === null ? '' : customer.name,
        document: customer.document === null ? null : maskDocument(customer.document),
        phone: customer.phone,
        email: customer.email,
        zipCode: customer.zipCode,
        street: customer.street,
        number: customer.number,
        complement: customer.complement,
        district: customer.district,
        city: customer.city,
        state: customer.state,
      },
      services: order.serviceLines.map((l) => ({ id: l.id, name: l.serviceName, price: l.price })),
      parts: order.partLines.map((l) => ({
        id: l.id,
        name: l.partName,
        quantity: l.quantity,
        unitPrice: l.unitPrice,
      })),
      total,
      checklist: order.checklist.map((c) => ({
        id: c.id,
        section: c.section,
        label: c.label,
        status: c.status,
        note: c.note,
        answeredAt: c.answeredAt,
      })),
      // Tentativas de vínculo recusadas são assunto da oficina: o portal não as mostra.
      events: order.events.filter((e) => !isLinkConflict(e)),
      whatsapp: whatsappState(order),
    };
  }

  async sendMessage(token: string, input: MessageInput) {
    const order = await this.openOrder(token);
    return this.prisma.$transaction(async (tx) => {
      const event = await appendEvent(tx, order.id, {
        type: 'MESSAGE',
        author: 'CUSTOMER',
        authorName: order.customer.name,
        body: input.body,
      });
      await emitOrderEvent(tx, order.id, 'order.message_posted', customerActor(order), { body: input.body });
      return event;
    });
  }

  async reportProblem(token: string, input: ProblemReportInput) {
    const order = await this.openOrder(token);
    return this.prisma.$transaction(async (tx) => {
      const event = await appendEvent(tx, order.id, {
        type: 'PROBLEM_REPORT',
        author: 'CUSTOMER',
        authorName: order.customer.name,
        body: input.body,
        data: { symptoms: input.symptoms, when: input.when },
      });
      await emitOrderEvent(tx, order.id, 'order.problem_reported', customerActor(order), {
        body: input.body,
        symptoms: input.symptoms,
        when: input.when,
      } as Prisma.InputJsonObject);
      return event;
    });
  }

  async answerChecklist(token: string, itemId: string, input: ChecklistAnswerInput) {
    const order = await this.openOrder(token);
    return this.prisma.$transaction(async (tx) => {
      const item = await tx.serviceOrderChecklistItem.findFirst({ where: { id: itemId, serviceOrderId: order.id } });
      if (!item) throw new NotFoundException('Item de checklist não encontrado');

      const note = input.status === 'PENDING' ? null : input.note;
      if (item.status === input.status && item.note === note) return item; // nada mudou: sem evento

      const updated = await tx.serviceOrderChecklistItem.update({
        where: { id: item.id },
        data: { status: input.status, note, answeredAt: input.status === 'PENDING' ? null : new Date() },
      });
      await appendEvent(tx, order.id, {
        type: 'CHECKLIST_UPDATE',
        author: 'CUSTOMER',
        authorName: order.customer.name,
        body: note,
        data: { itemId: item.id, label: item.label, status: input.status },
      });
      await emitOrderEvent(tx, order.id, 'order.checklist_item_answered', customerActor(order), {
        itemId: item.id,
        label: item.label,
        status: input.status,
        note,
      });
      return updated;
    });
  }

  /**
   * Busca automática pelo CPF/CNPJ: se já existe cadastro, devolve os dados para pré-preencher.
   * Como o link é público, só entrega os dados quando o telefone do cadastro é o mesmo da ordem
   * (o link foi para esse WhatsApp); fora disso, não revela nem que o documento existe.
   */
  async lookupCustomer(token: string, document: string) {
    this.lookups.consume(token);
    const order = await this.prisma.serviceOrder.findUnique({
      where: { portalToken: token },
      select: { status: true, customer: true },
    });
    if (!order) throw new NotFoundException('Link inválido ou expirado');
    if (order.customer.document !== null || isTerminal(order.status)) return { found: false as const };

    const existing = await this.prisma.customer.findUnique({ where: { orgId_document: { orgId: TenantContext.require(), document } } });
    if (!existing || !samePhone(existing.phone, order.customer.phone)) return { found: false as const };
    const { name, phone, email, zipCode, street, number, complement, district, city, state } = existing;
    return {
      found: true as const,
      customer: { name, phone, email, zipCode, street, number, complement, district, city, state },
    };
  }

  async updateCustomer(token: string, input: CustomerDataInput) {
    const order = await this.openOrder(token);
    const { document, ...profile } = input;
    const pending = order.customer.document === null;
    if (pending && !document) throw new BadRequestException('Informe seu CPF ou CNPJ');

    const changedFields = (current: Record<string, unknown>) =>
      CUSTOMER_FIELDS.filter(([key]) => (current[key] ?? null) !== profile[key]).map(([, label]) => label);

    if (!pending) {
      const changed = changedFields(order.customer);
      if (changed.length === 0) return { changed };
      await this.prisma.$transaction(async (tx) => {
        await tx.customer.update({ where: { id: order.customerId }, data: profile });
        await this.recordCustomerUpdate(tx, order.id, profile.name, changed);
      });
      return { changed };
    }

    try {
      return await this.prisma.$transaction(async (tx) => {
        const existing = await tx.customer.findUnique({ where: { orgId_document: { orgId: TenantContext.require(), document: document! } } });
        let changed: string[];
        if (existing && existing.id !== order.customerId) {
          // Já tem cadastro com este documento: a ordem passa a ser dele e o cadastro pendente some.
          if (!samePhone(existing.phone, order.customer.phone)) {
            throw new ConflictException(
              'Este CPF/CNPJ já está cadastrado com outro telefone. Fale com a oficina para atualizar o cadastro.',
            );
          }
          changed = ['CPF/CNPJ', ...changedFields(existing)];
          await tx.serviceOrder.updateMany({ where: { customerId: order.customerId }, data: { customerId: existing.id } });
          await tx.vehicleOwner.updateMany({ where: { customerId: order.customerId }, data: { customerId: existing.id } });
          await tx.customer.delete({ where: { id: order.customerId } });
          await tx.customer.update({ where: { id: existing.id }, data: profile });
        } else {
          changed = ['CPF/CNPJ', ...changedFields(order.customer)];
          await tx.customer.update({ where: { id: order.customerId }, data: { ...profile, document } });
        }
        await this.recordCustomerUpdate(tx, order.id, profile.name, changed);
        return { changed };
      });
    } catch (err) {
      // Duas aberturas simultâneas com o mesmo documento: a unique do banco decide.
      if ((err as { code?: string }).code === 'P2002') {
        throw new ConflictException('Este CPF/CNPJ já está cadastrado. Tente novamente.');
      }
      throw err;
    }
  }

  private async recordCustomerUpdate(tx: Prisma.TransactionClient, orderId: string, name: string, fields: string[]) {
    // Relê: numa fusão o cliente da ordem mudou de id.
    const { customerId } = await tx.serviceOrder.findUniqueOrThrow({ where: { id: orderId }, select: { customerId: true } });
    await appendEvent(tx, orderId, {
      type: 'CUSTOMER_DATA_UPDATE',
      author: 'CUSTOMER',
      authorName: name,
      data: { fields } satisfies Prisma.InputJsonObject,
    });
    await emitOrderEvent(tx, orderId, 'order.customer_data_updated', { kind: 'customer', id: customerId, name }, { fields });
  }

  /** Ordem encontrada pelo token e ainda aberta para escrita; aplica o rate limit. */
  private async openOrder(token: string) {
    this.writes.consume(token);
    const order = await this.prisma.serviceOrder.findUnique({
      where: { portalToken: token },
      select: { id: true, status: true, customerId: true, customer: true },
    });
    if (!order) throw new NotFoundException('Link inválido ou expirado'
);
    if (isTerminal(order.status)) throw new ConflictException('Esta ordem foi encerrada e não aceita novas interações.');
    return order;
  }
}
