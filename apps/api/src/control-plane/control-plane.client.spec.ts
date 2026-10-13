import { createServer, type Server } from 'node:http';
import { exportJWK, generateKeyPair, SignJWT } from 'jose';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ControlPlaneClient } from './control-plane.client.js';
import type { ControlPlaneConfig } from './control-plane.config.js';

const ORG = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const ISS = 'max-gateway-control-plane';

describe('ControlPlaneClient (snapshot assinado)', () => {
  let server: Server;
  let url: string;
  let key: CryptoKey;
  let kid = 'k1';
  let behaviour: 'ok' | 'wrong-iss' | 'wrong-sub' | 'wrong-product' | 'forged' | '404' | '500' = 'ok';
  let calls: { path: string; apiKey: string | undefined }[] = [];

  const sign = (over: Record<string, unknown> = {}, signKey: CryptoKey = key, iss = ISS) =>
    new SignJWT({ product: 'fixer', status: 'active', mode: 'full', ver: 3, trialEndsAt: null, readonlyUntil: null, ent: { users: { kind: 'limit', value: 5 } }, ...over })
      .setProtectedHeader({ alg: 'EdDSA', kid })
      .setSubject(ORG)
      .setIssuer(iss)
      .setExpirationTime('15m')
      .sign(signKey);

  beforeAll(async () => {
    const pair = await generateKeyPair('EdDSA', { crv: 'Ed25519' });
    key = pair.privateKey;
    const jwk = { ...(await exportJWK(pair.publicKey)), kid, use: 'sig', alg: 'EdDSA' };
    server = createServer(async (req, res) => {
      calls.push({ path: req.url!, apiKey: req.headers['x-api-key'] as string | undefined });
      const send = (s: number, b: unknown) => (res.writeHead(s, { 'content-type': 'application/json' }), res.end(JSON.stringify(b)));
      if (req.url === '/.well-known/jwks.json') return send(200, { keys: [jwk] });
      if (behaviour === '404') return send(404, { error: { code: 'subscription_not_found' } });
      if (behaviour === '500') return send(500, {});
      if (behaviour === 'wrong-iss') return send(200, { token: await sign({}, key, 'outro-emissor') });
      if (behaviour === 'wrong-product') return send(200, { token: await sign({ product: 'rocket' }) });
      if (behaviour === 'wrong-sub') return send(200, { token: await new SignJWT({ product: 'fixer' }).setProtectedHeader({ alg: 'EdDSA', kid }).setSubject('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb').setIssuer(ISS).setExpirationTime('5m').sign(key) });
      if (behaviour === 'forged') {
        const other = await generateKeyPair('EdDSA', { crv: 'Ed25519' });
        return send(200, { token: await sign({ mode: 'full' }, other.privateKey) });
      }
      return send(200, { token: await sign() });
    });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    url = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  });
  afterAll(() => new Promise<void>((r) => server.close(() => r())));

  const client = () => new ControlPlaneClient({ url, apiKey: 'cp_chave', product: 'fixer', issuer: ISS } as ControlPlaneConfig);

  it('valida o snapshot pelo JWKS e devolve as claims', async () => {
    behaviour = 'ok';
    calls = [];
    const claims = await client().snapshot(ORG);
    expect(claims).toMatchObject({ sub: ORG, product: 'fixer', mode: 'full', ver: 3, status: 'active' });
    expect(claims!.ent.users).toEqual({ kind: 'limit', value: 5 });
    expect(calls[0]).toEqual({ path: `/v1/orgs/${ORG}/entitlements?product=fixer`, apiKey: 'cp_chave' });
  });

  it('organização sem assinatura neste produto (404) vira null', async () => {
    behaviour = '404';
    expect(await client().snapshot(ORG)).toBeNull();
  });

  it('recusa token de outro emissor, de outro produto, de outra organização ou assinado por outra chave', async () => {
    for (const b of ['wrong-iss', 'wrong-product', 'wrong-sub', 'forged'] as const) {
      behaviour = b;
      await expect(client().snapshot(ORG), b).rejects.toThrow();
    }
  });

  it('erro do control plane lança (o evento é reprocessado depois)', async () => {
    behaviour = '500';
    await expect(client().snapshot(ORG)).rejects.toThrow(/500/);
  });
});
