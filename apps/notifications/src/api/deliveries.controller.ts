import { ConflictException, Controller, Get, HttpCode, NotFoundException, Param, ParseUUIDPipe, Post, UseGuards } from '@nestjs/common';
import { Database } from '../db/database.service.js';
import { AuthGuard } from './auth.guard.js';

interface Row {
  id: string;
  event_type: string;
  channel: string;
  recipient_kind: string;
  recipient: string;
  message: { subject?: string };
  status: string;
  attempts: number;
  max_attempts: number;
  last_error: string | null;
  next_attempt_at: Date;
  sent_at: Date | null;
  created_at: Date;
}

/** Webhook: mostra só o host (a URL pode carregar token na query). */
const shownRecipient = (r: Row) => {
  if (r.channel !== 'webhook') return r.recipient;
  try {
    return new URL(r.recipient).host;
  } catch {
    return 'endpoint';
  }
};

/** Auditoria de entregas por ordem (quem foi avisado, por qual canal, com que resultado). */
@Controller('v1')
@UseGuards(AuthGuard)
export class DeliveriesController {
  constructor(private readonly db: Database) {}

  @Get('orders/:orderId/deliveries')
  async list(@Param('orderId') orderId: string) {
    const { rows } = await this.db.query<Row>(
      `SELECT id, event_type, channel, recipient_kind, recipient, message, status, attempts, max_attempts,
              last_error, next_attempt_at, sent_at, created_at
         FROM notifications
        WHERE order_id = $1 AND channel <> 'inapp'
        ORDER BY created_at DESC, id DESC LIMIT 100`,
      [orderId.slice(0, 64)],
    );
    return {
      items: rows.map((r) => ({
        id: r.id,
        eventType: r.event_type,
        channel: r.channel,
        recipientKind: r.recipient_kind,
        recipient: shownRecipient(r),
        subject: r.message.subject ?? null,
        status: r.status,
        attempts: r.attempts,
        maxAttempts: r.max_attempts,
        lastError: r.last_error,
        nextAttemptAt: r.status === 'PENDING' ? r.next_attempt_at : null,
        sentAt: r.sent_at,
        createdAt: r.created_at,
      })),
    };
  }

  /** Reenfileira uma notificação que esgotou as tentativas (DEAD). */
  @Post('deliveries/:id/retry')
  @HttpCode(200)
  async retry(@Param('id', new ParseUUIDPipe()) id: string) {
    const res = await this.db.query(
      `UPDATE notifications SET status = 'PENDING', attempts = 0, next_attempt_at = now(), locked_until = NULL, updated_at = now()
        WHERE id = $1 AND status = 'DEAD' AND channel <> 'inapp'`,
      [id],
    );
    if (res.rowCount) return { status: 'PENDING' };
    const exists = await this.db.query('SELECT status FROM notifications WHERE id = $1', [id]);
    if (!exists.rowCount) throw new NotFoundException('Notificação não encontrada');
    throw new ConflictException('Só notificações com falha definitiva podem ser reenviadas');
  }
}
