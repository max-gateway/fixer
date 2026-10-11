import { Agent, request } from 'node:https';
import { parseDistResponse, type DistResult } from '../parser/dist-response.parser.js';
import { parseEnvEventoResponse, type EnvEventoResponse } from '../parser/event-response.parser.js';
import { XmlError } from '../parser/xml.js';
import {
  type CredentialMaterial,
  SefazNotConfiguredError,
  SefazTransportError,
  type DfeSource,
  type DistributeParams,
  type ManifestParams,
} from './dfe-source.js';
import { buildCienciaEvent, buildEnvEvento, eventId, EVENT_CIENCIA, signEnvEvento } from './event-xml.js';
import type { SefazConfig } from './sefaz.config.js';

const DIST_NS = 'http://www.portalfiscal.inf.br/nfe/wsdl/NFeDistribuicaoDFe';
const EVENT_NS = 'http://www.portalfiscal.inf.br/nfe/wsdl/NFeRecepcaoEvento4';
const MAX_RESPONSE_BYTES = 8 * 1024 * 1024;

const tpAmb = (m: CredentialMaterial): 1 | 2 => (m.environment === 'PRODUCTION' ? 1 : 2);

/** Pedido `distNSU` no formato do exemplo 1 da NT 2014.002 (item 5), com o NSU em 15 dígitos. */
export function buildDistNsuEnvelope(env: { tpAmb: 1 | 2; cnpj: string; ufCode?: number | null; ultNsu: bigint }): string {
  const nsu = env.ultNsu.toString().padStart(15, '0');
  const uf = env.ufCode ? `<cUFAutor>${env.ufCode}</cUFAutor>` : '';
  return (
    '<?xml version="1.0" encoding="UTF-8"?>' +
    '<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/" xmlns:xsd="http://www.w3.org/2001/XMLSchema" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">' +
    '<soap:Body>' +
    `<nfeDistDFeInteresse xmlns="${DIST_NS}"><nfeDadosMsg xmlns="${DIST_NS}">` +
    '<distDFeInt xmlns="http://www.portalfiscal.inf.br/nfe" versao="1.01">' +
    `<tpAmb>${env.tpAmb}</tpAmb>${uf}<CNPJ>${env.cnpj}</CNPJ>` +
    `<distNSU><ultNSU>${nsu}</ultNSU></distNSU>` +
    '</distDFeInt></nfeDadosMsg></nfeDistDFeInteresse></soap:Body></soap:Envelope>'
  );
}

/**
 * Envelope SOAP do serviço de eventos. A NT 2020.001 define o método `nfeRecepcaoEvento` e o conteúdo
 * (`envEvento`), mas não a versão do SOAP; 1.2 é o padrão dos serviços 4.00 e `DFE_EVENT_SOAP=1.1`
 * troca, caso o WSDL do ambiente peça outra (docs/specs/nfe-import.md §14.3).
 */
export function buildEventSoap(signedEnvEvento: string, version: '1.1' | '1.2'): { body: string; contentType: string; soapAction?: string } {
  const action = `${EVENT_NS}/nfeRecepcaoEvento`;
  if (version === '1.2') {
    return {
      body:
        '<?xml version="1.0" encoding="utf-8"?><soap12:Envelope xmlns:soap12="http://www.w3.org/2003/05/soap-envelope"><soap12:Body>' +
        `<nfeDadosMsg xmlns="${EVENT_NS}">${signedEnvEvento}</nfeDadosMsg></soap12:Body></soap12:Envelope>`,
      contentType: `application/soap+xml; charset=utf-8; action="${action}"`,
    };
  }
  return {
    body:
      '<?xml version="1.0" encoding="utf-8"?><soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/"><soap:Body>' +
      `<nfeRecepcaoEvento xmlns="${EVENT_NS}"><nfeDadosMsg xmlns="${EVENT_NS}">${signedEnvEvento}</nfeDadosMsg></nfeRecepcaoEvento>` +
      '</soap:Body></soap:Envelope>',
    contentType: 'text/xml; charset=utf-8',
    soapAction: `"${action}"`,
  };
}

/**
 * Cliente da SEFAZ: SOAP sobre TLS mútuo com o certificado A1 da empresa (distribuição e manifestação).
 * O material do certificado é usado só para montar o `Agent` de cada chamada e descartado em seguida.
 */
export class SefazDfeClient implements DfeSource {
  constructor(private readonly config: SefazConfig) {}

  async distribute(material: CredentialMaterial, params: DistributeParams): Promise<DistResult> {
    const url = this.config.distUrl[material.environment];
    if (!url) {
      throw new SefazNotConfiguredError(`URL do NFeDistribuicaoDFe não configurada (DFE_DIST_URL_${material.environment})`);
    }
    const body = buildDistNsuEnvelope({ tpAmb: tpAmb(material), cnpj: params.cnpj, ufCode: params.ufCode, ultNsu: params.ultNsu });
    const response = await this.post(url, body, material, {
      'Content-Type': 'text/xml; charset=utf-8',
      SOAPAction: `"${DIST_NS}/nfeDistDFeInteresse"`,
    });
    return this.parse(response, parseDistResponse);
  }

  async manifest(material: CredentialMaterial, params: ManifestParams): Promise<EnvEventoResponse> {
    const url = this.config.eventUrl[material.environment];
    if (!url) {
      throw new SefazNotConfiguredError(`URL do NFeRecepcaoEvento não configurada (DFE_EVENT_URL_${material.environment})`);
    }
    const events = params.accessKeys.map((accessKey) =>
      buildCienciaEvent({ tpAmb: tpAmb(material), cnpj: params.cnpj, accessKey, now: params.now }),
    );
    const idLote = String(params.now.getTime()); // só controle do autor; a SEFAZ não o usa
    const signed = signEnvEvento(
      buildEnvEvento(idLote, events),
      material.keyPem,
      material.certPem,
      params.accessKeys.map((k) => eventId(EVENT_CIENCIA, k)),
    );
    const soap = buildEventSoap(signed, this.config.eventSoap);
    const response = await this.post(url, soap.body, material, {
      'Content-Type': soap.contentType,
      ...(soap.soapAction ? { SOAPAction: soap.soapAction } : {}),
    });
    return this.parse(response, parseEnvEventoResponse);
  }

  private parse<T>(response: { status: number; body: string }, parser: (xml: string) => T): T {
    if (response.status !== 200) {
      throw new SefazTransportError(`SEFAZ respondeu HTTP ${response.status}`, response.status);
    }
    try {
      return parser(response.body);
    } catch (err) {
      if (err instanceof XmlError) throw new SefazTransportError(`Resposta ilegível da SEFAZ: ${err.message}`);
      throw err;
    }
  }

  private post(
    urlString: string,
    body: string,
    material: CredentialMaterial,
    headers: Record<string, string>,
  ): Promise<{ status: number; body: string }> {
    const url = new URL(urlString);
    if (url.protocol !== 'https:') throw new SefazNotConfiguredError('A URL da SEFAZ precisa ser https');
    // Certificado do titular + cadeia: a SEFAZ valida a cadeia ICP-Brasil do cliente.
    const agent = new Agent({
      key: material.keyPem,
      cert: [material.certPem, ...material.chainPem].join('\n'),
      ca: this.config.caPem,
      keepAlive: false,
      minVersion: 'TLSv1.2',
    });

    return new Promise((resolve, reject) => {
      const req = request(
        url,
        {
          method: 'POST',
          agent,
          timeout: this.config.requestTimeoutMs,
          headers: { ...headers, 'Content-Length': Buffer.byteLength(body) },
        },
        (res) => {
          const chunks: Buffer[] = [];
          let size = 0;
          res.on('data', (chunk: Buffer) => {
            size += chunk.length;
            if (size > MAX_RESPONSE_BYTES) {
              req.destroy(new SefazTransportError('Resposta da SEFAZ grande demais'));
              return;
            }
            chunks.push(chunk);
          });
          res.on('end', () => {
            agent.destroy();
            resolve({ status: res.statusCode ?? 0, body: Buffer.concat(chunks).toString('utf8') });
          });
        },
      );
      const fail = (err: Error) => {
        agent.destroy();
        reject(err instanceof SefazTransportError ? err : new SefazTransportError(`Falha de rede/TLS: ${err.message}`));
      };
      req.on('timeout', () => req.destroy(new Error('timeout')));
      req.on('error', fail);
      req.end(body);
    });
  }
}
