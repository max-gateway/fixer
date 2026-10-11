import { describe, expect, it } from 'vitest';
import { deliveryBackoffMs } from './relay.service.js';
import { signWebhook, verifyWebhook } from './signature.js';
import { assertSafeWebhook, isPrivateIp, UnsafeTargetError } from './ssrf.js';

describe('assinatura do webhook', () => {
  const body = '{"v":1}';
  const now = 1_800_000_000;

  it('valida a assinatura própria e rejeita corpo adulterado ou segredo errado', () => {
    const sig = signWebhook('segredo', body, now);
    expect(verifyWebhook('segredo', body, sig, now)).toBe(true);
    expect(verifyWebhook('segredo', body + ' ', sig, now)).toBe(false);
    expect(verifyWebhook('outro', body, sig, now)).toBe(false);
  });

  it('rejeita replay (timestamp fora da tolerância) e cabeçalho malformado', () => {
    const sig = signWebhook('segredo', body, now);
    expect(verifyWebhook('segredo', body, sig, now + 299)).toBe(true);
    expect(verifyWebhook('segredo', body, sig, now + 301)).toBe(false);
    expect(verifyWebhook('segredo', body, sig, now - 301)).toBe(false);
    for (const bad of ['', 'v1=abc', `t=${now}`, `t=${now},v1=zz`, `t=${now},v1=${'a'.repeat(63)}`]) {
      expect(verifyWebhook('segredo', body, bad, now)).toBe(false);
    }
  });
});

describe('proteção contra SSRF', () => {
  it.each(['10.0.0.1', '127.0.0.1', '169.254.169.254', '172.16.5.4', '172.31.255.255', '192.168.1.1', '100.64.0.1', '0.0.0.0', '224.0.0.1', '::1', 'fd00::1', 'fe80::1', '::ffff:10.0.0.1'])(
    '%s é interno',
    (ip) => expect(isPrivateIp(ip)).toBe(true),
  );
  it.each(['8.8.8.8', '172.32.0.1', '200.201.202.203', '2606:4700:4700::1111'])('%s é público', (ip) => expect(isPrivateIp(ip)).toBe(false));

  it('recusa http, credenciais na URL, IP interno e metadata de nuvem', async () => {
    for (const url of ['http://example.com/h', 'https://u:p@example.com/h', 'https://127.0.0.1/h', 'https://169.254.169.254/latest', 'https://[::1]/h', 'ftp://example.com', 'não é url']) {
      await expect(assertSafeWebhook(url, false), url).rejects.toBeInstanceOf(UnsafeTargetError);
    }
  });

  it('aceita https público e, só em dev, http/loopback', async () => {
    await expect(assertSafeWebhook('https://8.8.8.8/hook', false)).resolves.toMatchObject({ address: '8.8.8.8' });
    await expect(assertSafeWebhook('http://127.0.0.1:9/h', true)).resolves.toMatchObject({ address: '127.0.0.1' });
  });
});

describe('backoff da entrega', () => {
  it('cresce de 1 min até o teto de 6 h, com jitter de ±20%', () => {
    expect(deliveryBackoffMs(1, () => 0.5)).toBe(60_000);
    expect(deliveryBackoffMs(3, () => 0.5)).toBe(240_000);
    expect(deliveryBackoffMs(24, () => 0.5)).toBe(6 * 3_600_000);
    expect(deliveryBackoffMs(2, () => 0)).toBe(96_000);
    expect(deliveryBackoffMs(2, () => 1)).toBe(144_000);
  });
});
