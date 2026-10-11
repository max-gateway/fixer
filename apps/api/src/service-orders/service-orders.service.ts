import { randomBytes } from 'node:crypto';
import { ConflictException, Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import type { EstimateSource, Prisma, Service, ServiceOrderStatus, VariantResolution } from '@fixer/db';
import type { AuthUser } from '../auth/auth.decorators.js';
import { emitOrderEvent } from '../outbox/order-events.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { LearningService } from '../learning/learning.service.js';
import { VehicleVariantsService } from '../vehicle-variants/vehicle-variants.service.js';
import { generateLinkCode } from '../whatsapp-link/link-code.js';
import { DEFAULT_CHECKLIST } from './checklist.template.js';
import { appendEvent, EVENT_SELECT } from './events.js';
import type { AddServiceLineInput, ChecklistItemInput, CreateServiceOrderInput, HoursInput, MessageInput, TransitionInput } from './schema.js';
import { canTransition, hasDebitedStock, isTerminal, nextStatuses } from './status.js';

type Tx = Prisma.TransactionClient;

const DETAIL = {
  customer: true,
  vehicle: true,
  createdBy: { select: { id: true, name: true } },
  assignedTo: { select: { id: true, name: true } },
  partLines: { orderBy: { createdAt: 'asc' } },
  serviceLines: { orderBy: { createdAt: 'asc' } },
  statusLogs: { orderBy: { createdAt: 'asc' }, include: { changedBy: { select: { id: true, name: true } } } },
  checklist: { orderBy: { position: 'asc' } },
  events: { orderBy: { createdAt: 'asc' }, select: EVENT_SELECT },
} satisfies Prisma.ServiceOrderInclude;

/** Anexa as transições permitidas para a UI não precisar replicar a máquina de estados. */
const withNext = <T extends { status: ServiceOrderStatus }>(order: T) => ({
  ...order,
  nextStatuses: nextStatuses(order.status),
});

/** Nome provisório do cadastro pendente; o cliente troca pelo nome real no portal. */
const formatPhone = (d: string) =>
  d.length === 11 ? `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}` : `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`;

const staff = (user: AuthUser) => ({ kind: 'staff' as const, id: user.id, name: user.name });

@Injectable()
export class ServiceOrdersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly variants: VehicleVariantsService,
    private readonly learning: LearningService,
  ) {}

  list(filter: { status?: ServiceOrderStatus; search?: string }) {
    const q = filter.search?.trim();
    const number = q && /^\d+$/.test(q) ? Number(q) : undefined;
    return this.prisma.serviceOrder.findMany({
      where: {
        status: filter.status,
        ...(q
          ? {
              OR: [
                ...(number !== undefined ? [{ number }] : []),
                { vehicle: { plate: { contains: q.toUpperCase() } } },
                { customer: { name: { contains: q, mode: 'insensitive' as const } } },
              ],
            }
          : {}),
      },
      include: { customer: { select: { id: true, name: true } }, vehicle: { select: { id: true, plate: true, brand: true, model: true } } },
      orderBy: { number: 'desc' },
      take: 100,
    });
  }

  async get(id: string) {
    const order = await this.prisma.serviceOrder.findUnique({ where: { id }, include: DETAIL });
    if (!order) throw new NotFoundException('Ordem de serviço não encontrada');
    return withNext(order);
  }

  create(input: CreateServiceOrderInput, user: AuthUser) {
    return this.prisma.$transaction(async (tx) => {
      const customer = await this.resolveCustomer(tx, input);

      const { plate, brand, model, year, color } = input.vehicle;
      const vehicle = await tx.vehicle.upsert({
        where: { plate },
        create: { plate, brand, model, year, color, mileage: input.mileageAtEntry },
        update: {
          brand,
          model,
          ...(year != null && { year }),
          ...(color != null && { color }),
          ...(input.mileageAtEntry != null && { mileage: input.mileageAtEntry }),
        },
      });
      await this.ensureOwner(tx, vehicle.id, customer.id);
      const resolved = await this.variants.attachToVehicle(tx, vehicle.id, plate);
      // Sem lookup novo, vale a variante que o veículo já tinha.
      const variantId = resolved?.variantId ?? vehicle.variantId ?? null;
      const variantResolution = resolved?.resolution ?? vehicle.variantResolution ?? null;

      const parts = await tx.part.findMany({ where: { id: { in: input.partLines.map((l) => l.partId) } } });
      const services = await tx.service.findMany({ where: { id: { in: input.serviceLines.map((l) => l.serviceId) } } });
      const partById = new Map(parts.map((p) => [p.id, p]));
      const serviceById = new Map(services.map((s) => [s.id, s]));
      const serviceLines = await this.buildServiceLines(tx, input.serviceLines, serviceById, variantId, variantResolution);

      const created = await tx.serviceOrder.create({
        data: {
          customerId: customer.id,
          vehicleId: vehicle.id,
          description: input.description,
          mileageAtEntry: input.mileageAtEntry,
          createdById: user.id,
          portalToken: randomBytes(24).toString('base64url'),
          linkCode: await this.newLinkCode(tx),
          checklist: {
            create: DEFAULT_CHECKLIST.map((item, position) => ({ ...item, position })),
          },
          events: {
            create: {
              type: 'STATUS_CHANGE',
              author: 'SYSTEM',
              body: 'Ordem de serviço aberta.',
              data: { from: null, to: 'QUOTE' },
            },
          },
          // Nome e preço são congelados (snapshot) no momento da venda.
          partLines: {
            create: input.partLines.map((l) => {
              const part = partById.get(l.partId);
              if (!part) throw new BadRequestException(`Peça não encontrada: ${l.partId}`);
              return { partId: part.id, partName: part.name, quantity: l.quantity, unitPrice: part.sellPrice };
            }),
          },
          serviceLines: { create: serviceLines },
          statusLogs: { create: { fromStatus: null, toStatus: 'QUOTE', changedById: user.id } },
        },
        include: DETAIL,
      });
      await emitOrderEvent(tx, created.id, 'order.created', staff(user), {
        description: input.description ?? null,
        mileageAtEntry: input.mileageAtEntry ?? null,
      });
      return withNext(created);
    });
  }

  /**
   * Linhas de serviço com o snapshot de nome, preço, variante do veículo e estimativa de horas
   * (spec §5): LEARNED pré-preenche, REFERENCE só informa, sem histórico fica NONE; horas
   * digitadas na criação são MANUAL e prevalecem. Serviço HOURLY tem preço = horas × valor-hora.
   */
  private async buildServiceLines(
    tx: Tx,
    inputs: CreateServiceOrderInput['serviceLines'],
    serviceById: Map<string, Service>,
    variantId: string | null,
    variantResolution: VariantResolution | null,
  ) {
    const hourlyRate = inputs.some((l) => serviceById.get(l.serviceId)?.pricingMode === 'HOURLY')
      ? Number((await tx.tenantFiscalSettings.findUnique({ where: { id: 1 } }))?.hourlyRate ?? 0) || null
      : null;

    const lines = [];
    for (const l of inputs) {
      const service = serviceById.get(l.serviceId);
      if (!service) throw new BadRequestException(`Serviço não encontrado: ${l.serviceId}`);

      const estimate = service.definitionId
        ? await this.learning.estimateFor(tx, service.definitionId, variantId)
        : ({ source: 'NONE' } as const);

      let hoursEstimated: number | null = null;
      let hoursEstimateSource: EstimateSource = 'NONE';
      if (l.hours != null) {
        hoursEstimated = l.hours;
        hoursEstimateSource = 'MANUAL';
      } else if (estimate.source !== 'NONE') {
        hoursEstimated = estimate.hours;
        hoursEstimateSource = estimate.source;
      }

      const computedPrice =
        service.pricingMode === 'HOURLY' && hoursEstimated != null && hourlyRate
          ? Math.round(hoursEstimated * hourlyRate * 100) / 100
          : null;
      lines.push({
        serviceId: service.id,
        serviceName: service.name,
        price: l.price ?? computedPrice ?? service.defaultPrice,
        description: l.description ?? null,
        hoursEstimated,
        hoursEstimateSource,
        variantId,
        variantResolution,
      });
    }
    return lines;
  }

  /** Acrescenta um serviço a uma OS ainda aberta, com o mesmo snapshot de variante/estimativa da criação. */
  addServiceLine(id: string, input: AddServiceLineInput) {
    return this.prisma.$transaction(async (tx) => {
      const order = await tx.serviceOrder.findUnique({
        where: { id },
        select: { id: true, status: true, vehicle: { select: { variantId: true, variantResolution: true } } },
      });
      if (!order) throw new NotFoundException('Ordem de serviço não encontrada');
      if (!['QUOTE', 'APPROVED', 'IN_PROGRESS', 'AWAITING_PART'].includes(order.status)) {
        throw new ConflictException('Esta ordem não aceita mais serviços');
      }
      const services = await tx.service.findMany({ where: { id: input.serviceId } });
      const [line] = await this.buildServiceLines(
        tx,
        [input],
        new Map(services.map((s) => [s.id, s])),
        order.vehicle.variantId,
        order.vehicle.variantResolution,
      );
      return tx.serviceOrderServiceLine.create({ data: { serviceOrderId: id, ...line } });
    });
  }

  /**
   * Horas reais de uma linha de serviço (informadas durante a execução, antes de concluir).
   * Aceitar o valor sugerido sem alterá-lo não é medição: vira ACCEPTED_DEFAULT (peso menor no aprendizado).
   */
  recordHours(id: string, lineId: string, input: HoursInput) {
    return this.prisma.$transaction(async (tx) => {
      const order = await tx.serviceOrder.findUnique({ where: { id }, select: { id: true, status: true } });
      if (!order) throw new NotFoundException('Ordem de serviço não encontrada');
      if (order.status !== 'IN_PROGRESS' && order.status !== 'AWAITING_PART') {
        throw new ConflictException('Horas só podem ser informadas com a ordem em execução');
      }
      const line = await tx.serviceOrderServiceLine.findFirst({ where: { id: lineId, serviceOrderId: id } });
      if (!line) throw new NotFoundException('Serviço não encontrado nesta ordem');

      const acceptedSuggestion = line.hoursEstimateSource === 'LEARNED' && Number(line.hoursEstimated) === input.hours;
      return tx.serviceOrderServiceLine.update({
        where: { id: lineId },
        data: { hoursActual: input.hours, hoursActualSource: acceptedSuggestion ? 'ACCEPTED_DEFAULT' : 'EDITED' },
      });
    });
  }

  /** Código de vínculo com o WhatsApp; a unique do banco é a palavra final, isto só evita o retry óbvio. */
  private async newLinkCode(tx: Tx): Promise<string> {
    for (let attempt = 0; attempt < 5; attempt++) {
      const code = generateLinkCode();
      if (!(await tx.serviceOrder.findUnique({ where: { linkCode: code }, select: { id: true } }))) return code;
    }
    throw new Error('Não foi possível gerar um código de vínculo único');
  }

  transition(id: string, input: TransitionInput, user: AuthUser) {
    return this.prisma.$transaction(async (tx) => {
      const order = await tx.serviceOrder.findUnique({
        where: { id },
        include: { partLines: true, serviceLines: { include: { service: { select: { definitionId: true } } } } },
      });
      if (!order) throw new NotFoundException('Ordem de serviço não encontrada');

      const from = order.status;
      const to = input.status;
      if (!canTransition(from, to)) {
        throw new ConflictException(`Transição inválida: ${from} -> ${to}`);
      }
      if (to === 'COMPLETED') {
        // Serviços do catálogo precisam das horas reais: é com elas que o sistema aprende.
        const missing = order.serviceLines.filter((l) => l.service?.definitionId && l.hoursActual == null);
        if (missing.length) {
          throw new ConflictException(`Informe as horas reais de: ${missing.map((l) => l.serviceName).join(', ')}`);
        }
      }

      if (from === 'QUOTE' && to === 'APPROVED') {
        for (const line of order.partLines) {
          await this.debitStock(tx, line, user);
        }
      } else if (to === 'CANCELLED' && hasDebitedStock(from)) {
        for (const line of order.partLines) {
          await this.returnStock(tx, line, user, input.note ?? `Ordem #${order.number} cancelada`);
        }
      }

      await tx.serviceOrder.update({
        where: { id },
        data: { status: to, closedAt: isTerminal(to) ? new Date() : null },
      });
      if (to === 'COMPLETED') await this.learning.recordForOrder(tx, id);
      await tx.serviceOrderStatusLog.create({
        data: { serviceOrderId: id, fromStatus: from, toStatus: to, changedById: user.id, note: input.note },
      });
      await appendEvent(tx, id, {
        type: 'STATUS_CHANGE',
        author: 'SHOP',
        authorUserId: user.id,
        authorName: user.name,
        body: input.note,
        data: { from, to },
      });
      await emitOrderEvent(tx, id, 'order.status_changed', staff(user), { from, to, note: input.note ?? null });
      return withNext(await tx.serviceOrder.findUniqueOrThrow({ where: { id }, include: DETAIL }));
    });
  }

  /** Mensagem da oficina para o cliente, entregue na linha do tempo do portal. */
  async addMessage(id: string, input: MessageInput, user: AuthUser) {
    await this.requireOrder(id);
    return this.prisma.$transaction(async (tx) => {
      const event = await appendEvent(tx, id, {
        type: 'MESSAGE',
        author: 'SHOP',
        authorUserId: user.id,
        authorName: user.name,
        body: input.body,
      });
      await emitOrderEvent(tx, id, 'order.message_posted', staff(user), { body: input.body });
      return event;
    });
  }

  /** Item extra no checklist da ordem (além do padrão), para o cliente responder no portal. */
  async addChecklistItem(id: string, input: ChecklistItemInput) {
    await this.requireOrder(id);
    const last = await this.prisma.serviceOrderChecklistItem.aggregate({
      where: { serviceOrderId: id },
      _max: { position: true },
    });
    return this.prisma.$transaction(async (tx) => {
      const item = await tx.serviceOrderChecklistItem.create({
        data: { serviceOrderId: id, section: input.section, label: input.label, position: (last._max.position ?? -1) + 1 },
      });
      await emitOrderEvent(tx, id, 'order.checklist_item_added', { kind: 'staff' }, { section: input.section, label: input.label });
      return item;
    });
  }

  private async requireOrder(id: string) {
    const order = await this.prisma.serviceOrder.findUnique({ where: { id }, select: { id: true } });
    if (!order) throw new NotFoundException('Ordem de serviço não encontrada');
  }

  /**
   * Cliente da ordem. Por telefone: reaproveita o cadastro mais recente com esse
   * número (já tem CPF/endereço) ou cria um pendente, sem nome nem documento, que o
   * próprio cliente completa no portal.
   */
  private async resolveCustomer(tx: Tx, input: CreateServiceOrderInput) {
    if (input.customerId) {
      const customer = await tx.customer.findUnique({ where: { id: input.customerId } });
      if (!customer) throw new BadRequestException('Cliente não encontrado');
      return customer;
    }
    const phone = input.customerPhone;
    // Sem telefone: cadastro pendente, identificado pela placa até o cliente se apresentar no portal.
    // Nunca reaproveita outro cliente (não há chave para saber quem é).
    if (!phone) return tx.customer.create({ data: { name: `Cliente ${input.vehicle.plate}` } });
    const existing = await tx.customer.findFirst({ where: { phone }, orderBy: { updatedAt: 'desc' } });
    return existing ?? tx.customer.create({ data: { phone, name: formatPhone(phone) } });
  }

  /** Mantém exatamente um VehicleOwner em aberto (endedAt = null) por veículo. */
  private async ensureOwner(tx: Tx, vehicleId: string, customerId: string) {
    const current = await tx.vehicleOwner.findFirst({ where: { vehicleId, endedAt: null } });
    if (current?.customerId === customerId) return;
    if (current) {
      await tx.vehicleOwner.update({ where: { id: current.id }, data: { endedAt: new Date() } });
    }
    await tx.vehicleOwner.create({ data: { vehicleId, customerId } });
  }

  private async debitStock(
    tx: Tx,
    line: { id: string; partId: string; partName: string; quantity: Prisma.Decimal },
    user: AuthUser,
  ) {
    // Update condicional: a checagem de saldo e o débito são atômicos, então
    // duas aprovações concorrentes nunca deixam o estoque negativo.
    const { count } = await tx.part.updateMany({
      where: { id: line.partId, stockQty: { gte: line.quantity } },
      data: { stockQty: { decrement: line.quantity } },
    });
    if (count === 0) throw new ConflictException(`Estoque insuficiente: ${line.partName}`);
    await this.recordMovement(tx, line, 'SALE_CONSUMPTION', user, null);
  }

  private async returnStock(
    tx: Tx,
    line: { id: string; partId: string; quantity: Prisma.Decimal },
    user: AuthUser,
    note: string,
  ) {
    await tx.part.update({ where: { id: line.partId }, data: { stockQty: { increment: line.quantity } } });
    await this.recordMovement(tx, line, 'RETURN', user, note);
  }

  private async recordMovement(
    tx: Tx,
    line: { id: string; partId: string; quantity: Prisma.Decimal },
    type: 'SALE_CONSUMPTION' | 'RETURN',
    user: AuthUser,
    note: string | null,
  ) {
    const part = await tx.part.findUniqueOrThrow({ where: { id: line.partId } });
    await tx.stockMovement.create({
      data: {
        partId: line.partId,
        type,
        quantity: line.quantity,
        balanceAfter: part.stockQty,
        serviceOrderPartLineId: line.id,
        note,
        createdById: user.id,
      },
    });
  }
}
