import { Injectable } from '@nestjs/common';
import { Database } from '../db/database.service.js';
import type { InboxItem } from './inbox.bus.js';

interface Row {
  id: string;
  order_id: string;
  event_type: string;
  message: { subject?: string; text?: string; body?: { severity?: 'info' | 'warning'; orderNumber?: number } };
  created_at: Date;
  read_at: Date | null;
}

const toItem = (r: Row): InboxItem => ({
  id: r.id,
  orderId: r.order_id,
  orderNumber: r.message.body?.orderNumber ?? null,
  eventType: r.event_type,
  title: r.message.subject ?? '',
  body: r.message.text ?? '',
  severity: r.message.body?.severity ?? 'info',
  createdAt: new Date(r.created_at).toISOString(),
  readAt: r.read_at ? new Date(r.read_at).toISOString() : null,
});

/** Cursor opaco = (created_at, id) do último item: paginação estável mesmo com inserções novas. */
const encode = (r: Row) => Buffer.from(`${new Date(r.created_at).toISOString()}|${r.id}`).toString('base64url');
function decode(cursor?: string): [string, string] | null {
  if (!cursor) return null;
  const [at, id] = Buffer.from(cursor, 'base64url').toString().split('|');
  return at && id && !Number.isNaN(Date.parse(at)) ? [at, id] : null;
}

@Injectable()
export class InboxService {
  constructor(private readonly db: Database) {}

  async list(email: string, opts: { limit: number; cursor?: string; unreadOnly: boolean }) {
    const after = decode(opts.cursor);
    const { rows } = await this.db.query<Row>(
      `SELECT id, order_id, event_type, message, created_at, read_at FROM notifications
        WHERE channel = 'inapp' AND recipient = $1
          AND ($2::boolean = false OR read_at IS NULL)
          AND ($3::timestamptz IS NULL OR (created_at, id) < ($3::timestamptz, $4::uuid))
        ORDER BY created_at DESC, id DESC
        LIMIT $5`,
      [email, opts.unreadOnly, after?.[0] ?? null, after?.[1] ?? '00000000-0000-0000-0000-000000000000', opts.limit + 1],
    );
    const page = rows.slice(0, opts.limit);
    return {
      items: page.map(toItem),
      nextCursor: rows.length > opts.limit ? encode(page[page.length - 1]) : null,
      unreadCount: await this.unreadCount(email),
    };
  }

  async unreadCount(email: string): Promise<number> {
    const { rows } = await this.db.query<{ n: string }>(
      `SELECT count(*) AS n FROM notifications WHERE channel = 'inapp' AND recipient = $1 AND read_at IS NULL`,
      [email],
    );
    return Number(rows[0]?.n ?? 0);
  }

  /** Marca como lidas (só as do próprio usuário: o filtro por recipient impede mexer nas dos outros). */
  async markRead(email: string, target: { ids: string[] } | { all: true }): Promise<number> {
    const res =
      'all' in target
        ? await this.db.query(
            `UPDATE notifications SET read_at = now() WHERE channel = 'inapp' AND recipient = $1 AND read_at IS NULL`,
            [email],
          )
        : await this.db.query(
            `UPDATE notifications SET read_at = now() WHERE channel = 'inapp' AND recipient = $1 AND read_at IS NULL AND id = ANY($2::uuid[])`,
            [email, target.ids],
          );
    return res.rowCount ?? 0;
  }
}
