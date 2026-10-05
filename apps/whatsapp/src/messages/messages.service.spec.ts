import { describe, expect, it, vi } from 'vitest';
import {
  ConflictException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { loadConfig } from '../config/config.js';
import { MessagesService } from './messages.service.js';

const cfg = loadConfig({
  WHATSAPP_DATABASE_URL: 'x',
  WHATSAPP_API_KEYS: 'k'.repeat(20),
} as never);
const tmpl = {
  type: 'template' as const,
  to: '(11) 98765-4321',
  template: 'os_portal_link' as const,
  variables: ['7', 'Oficina', 'https://p/o/t'],
  reference: { orderId: 'o1' },
};

/** Banco falso: responde por trecho do SQL. */
function setup(
  opts: {
    contact?: { opt_status: string; last_inbound_at: Date | null };
    inserted?: boolean;
    existingHash?: string;
  } = {},
) {
  const row = {
    id: 'id1',
    request_hash: 'h',
    status: 'QUEUED',
    to_phone: '5511987654321',
    kind: 'TEMPLATE',
    template: 'os_portal_link',
    reference: {},
    attempts: 0,
  };
  const query = vi.fn(async (sql: string, params: unknown[] = []) => {
    if (sql.includes('FROM contacts'))
      return { rows: opts.contact ? [opts.contact] : [] };
    if (sql.startsWith('INSERT INTO messages')) {
      return {
        rows:
          opts.inserted === false
            ? []
            : [{ ...row, status: params[9], request_hash: params[1] }],
      };
    }
    if (sql.includes('WHERE idempotency_key'))
      return { rows: [{ ...row, request_hash: opts.existingHash ?? 'h' }] };
    return { rows: [] };
  });
  return { query, service: new MessagesService({ query } as never, cfg) };
}

describe('MessagesService.enqueue', () => {
  it('enfileira template com telefone normalizado e não expõe o número inteiro', async () => {
    const { service, query } = setup();
    const out = await service.enqueue('key-12345678', tmpl);
    expect(out).toMatchObject({
      status: 'QUEUED',
      duplicate: false,
      to: '***4321',
    });
    const insert = query.mock.calls.find(([s]) =>
      s.startsWith('INSERT INTO messages'),
    )!;
    expect(insert[1]).toEqual(
      expect.arrayContaining([
        '5511987654321',
        'TEMPLATE',
        'os_portal_link',
        'pt_BR',
      ]),
    );
  });

  it('recusa telefone inválido e variáveis erradas com 422', async () => {
    const { service } = setup();
    await expect(
      service.enqueue('key-12345678', { ...tmpl, to: '123' }),
    ).rejects.toBeInstanceOf(UnprocessableEntityException);
    await expect(
      service.enqueue('key-12345678', { ...tmpl, variables: ['só uma'] }),
    ).rejects.toBeInstanceOf(UnprocessableEntityException);
  });

  it('mesma Idempotency-Key e mesmo conteúdo devolve a mensagem existente (duplicate)', async () => {
    const first = setup();
    await first.service.enqueue('key-12345678', tmpl);
    const hash = (
      first.query.mock.calls.find(([s]) =>
        s.startsWith('INSERT INTO messages'),
      )![1] as string[]
    )[1];

    const { service } = setup({ inserted: false, existingHash: hash });
    expect(await service.enqueue('key-12345678', tmpl)).toMatchObject({
      duplicate: true,
      id: 'id1',
    });
  });

  it('mesma chave com conteúdo diferente é conflito', async () => {
    const { service } = setup({ inserted: false, existingHash: 'outro-hash' });
    await expect(service.enqueue('key-12345678', tmpl)).rejects.toBeInstanceOf(
      ConflictException,
    );
  });

  it('cliente em opt-out: registra como SUPPRESSED, nunca QUEUED', async () => {
    const { service } = setup({
      contact: { opt_status: 'OPTED_OUT', last_inbound_at: null },
    });
    expect(await service.enqueue('key-12345678', tmpl)).toMatchObject({
      status: 'SUPPRESSED',
    });
  });

  it('texto livre só dentro da janela de 24h', async () => {
    const text = {
      type: 'text' as const,
      to: '11987654321',
      text: 'Oi!',
      reference: {},
    };
    await expect(setup().service.enqueue('key-12345678', text)).rejects.toThrow(
      /24h/,
    );
    const old = new Date(Date.now() - 25 * 3_600_000);
    await expect(
      setup({
        contact: { opt_status: 'OPTED_IN', last_inbound_at: old },
      }).service.enqueue('key-12345678', text),
    ).rejects.toThrow(/24h/);
    const recent = new Date(Date.now() - 3_600_000);
    await expect(
      setup({
        contact: { opt_status: 'OPTED_IN', last_inbound_at: recent },
      }).service.enqueue('key-12345678', text),
    ).resolves.toMatchObject({ status: 'QUEUED' });
  });
});
