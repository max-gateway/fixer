import { createServer, type Server } from 'node:https';
import type { AddressInfo } from 'node:net';
import forge from 'node-forge';
import { newRsaKeys } from './make-pfx.js';

/** Certificado de servidor autoassinado para 127.0.0.1, usado como "SEFAZ" local e como CA do cliente. */
export function makeServerCert(): { keyPem: string; certPem: string } {
  const keys = newRsaKeys();
  const cert = forge.pki.createCertificate();
  cert.publicKey = keys.publicKey;
  cert.serialNumber = '02';
  cert.validity.notBefore = new Date(Date.now() - 86_400_000);
  cert.validity.notAfter = new Date(Date.now() + 86_400_000);
  const attrs = [{ name: 'commonName', value: 'sefaz-fake.local' }];
  cert.setSubject(attrs);
  cert.setIssuer(attrs);
  cert.setExtensions([
    { name: 'basicConstraints', cA: true },
    { name: 'subjectAltName', altNames: [{ type: 7, ip: '127.0.0.1' }] },
  ]);
  cert.sign(keys.privateKey, forge.md.sha256.create());
  return { keyPem: forge.pki.privateKeyToPem(keys.privateKey), certPem: forge.pki.certificateToPem(cert) };
}

export interface SeenRequest {
  method?: string;
  headers: Record<string, string | string[] | undefined>;
  body: string;
  /** CN do certificado de cliente apresentado no handshake (mTLS), ou null se não apresentou. */
  clientCn: string | null;
}

/** Sobe um servidor HTTPS que EXIGE certificado de cliente e devolve o que a `handler` mandar. */
export async function startFakeSefaz(
  server: { keyPem: string; certPem: string },
  handler: (req: SeenRequest) => { status: number; body: string } | Promise<{ status: number; body: string }>,
): Promise<{ url: string; seen: SeenRequest[]; close: () => Promise<void> }> {
  const seen: SeenRequest[] = [];
  const srv: Server = createServer(
    { key: server.keyPem, cert: server.certPem, requestCert: true, rejectUnauthorized: false },
    (req, res) => {
      const chunks: Buffer[] = [];
      req.on('data', (c: Buffer) => chunks.push(c));
      req.on('end', async () => {
        const peer = (req.socket as unknown as { getPeerCertificate(): { subject?: { CN?: string } } }).getPeerCertificate();
        const entry: SeenRequest = {
          method: req.method,
          headers: req.headers,
          body: Buffer.concat(chunks).toString('utf8'),
          clientCn: peer?.subject?.CN ?? null,
        };
        seen.push(entry);
        const out = await handler(entry);
        res.writeHead(out.status, { 'Content-Type': 'text/xml; charset=utf-8' });
        res.end(out.body);
      });
    },
  );
  await new Promise<void>((resolve) => srv.listen(0, '127.0.0.1', resolve));
  const { port } = srv.address() as AddressInfo;
  return {
    url: `https://127.0.0.1:${port}/NFeDistribuicaoDFe/NFeDistribuicaoDFe.asmx`,
    seen,
    close: () => new Promise((resolve) => srv.close(() => resolve())),
  };
}
