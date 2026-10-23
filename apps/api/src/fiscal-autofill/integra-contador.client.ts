import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { GatewayClient } from '../fiscal-inbound/gateway/gateway.client.js';

// Cliente do serviço de plataforma `integra-contador` (docs/specs/integra-contador.md §7): RBT12 pela última declaração do
// PGDAS-D e regime pelos DARF pagos. O contrato com o SERPRO é da plataforma; aqui só chega o dado extraído. Sem
// INTEGRA_CONTADOR_URL o cliente fica desligado e o preenchimento usa a estimativa pelas ordens de serviço.
//
// Autorização: a oficina assina um termo com o próprio e-CNPJ (guardado no dfe-gateway) e o serviço troca por um token
// que vale até a meia-noite. Quando o serviço responde 401 AUTORIZACAO_EXPIRADA, este cliente pede um termo novo ao
// gateway, entrega ao serviço e repete a consulta uma vez. Sem gateway não há quem assine (o modo direto não implementa).

export type IntegraOutcome<T> =
  | { status: 'OK'; data: T }
  /** Contribuinte ainda não autorizou o Fixer (403 SEM_AUTORIZACAO). */
  | { status: 'SEM_AUTORIZACAO' }
  /** Nada a extrair (sem declaração no período, sem pagamentos). */
  | { status: 'SEM_DADO'; detail?: string }
  | { status: 'FALHOU'; detail: string };

export interface IntegraRbt12 {
  /** Período de apuração a que a RBT12 se aplica, AAAAMM. */
  pa: string;
  /** O valor que entra na tabela do Anexo: a RBT12 proporcional em início de atividade (< 12 meses), a real nos demais. */
  rbt12: string;
  numeroDeclaracao: string | null;
  /** RBT12 real (soma dos 12 PA anteriores); é a que vale para o limite do Simples. */
  rbt12Real?: string;
  proporcional?: boolean;
  mesesAtividade?: number;
  /** Fatos fiscais da declaração (mix por Anexo, ST, monofásico, sublimite, Fator R...): evidência para o motor tributário. */
  fatos?: Record<string, unknown>;
}
export interface IntegraRegime {
  regimeInferido: 'PRESUMIDO' | 'REAL' | 'SIMPLES' | null;
  motivo: string | null;
}

const TIMEOUT_MS = 20_000;
const ACTOR = 'fiscal-autofill';

interface ErrorBody {
  detail?: string;
  error?: { code?: string };
}

@Injectable()
export class IntegraContadorClient {
  private readonly logger = new Logger(IntegraContadorClient.name);
  private contratante: { cnpj: string; nome: string } | null = null;

  constructor(@Optional() @Inject(GatewayClient) private readonly gateway?: GatewayClient | null) {}

  get enabled() {
    return Boolean(process.env.INTEGRA_CONTADOR_URL);
  }

  rbt12(cnpj: string, pa: string): Promise<IntegraOutcome<IntegraRbt12>> {
    return this.call(cnpj, `/v1/simples/rbt12/${cnpj}?pa=${pa}`);
  }

  regime(cnpj: string, de: string, ate: string): Promise<IntegraOutcome<IntegraRegime>> {
    return this.call(cnpj, `/v1/pagamentos/regime/${cnpj}?de=${de}&ate=${ate}`);
  }

  private async call<T>(cnpj: string, path: string, renewed = false): Promise<IntegraOutcome<T>> {
    const res = await this.request(path);
    if (res.kind === 'ERRO') return { status: 'FALHOU', detail: res.detail };
    const { status, body } = res;
    if (status >= 200 && status < 300 && body) return { status: 'OK', data: body as T };
    const code = (body as ErrorBody | null)?.error?.code;
    if (status === 401 && code === 'AUTORIZACAO_EXPIRADA' && !renewed) {
      const renewal = await this.renewAuthorization(cnpj);
      if (renewal) return { status: 'FALHOU', detail: renewal };
      return this.call(cnpj, path, true);
    }
    if (status === 403) return { status: 'SEM_AUTORIZACAO' };
    if (status === 404) return { status: 'SEM_DADO', ...((body as ErrorBody | null)?.detail ? { detail: (body as ErrorBody).detail } : {}) };
    this.logger.warn(`integra-contador respondeu ${status} em ${path.split('?')[0]}`);
    return { status: 'FALHOU', detail: (body as ErrorBody | null)?.detail ?? `Serviço respondeu HTTP ${status}` };
  }

  /** Assina um termo novo no gateway e entrega ao serviço. Devolve a mensagem do problema, ou null se deu certo. */
  private async renewAuthorization(cnpj: string): Promise<string | null> {
    if (!this.gateway) return 'A renovação da autorização da Receita exige o serviço de notas fiscais (dfe-gateway).';
    try {
      this.contratante ??= await this.fetchContratante();
      const { xml } = await this.gateway.signIntegraTerm(cnpj, this.contratante, ACTOR);
      const res = await this.request('/v1/autorizacao', { cnpj, termo_assinado_xml: xml });
      if (res.kind === 'ERRO') return res.detail;
      if (res.status >= 400) return (res.body as ErrorBody | null)?.detail ?? `Serviço recusou o termo (HTTP ${res.status})`;
      return null;
    } catch (err) {
      this.logger.warn(`Renovação do termo do Integra Contador falhou: ${(err as Error).message}`);
      return 'Não foi possível renovar a autorização da Receita agora.';
    }
  }

  private async fetchContratante(): Promise<{ cnpj: string; nome: string }> {
    const res = await this.request('/v1/contratante');
    if (res.kind === 'ERRO' || res.status !== 200 || !res.body) throw new Error('contratante indisponível');
    return res.body as { cnpj: string; nome: string };
  }

  private async request(path: string, post?: unknown): Promise<{ kind: 'OK'; status: number; body: unknown } | { kind: 'ERRO'; detail: string }> {
    const base = process.env.INTEGRA_CONTADOR_URL!.replace(/\/$/, '');
    const key = process.env.INTEGRA_CONTADOR_API_KEY;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    try {
      const res = await fetch(`${base}${path}`, {
        method: post === undefined ? 'GET' : 'POST',
        signal: controller.signal,
        headers: { ...(key ? { Authorization: `Bearer ${key}` } : {}), ...(post === undefined ? {} : { 'content-type': 'application/json' }) },
        ...(post === undefined ? {} : { body: JSON.stringify(post) }),
      });
      return { kind: 'OK', status: res.status, body: await res.json().catch(() => null) };
    } catch (err) {
      return { kind: 'ERRO', detail: `Serviço indisponível: ${(err as Error).message}` };
    } finally {
      clearTimeout(timer);
    }
  }
}
