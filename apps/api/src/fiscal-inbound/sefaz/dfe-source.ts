import type { CredentialMaterial } from '../credentials/credential.service.js';
import type { EnvEventoResponse } from '../parser/event-response.parser.js';
import type { DistResult } from '../parser/dist-response.parser.js';

export const DFE_SOURCE = Symbol('DFE_SOURCE');

export interface DistributeParams {
  /** CNPJ de 14 posições da empresa (TenantFiscalSettings). */
  cnpj: string;
  ufCode?: number | null;
  /** Último NSU consumido; a SEFAZ devolve os documentos com NSU maior. */
  ultNsu: bigint;
}

export interface ManifestParams {
  /** CNPJ de 14 posições do destinatário (autor do evento). */
  cnpj: string;
  /** Chaves de acesso (1 a 20) a que se dá Ciência da Operação neste lote. */
  accessKeys: string[];
  now: Date;
}

/**
 * Fonte dos documentos fiscais. A implementação real fala com a SEFAZ (`SefazDfeClient`); os testes
 * usam uma fonte falsa com respostas gravadas, sem rede.
 */
export interface DfeSource {
  distribute(material: CredentialMaterial, params: DistributeParams): Promise<DistResult>;
  /** Envia o lote de eventos de Ciência da Operação (210210), assinado com o certificado do tenant. */
  manifest(material: CredentialMaterial, params: ManifestParams): Promise<EnvEventoResponse>;
}

/** Falha de transporte (rede, TLS, timeout, HTTP ≠ 200): transitória, o runner aplica backoff. */
export class SefazTransportError extends Error {
  constructor(
    message: string,
    readonly httpStatus?: number,
  ) {
    super(message);
  }
}

/** Ambiente sem URL configurada: erro de configuração, não de rede. */
export class SefazNotConfiguredError extends Error {}
