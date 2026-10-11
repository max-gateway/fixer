import { Inject, Injectable } from '@nestjs/common';
import { GATEWAY_CONFIG, type GatewayConfig } from './gateway.config.js';

/** Erro do gateway já traduzido: `status` HTTP e a mensagem do problem+json (segura para mostrar ao usuário). */
export class GatewayError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

export interface GatewayDocument {
  nsu: string;
  schema: string;
  accessKey: string | null;
  xml: string;
  receivedAt: string;
}

export interface GatewayDocumentsPage {
  items: GatewayDocument[];
  nextCursor: string | null;
  lastNsu: string;
}

export interface GatewayRegistration {
  legalName?: string;
  ufCode?: number;
  credential?: { pfxBase64: string; password: string; environment: 'PRODUCTION' | 'HOMOLOGATION' };
  enabled?: boolean;
  autoManifest?: boolean;
  acknowledgeManifestDuty?: boolean;
  resumeFromNsu?: string;
}

export interface GatewayCompanyStatus {
  /** Só na resposta do cadastro: o que o gateway de fato alterou. */
  changed?: { credential: boolean; resumed: boolean };
  cnpj: string;
  credential: {
    environment: 'PRODUCTION' | 'HOMOLOGATION';
    subject: string;
    cert_cnpj: string;
    not_before: string;
    not_after: string;
    status: 'ACTIVE' | 'DISABLED' | 'EXPIRED';
    enabled: boolean;
    auto_manifest: boolean;
  } | null;
  sync: {
    last_nsu: string;
    max_nsu: string;
    next_poll_at: string;
    last_status_code: number | null;
    last_error: string | null;
    last_run_at: string | null;
    last_success_at: string | null;
    consecutive_failures: number;
  } | null;
}

/** Cliente HTTP do `dfe-gateway`. Cada chamada leva o usuário final em `X-Actor` (só para a auditoria do gateway). */
@Injectable()
export class GatewayClient {
  constructor(@Inject(GATEWAY_CONFIG) private readonly cfg: GatewayConfig) {}

  inspect(pfxBase64: string, password: string) {
    return this.call<{ subject: string; certCnpj: string; notBefore: string; notAfter: string }>('POST', '/v1/credential/inspect', { pfxBase64, password });
  }

  /**
   * Cadastro único e idempotente (PUT /registration): empresa + certificado + flags + retomada do NSU. As regras
   * (instalar só se mudou, consentimento da ciência, retomar só com NSU zerado) são do gateway, não do Fixer.
   */
  register(cnpj: string, body: GatewayRegistration, actor?: string) {
    return this.call<GatewayCompanyStatus>('PUT', `/v1/companies/${cnpj}/registration`, body, actor);
  }

  getCompany(cnpj: string) {
    return this.call<GatewayCompanyStatus>('GET', `/v1/companies/${cnpj}`);
  }

  patchCredential(cnpj: string, body: { enabled?: boolean; autoManifest?: boolean; acknowledgeManifestDuty?: boolean }, actor?: string) {
    return this.call<{ enabled: boolean; autoManifest: boolean }>('PATCH', `/v1/companies/${cnpj}/credential`, body, actor);
  }

  deleteCredential(cnpj: string, actor?: string) {
    return this.call<null>('DELETE', `/v1/companies/${cnpj}/credential`, undefined, actor);
  }

  listDocuments(cnpj: string, afterNsu: string, limit = 50) {
    return this.call<GatewayDocumentsPage>('GET', `/v1/companies/${cnpj}/documents?afterNsu=${afterNsu}&limit=${limit}`);
  }

  ack(cnpj: string, nsu: string) {
    return this.call<{ ackedNsu: string }>('POST', `/v1/companies/${cnpj}/subscription/ack`, { nsu });
  }

  queueManifestations(cnpj: string, accessKeys: string[], actor?: string) {
    return this.call<{ queued: number }>('POST', `/v1/companies/${cnpj}/manifestations`, { type: 'CIENCIA', accessKeys }, actor);
  }

  registeredManifestations(cnpj: string) {
    return this.call<{ items: { accessKey: string; registeredAt: string | null }[] }>('GET', `/v1/companies/${cnpj}/manifestations?status=REGISTERED`);
  }

  private async call<T>(method: string, path: string, body?: unknown, actor?: string): Promise<T> {
    let res: Response;
    try {
      res = await fetch(`${this.cfg.url}${path}`, {
        method,
        headers: {
          authorization: `Bearer ${this.cfg.apiKey}`,
          ...(body === undefined ? {} : { 'content-type': 'application/json' }),
          ...(actor ? { 'x-actor': actor } : {}),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(this.cfg.requestTimeoutMs),
        redirect: 'error', // a chave de API nunca segue redirecionamento
      });
    } catch {
      throw new GatewayError('Não foi possível falar com o serviço de notas fiscais. Tente de novo em instantes.', 503);
    }
    const text = await res.text();
    if (!res.ok) {
      let title = `O serviço de notas fiscais respondeu ${res.status}`;
      try {
        const problem = JSON.parse(text) as { title?: string };
        if (typeof problem.title === 'string' && res.status < 500) title = problem.title;
      } catch {
        /* corpo não é JSON: mantém a mensagem genérica */
      }
      throw new GatewayError(title, res.status);
    }
    return (text ? JSON.parse(text) : null) as T;
  }
}
