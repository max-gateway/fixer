import { Injectable, Logger } from '@nestjs/common';
import { readFileSync } from 'node:fs';
import { Agent, request } from 'node:https';
import { rootCertificates } from 'node:tls';
import type { CredentialMaterial } from '../fiscal-inbound/credentials/credential.service.js';

// Parâmetros municipais do Sistema Nacional NFS-e (docs/specs/nfse-parametros-municipais.md): alíquota de ISS que a
// prefeitura cadastrou para cada serviço. TLS mútuo com o e-CNPJ da oficina; só leitura de dado público do município.
//
// Rotas (ADN, "parametrizacao"): GET /{ibge}/convenio e GET /{ibge}/{cTribNac}/{AAAA-MM-DD}/aliquota. A resposta usa
// PascalCase nas alíquotas: { aliquotas: { "140101": [{ Aliq: 5, DtIni, DtFim }] }, mensagem }. 400/404 vêm com corpo e
// `mensagem` (município sem convênio, serviço sem parâmetro): não são erro de transporte.

const BASE: Record<CredentialMaterial['environment'], string> = {
  PRODUCTION: 'https://adn.nfse.gov.br/parametrizacao',
  HOMOLOGATION: 'https://adn.producaorestrita.nfse.gov.br/parametrizacao',
};
const TIMEOUT_MS = 10_000;
const MAX_BYTES = 1_000_000;

export interface NfseAliquota {
  /** % (2,5 = 2,5%). */
  pct: number;
  from: string;
  to: string | null;
}
export interface NfseAliquotaResult {
  /** Alíquota vigente na data pedida; null quando o município não parametrizou o serviço. */
  current: NfseAliquota | null;
  /** Texto da prefeitura/ADN quando não há dado (ex.: "Município não conveniado"). */
  message: string | null;
}

export class NfseParametrosError extends Error {}

interface RawAliquota {
  Aliq?: number | null;
  DtIni?: string | null;
  DtFim?: string | null;
}

/** Escolhe, no histórico devolvido, a alíquota vigente em `asOf` (AAAA-MM-DD). */
export function pickAliquota(body: unknown, cTribNac: string, asOf: string): NfseAliquotaResult {
  const b = (body ?? {}) as { aliquotas?: Record<string, RawAliquota[] | null> | null; mensagem?: string | null };
  const list = b.aliquotas?.[cTribNac] ?? Object.values(b.aliquotas ?? {}).find((l) => l?.length) ?? [];
  const day = (s: string | null | undefined) => (s ? s.slice(0, 10) : null);
  const current =
    (list ?? [])
      .filter((a) => typeof a.Aliq === 'number' && day(a.DtIni) !== null && day(a.DtIni)! <= asOf && (!a.DtFim || day(a.DtFim)! >= asOf))
      .sort((a, b) => day(b.DtIni)!.localeCompare(day(a.DtIni)!))
      .map((a) => ({ pct: a.Aliq!, from: day(a.DtIni)!, to: day(a.DtFim) }))[0] ?? null;
  return { current, message: b.mensagem?.trim() || null };
}

/** cTribNac (6 dígitos) do primeiro desdobramento do item da LC 116: "14.01" → "140101". */
export const nationalServiceCode = (lc116Item: string) => `${lc116Item.replace(/\D/g, '').padStart(4, '0')}01`;

@Injectable()
export class NfseParametrosClient {
  private readonly logger = new Logger(NfseParametrosClient.name);
  private readonly ca: string[] = (() => {
    // Os servidores do governo nem sempre estão no repositório do Node: soma a cadeia ICP-Brasil da sincronização fiscal.
    const extra = process.env.FISCAL_CA_BUNDLE ? [readFileSync(process.env.FISCAL_CA_BUNDLE, 'utf8')] : [];
    return [...rootCertificates, ...extra];
  })();

  /** Desligado por `NFSE_PARAMETROS_ENABLED=false` (testes e ambientes sem saída para o governo). */
  get enabled() {
    return process.env.NFSE_PARAMETROS_ENABLED !== 'false';
  }

  async aliquota(material: CredentialMaterial, ibge: string, cTribNac: string, asOf: string): Promise<NfseAliquotaResult> {
    const base = process.env.NFSE_PARAMETROS_URL || BASE[material.environment];
    const body = await this.get(material, `${base}/${encodeURIComponent(ibge)}/${encodeURIComponent(cTribNac)}/${asOf}/aliquota`);
    return pickAliquota(body, cTribNac, asOf);
  }

  private get(material: CredentialMaterial, url: string): Promise<unknown> {
    const agent = new Agent({ key: material.keyPem, cert: [material.certPem, ...material.chainPem].join('\n'), ca: this.ca, keepAlive: false, minVersion: 'TLSv1.2' });
    return new Promise((resolve, reject) => {
      const req = request(url, { method: 'GET', agent, timeout: TIMEOUT_MS, headers: { Accept: 'application/json' } }, (res) => {
        const chunks: Buffer[] = [];
        let size = 0;
        res.on('data', (c: Buffer) => {
          size += c.length;
          if (size > MAX_BYTES) req.destroy(new NfseParametrosError('Resposta grande demais'));
          else chunks.push(c);
        });
        res.on('end', () => {
          agent.destroy();
          const status = res.statusCode ?? 0;
          const text = Buffer.concat(chunks).toString('utf8');
          let json: unknown = null;
          try {
            json = text ? JSON.parse(text) : null;
          } catch {
            /* corpo não JSON: tratado abaixo */
          }
          if (status === 200 || ((status === 400 || status === 404) && json)) resolve(json);
          else {
            this.logger.warn(`Parâmetros municipais responderam HTTP ${status} em ${url}`);
            reject(new NfseParametrosError(`A NFS-e Nacional respondeu HTTP ${status}`));
          }
        });
      });
      req.on('timeout', () => req.destroy(new NfseParametrosError('tempo esgotado')));
      req.on('error', (err) => {
        agent.destroy();
        reject(err instanceof NfseParametrosError ? err : new NfseParametrosError(`Falha de rede/TLS: ${err.message}`));
      });
      req.end();
    });
  }
}
