import { HttpException, Inject, Injectable, Logger, Optional } from '@nestjs/common';
import type { CallerContext } from '../catalog-platform/catalog-platform.service.js';
import { WorkforceConfig, type WorkforceSettings } from './workforce.config.js';

/** Token de injeção do `fetch` (só os testes o trocam). */
export const WORKFORCE_FETCH = Symbol('WORKFORCE_FETCH');

const UNAVAILABLE = 'A equipe está indisponível no momento. Tente novamente em instantes.';

export interface PersonView {
  id: string;
  cpf: string;
  name: string;
  socialName: string | null;
  birthDate: string | null;
  email: string | null;
  phone: string | null;
  hasLogin: boolean;
  status: 'active' | 'inactive';
  version: number;
  createdAt: string;
  anonymized: boolean;
}

export interface EngagementView {
  id: string;
  kind: 'clt' | 'pj' | 'autonomo' | 'socio' | 'estagio' | 'temporario';
  status: 'active' | 'terminated';
  unitId: string | null;
  unitName: string | null;
  admittedOn: string;
  terminatedOn: string | null;
  positions: { positionKey: string; positionName: string; validFrom: string; validTo: string | null }[];
}

export type PersonDetail = PersonView & { engagements: EngagementView[] };
export interface PersonPage {
  items: PersonView[];
  nextCursor: string | null;
}
export interface UnitView {
  id: string;
  name: string;
  status: string;
}
export interface PositionView {
  id: string;
  key: string;
  name: string;
  status: string;
}

type Query = Record<string, string | number | undefined>;

/**
 * Único ponto do Fixer que fala com o serviço workforce da plataforma. Leva o token do PRÓPRIO usuário (propagado, nunca reemitido), a organização e o
 * traceparent; o workforce decide o que o papel dele permite (escopos `people:*`). O que sai daqui para a pessoa passa por `fail`: a mensagem do workforce só
 * chega quando é do pedido (400/404/409/422, escritas em português para o usuário); falha de identidade ou de infraestrutura vira um texto nosso.
 */
@Injectable()
export class WorkforceService {
  private readonly logger = new Logger(WorkforceService.name);

  constructor(
    @Inject(WorkforceConfig) private readonly settings: WorkforceSettings,
    @Optional() @Inject(WORKFORCE_FETCH) private readonly fetchImpl?: typeof globalThis.fetch,
  ) {}

  listPeople(caller: CallerContext, query: { search?: string; status?: string; cursor?: string; limit?: number }) {
    return this.request<PersonPage>(caller, 'GET', '/v1/people', { query });
  }

  getPerson(caller: CallerContext, id: string) {
    return this.request<PersonDetail>(caller, 'GET', `/v1/people/${id}`);
  }

  createPerson(caller: CallerContext, body: unknown) {
    return this.request<PersonView>(caller, 'POST', '/v1/people', { body });
  }

  updatePerson(caller: CallerContext, id: string, body: unknown) {
    return this.request<PersonView>(caller, 'PATCH', `/v1/people/${id}`, { body });
  }

  addEngagement(caller: CallerContext, personId: string, body: unknown) {
    return this.request<EngagementView>(caller, 'POST', `/v1/people/${personId}/engagements`, { body });
  }

  assignPosition(caller: CallerContext, engagementId: string, body: unknown) {
    return this.request<EngagementView>(caller, 'POST', `/v1/engagements/${engagementId}/positions`, { body });
  }

  terminate(caller: CallerContext, engagementId: string, body: unknown) {
    return this.request<EngagementView & { lastActive: boolean; personId: string }>(caller, 'POST', `/v1/engagements/${engagementId}/terminate`, { body });
  }

  units(caller: CallerContext) {
    return this.request<{ items: UnitView[] }>(caller, 'GET', '/v1/units');
  }

  positions(caller: CallerContext) {
    return this.request<{ items: PositionView[] }>(caller, 'GET', '/v1/positions');
  }

  private async request<T>(caller: CallerContext, method: 'GET' | 'POST' | 'PATCH', path: string, opts: { query?: Query; body?: unknown } = {}): Promise<T> {
    if (!this.settings.baseUrl) throw new HttpException({ message: 'A equipe ainda não está disponível nesta instalação.' }, 503);
    const qs = new URLSearchParams();
    for (const [k, v] of Object.entries(opts.query ?? {})) if (v !== undefined && v !== '') qs.set(k, String(v));
    const url = `${this.settings.baseUrl}${path}${qs.size ? `?${qs}` : ''}`;

    let res: Response;
    try {
      res = await (this.fetchImpl ?? globalThis.fetch)(url, {
        method,
        headers: {
          accept: 'application/json',
          authorization: `Bearer ${caller.token}`,
          'x-org-id': caller.orgId,
          ...(caller.traceparent ? { traceparent: caller.traceparent } : {}),
          ...(opts.body !== undefined ? { 'content-type': 'application/json' } : {}),
        },
        ...(opts.body !== undefined ? { body: JSON.stringify(opts.body) } : {}),
        signal: AbortSignal.timeout(this.settings.timeoutMs),
      });
    } catch {
      throw new HttpException({ message: UNAVAILABLE }, 503);
    }

    const json = (await res.json().catch(() => null)) as { error?: { code?: string; message?: string; requestId?: string } } | null;
    if (!res.ok) throw this.fail(res.status, json?.error, `${method} ${path}`);
    return json as T;
  }

  private fail(status: number, error: { code?: string; message?: string; requestId?: string } | undefined, route: string): HttpException {
    const requestId = error?.requestId;
    // O usuário só vê um texto nosso; o motivo real fica aqui para o suporte (sem corpo do pedido: pode ter CPF).
    this.logger.warn(`workforce ${route} respondeu ${status} ${error?.code ?? '-'}: ${error?.message ?? '-'}${requestId ? ` (requestId ${requestId})` : ''}`);
    const reply = (message: string, code: number) => new HttpException({ message, ...(requestId ? { requestId } : {}) }, code);
    if ([400, 404, 409, 422].includes(status)) return reply(error?.message ?? 'Pedido inválido.', status);
    if (status === 403) return reply('Você não tem permissão para esta operação na equipe.', 403);
    if (status === 429) return reply('Muitas operações em pouco tempo. Aguarde um instante.', 429);
    // 401: a plataforma recusou um token que o Fixer JÁ aceitou. A sessão está boa; o problema é emissor/audiência (`workforce`). Responder 401 faria o web
    // pedir login de novo em loop.
    if (status === 401) return reply('A equipe não reconheceu o seu login (configuração de identidade). Não é a sua sessão: avise o suporte.', 502);
    if (status === 503) return reply(UNAVAILABLE, 503);
    return reply('Falha ao consultar a equipe.', 502);
  }
}
