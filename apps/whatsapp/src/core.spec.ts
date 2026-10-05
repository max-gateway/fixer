import { describe, expect, it, vi } from 'vitest';
import { TokenBucket } from './dispatch/rate-limiter.js';
import { backoffMs } from './dispatch/dispatcher.service.js';
import { normalizePhone } from './phone.js';
import { classifyMetaError } from './provider/errors.js';
import { CloudApiProvider } from './provider/cloud-api.provider.js';
import { ProviderError } from './provider/provider.js';
import { prepareVariables } from './templates/templates.js';
import { optIntent } from './webhooks/payload.js';
import { sign, verifySignature } from './webhooks/signature.js';

describe('normalizePhone', () => {
  it.each([
    ['(11) 98765-4321', '5511987654321'],
    ['+55 11 98765-4321', '5511987654321'],
    ['5511987654321', '5511987654321'],
    ['11987654321', '5511987654321'],
  ])('%s -> %s', (raw, out) => expect(normalizePhone(raw)).toBe(out));

  it.each([
    '123',
    '(11) 3456-7890x1',
    '5511887654321',
    '(05) 98765-4321',
    '+1 415 555 2671',
  ])('rejeita %s', (raw) => expect(normalizePhone(raw)).toBeNull());
});

describe('prepareVariables', () => {
  it('normaliza espaços e quebras de linha (a Meta rejeita)', () => {
    expect(
      prepareVariables('os_portal_link', [
        '12',
        'Oficina\n  do   Zé',
        'https://x.com/o/abc',
      ]),
    ).toEqual(['12', 'Oficina do Zé', 'https://x.com/o/abc']);
  });
  it('exige a quantidade certa e valores não vazios', () => {
    expect(() => prepareVariables('os_portal_link', ['1'])).toThrow(/espera 3/);
    expect(() => prepareVariables('os_portal_link', ['1', ' ', 'x'])).toThrow(
      /vazia/,
    );
    expect(() => prepareVariables('os_portal_link', ['1', 2, 'x'])).toThrow(
      /texto/,
    );
  });
});

describe('verifySignature', () => {
  const body = Buffer.from('{"object":"whatsapp_business_account"}');
  it('aceita a assinatura correta e recusa adulteração, ausência e secret errado', () => {
    expect(verifySignature(body, sign(body, 's3cret'), 's3cret')).toBe(true);
    expect(
      verifySignature(Buffer.from('{"x":1}'), sign(body, 's3cret'), 's3cret'),
    ).toBe(false);
    expect(verifySignature(body, sign(body, 'outro'), 's3cret')).toBe(false);
    expect(verifySignature(body, undefined, 's3cret')).toBe(false);
    expect(verifySignature(undefined, sign(body, 's3cret'), 's3cret')).toBe(
      false,
    );
    expect(verifySignature(body, 'sha256=zz', 's3cret')).toBe(false);
    expect(verifySignature(body, sign(body, ''), '')).toBe(false); // sem secret configurado, nada passa
  });
});

describe('optIntent', () => {
  it('só vale a mensagem inteira', () => {
    expect(optIntent('PARAR')).toBe('OPTED_OUT');
    expect(optIntent(' parar! ')).toBe('OPTED_OUT');
    expect(optIntent('Não quero receber')).toBe('OPTED_OUT');
    expect(optIntent('voltar')).toBe('OPTED_IN');
    expect(optIntent('não pare de me avisar')).toBeNull();
    expect(optIntent(undefined)).toBeNull();
  });
});

describe('classifyMetaError', () => {
  it('erros de mensagem/destinatário são permanentes', () => {
    for (const code of [131026, 131047, 132001, 132000])
      expect(classifyMetaError(400, code).retryable).toBe(false);
  });
  it('rate limit, 5xx e rede são transitórios', () => {
    expect(classifyMetaError(429, 130429).retryable).toBe(true);
    expect(classifyMetaError(400, 131056).retryable).toBe(true);
    expect(classifyMetaError(503, undefined).retryable).toBe(true);
  });
  it('token inválido é transitório (credencial se corrige sem reenfileirar) e marcado como auth', () => {
    expect(classifyMetaError(401, 190)).toEqual({
      retryable: true,
      auth: true,
    });
  });
  it('4xx desconhecido não é repetido', () => {
    expect(classifyMetaError(400, 999999).retryable).toBe(false);
  });
});

describe('CloudApiProvider', () => {
  const cfg = {
    accessToken: 'tok',
    phoneNumberId: '123',
    appSecret: 's',
    verifyToken: 'v',
    graphVersion: 'v21.0',
    maxMps: 20,
  };
  const json = (
    status: number,
    body: unknown,
    headers: Record<string, string> = {},
  ) => new Response(JSON.stringify(body), { status, headers });

  it('envia template com parâmetros e devolve o wamid', async () => {
    const fetchFn = vi
      .fn()
      .mockResolvedValue(json(200, { messages: [{ id: 'wamid.X' }] }));
    const p = new CloudApiProvider(cfg, fetchFn as never);
    const r = await p.send({
      id: 'm1',
      to: '5511987654321',
      kind: 'TEMPLATE',
      template: 'os_portal_link',
      language: 'pt_BR',
      variables: ['1', 'Of', 'u'],
    });
    expect(r.wamid).toBe('wamid.X');
    const [url, init] = fetchFn.mock.calls[0];
    expect(url).toBe('https://graph.facebook.com/v21.0/123/messages');
    expect(init.headers.authorization).toBe('Bearer tok');
    expect(JSON.parse(init.body)).toMatchObject({
      to: '5511987654321',
      type: 'template',
      template: {
        name: 'os_portal_link',
        language: { code: 'pt_BR' },
        components: [
          {
            type: 'body',
            parameters: [
              { type: 'text', text: '1' },
              { type: 'text', text: 'Of' },
              { type: 'text', text: 'u' },
            ],
          },
        ],
      },
    });
  });

  it('mapeia erro permanente, transitório e Retry-After; o token não vaza na mensagem', async () => {
    const run = (res: Response) =>
      new CloudApiProvider(cfg, vi.fn().mockResolvedValue(res) as never)
        .send({ id: 'm', to: '5511987654321', kind: 'TEXT', body: 'oi' })
        .catch((e: ProviderError) => e);

    const permanent = await run(
      json(400, { error: { code: 131026, message: 'Message undeliverable' } }),
    );
    expect(permanent).toMatchObject({ retryable: false, code: '131026' });

    const limited = await run(
      json(
        429,
        { error: { code: 130429, message: 'rate' } },
        { 'retry-after': '7' },
      ),
    );
    expect(limited).toMatchObject({ retryable: true, retryAfterMs: 7000 });

    expect((permanent as Error).message).not.toContain('tok');
  });

  it('falha de rede é transitória', async () => {
    const p = new CloudApiProvider(
      cfg,
      vi.fn().mockRejectedValue(new Error('boom')) as never,
    );
    await expect(
      p.send({ id: 'm', to: '5511987654321', kind: 'TEXT', body: 'x' }),
    ).rejects.toMatchObject({ retryable: true });
  });
});

describe('TokenBucket', () => {
  it('limita ao ritmo configurado e repõe com o tempo', () => {
    let t = 0;
    const b = new TokenBucket(10, () => t);
    expect(b.take(50)).toBe(10);
    expect(b.take(50)).toBe(0);
    t += 500;
    expect(b.take(50)).toBe(5);
    b.refund(3);
    t += 0;
    expect(b.take(50)).toBe(3);
  });
});

describe('backoffMs', () => {
  it('cresce exponencialmente, tem teto e jitter entre 50% e 100%', () => {
    expect(backoffMs(1, 30_000, 3_600_000, () => 1)).toBe(30_000);
    expect(backoffMs(1, 30_000, 3_600_000, () => 0)).toBe(15_000);
    expect(backoffMs(3, 30_000, 3_600_000, () => 1)).toBe(120_000);
    expect(backoffMs(20, 30_000, 3_600_000, () => 1)).toBe(3_600_000);
  });
});
