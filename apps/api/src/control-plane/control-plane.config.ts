import { Injectable } from '@nestjs/common';

/**
 * Integração com o control plane da Max Gateway. Tudo opcional: sem URL, chave e RabbitMQ a integração fica desligada
 * (instalação legada, um banco por oficina) e a API segue como sempre.
 */
@Injectable()
export class ControlPlaneConfig {
  readonly url?: string;
  /** Chave de API do control plane com escopo `product`. */
  readonly apiKey?: string;
  readonly rabbitUrl?: string;
  readonly exchange: string;
  readonly queue: string;
  /** Chave do produto no catálogo do control plane. */
  readonly product: string;
  /** `iss` esperado nos snapshots de licença. */
  readonly issuer: string;
  /** Com `true`, organização sem licença conhecida é tratada como sem acesso (modo compartilhado em produção). */
  readonly licenseRequired: boolean;

  constructor() {
    const e = process.env;
    this.url = e.CONTROL_PLANE_URL?.replace(/\/+$/, '') || undefined;
    this.apiKey = e.CONTROL_PLANE_API_KEY || undefined;
    this.rabbitUrl = e.RABBITMQ_URL || undefined;
    this.exchange = e.CONTROL_PLANE_EXCHANGE || 'mg.control-plane';
    this.queue = e.CONTROL_PLANE_QUEUE || 'fixer.control-plane';
    this.product = e.CONTROL_PLANE_PRODUCT || 'fixer';
    this.issuer = e.CONTROL_PLANE_ISSUER || 'max-gateway-control-plane';
    this.licenseRequired = e.LICENSE_REQUIRED === 'true';
  }

  get enabled(): boolean {
    return Boolean(this.url && this.apiKey && this.rabbitUrl);
  }
}
