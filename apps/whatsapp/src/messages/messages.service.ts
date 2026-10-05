import { createHash } from 'node:crypto';
import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { CONFIG, type AppConfig } from '../config/config.js';
import { Database } from '../db/database.service.js';
import { normalizePhone } from '../phone.js';
import {
  TEMPLATES,
  isTemplateName,
  prepareVariables,
} from '../templates/templates.js';
import type { SendMessageInput } from './schema.js';

interface MessageRow {
  id: string;
  request_hash: string;
  status: string;
  to_phone: string;
  kind: string;
  template: string | null;
  reference: Record<string, unknown>;
  attempts: number;
  last_error: string | null;
  last_error_code: string | null;
  wamid: string | null;
  sent_at: Date | null;
  delivered_at: Date | null;
  read_at: Date | null;
  created_at: Date;
}

/** O telefone nunca volta inteiro pela API: só os 4 últimos dígitos. */
const publicView = (r: MessageRow) => ({
  id: r.id,
  status: r.status,
  to: `***${r.to_phone.slice(-4)}`,
  type: r.kind.toLowerCase(),
  template: r.template,
  reference: r.reference,
  attempts: r.attempts,
  error: r.last_error
    ? { message: r.last_error, code: r.last_error_code }
    : null,
  sentAt: r.sent_at,
  deliveredAt: r.delivered_at,
  readAt: r.read_at,
  createdAt: r.created_at,
});

@Injectable()
export class MessagesService {
  constructor(
    private readonly db: Database,
    @Inject(CONFIG) private readonly cfg: AppConfig,
  ) {}

  /**
   * Enfileira (não envia): responde rápido e o Dispatcher entrega com retry. Idempotente pela chave:
   * o mesmo `idempotencyKey` com o mesmo conteúdo devolve a mensagem já criada (o chamador pode
   * repetir a requisição à vontade após timeout); com conteúdo diferente é conflito.
   */
  async enqueue(idempotencyKey: string, input: SendMessageInput) {
    const to = normalizePhone(input.to);
    if (!to)
      throw new UnprocessableEntityException(
        'Telefone inválido: informe celular brasileiro com DDD',
      );

    let template: string | null = null;
    let variables: string[] = [];
    if (input.type === 'template') {
      if (!isTemplateName(input.template))
        throw new UnprocessableEntityException('Template desconhecido');
      try {
        variables = prepareVariables(input.template, input.variables);
      } catch (err) {
        throw new UnprocessableEntityException((err as Error).message);
      }
      template = input.template;
    }

    const requestHash = createHash('sha256')
      .update(
        JSON.stringify([
          to,
          input.type,
          template,
          variables,
          input.type === 'text' ? input.text : null,
        ]),
      )
      .digest('hex');

    const contact = await this.db.query<{
      opt_status: string;
      last_inbound_at: Date | null;
    }>('SELECT opt_status, last_inbound_at FROM contacts WHERE phone = $1', [
      to,
    ]);
    const optedOut = contact.rows[0]?.opt_status === 'OPTED_OUT';
    if (input.type === 'text' && !optedOut) {
      const last = contact.rows[0]?.last_inbound_at;
      if (!last || Date.now() - last.getTime() > this.cfg.serviceWindowMs) {
        throw new UnprocessableEntityException(
          'Texto livre só é permitido até 24h depois da última mensagem do cliente; use um template.',
        );
      }
    }

    // Opt-out vira registro SUPPRESSED (auditável e idempotente), nunca é enviado.
    const { rows } = await this.db.query<MessageRow>(
      `INSERT INTO messages (idempotency_key, request_hash, to_phone, kind, template, language, variables, body,
                             reference, status, max_attempts)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
       ON CONFLICT (idempotency_key) DO NOTHING
       RETURNING *`,
      [
        idempotencyKey,
        requestHash,
        to,
        input.type === 'text' ? 'TEXT' : 'TEMPLATE',
        template,
        template
          ? TEMPLATES[template as keyof typeof TEMPLATES].language
          : null,
        JSON.stringify(variables),
        input.type === 'text' ? input.text : null,
        JSON.stringify(input.reference),
        optedOut ? 'SUPPRESSED' : 'QUEUED',
        this.cfg.dispatch.maxAttempts,
      ],
    );
    if (rows[0]) return { ...publicView(rows[0]), duplicate: false };

    const existing = (
      await this.db.query<MessageRow>(
        'SELECT * FROM messages WHERE idempotency_key = $1',
        [idempotencyKey],
      )
    ).rows[0];
    if (!existing)
      throw new ConflictException(
        'Corrida na chave de idempotência; tente novamente',
      );
    if (existing.request_hash !== requestHash) {
      throw new ConflictException(
        'Idempotency-Key já usada com um conteúdo diferente',
      );
    }
    return { ...publicView(existing), duplicate: true };
  }

  async get(id: string) {
    if (!/^[0-9a-f-]{36}$/i.test(id))
      throw new NotFoundException('Mensagem não encontrada');
    const { rows } = await this.db.query<MessageRow>(
      'SELECT * FROM messages WHERE id = $1',
      [id],
    );
    if (!rows[0]) throw new NotFoundException('Mensagem não encontrada');
    return publicView(rows[0]);
  }

  /** Mensagens ligadas a uma ordem (reference.orderId), mais recentes primeiro. */
  async listByOrder(orderId: string) {
    if (!orderId) throw new BadRequestException('orderId obrigatório');
    const { rows } = await this.db.query<MessageRow>(
      'SELECT * FROM messages WHERE reference @> $1::jsonb ORDER BY created_at DESC LIMIT 100',
      [JSON.stringify({ orderId })],
    );
    return rows.map(publicView);
  }

  async setOpt(
    rawPhone: string,
    status: 'OPTED_IN' | 'OPTED_OUT',
    reason?: string,
  ) {
    const phone = normalizePhone(rawPhone);
    if (!phone) throw new UnprocessableEntityException('Telefone inválido');
    await this.db.query(
      `INSERT INTO contacts (phone, opt_status, opt_reason) VALUES ($1,$2,$3)
       ON CONFLICT (phone) DO UPDATE SET opt_status = $2, opt_reason = $3, updated_at = now()`,
      [phone, status, reason ?? null],
    );
    return { phone: `***${phone.slice(-4)}`, status };
  }
}
