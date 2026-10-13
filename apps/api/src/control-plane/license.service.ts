import { Inject, Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { TenantContext } from '../tenancy/tenant-context.js';
import { ControlPlaneClient } from './control-plane.client.js';
import { ControlPlaneConfig } from './control-plane.config.js';

export type AccessMode = 'full' | 'readonly' | 'none';
export type Entitlements = Record<string, { kind: string; value: unknown }>;
export interface LicenseState {
  mode: AccessMode;
  /** `null` = sem licença conhecida (instalação legada): nenhum limite se aplica. */
  entitlements: Entitlements | null;
}

const TTL_MS = 30_000;

/**
 * Licença da organização atual: última situação conhecida da assinatura. É gravada quando o control plane avisa (evento)
 * e lida com um cache curto por réplica. Se o control plane cair, vale a última situação conhecida.
 */
@Injectable()
export class LicenseService {
  private readonly cache = new Map<string, { state: LicenseState; at: number }>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly client: ControlPlaneClient,
    @Inject(ControlPlaneConfig) private readonly cfg: ControlPlaneConfig,
  ) {}

  /** Modo de acesso efetivo da organização do contexto. Sem licença gravada: livre, a menos que `LICENSE_REQUIRED=true`. */
  async mode(now: Date = new Date()): Promise<AccessMode> {
    return (await this.state(now)).mode;
  }

  /** Modo e direitos (limites, funcionalidades) da organização do contexto, com cache curto. */
  async state(now: Date = new Date()): Promise<LicenseState> {
    const orgId = TenantContext.require();
    const hit = this.cache.get(orgId);
    if (hit && now.getTime() - hit.at < TTL_MS) return hit.state;

    const row = await this.prisma.orgLicense.findUnique({ where: { orgId }, select: { mode: true, readonlyUntil: true, entitlements: true } });
    const state: LicenseState = { mode: this.cfg.licenseRequired ? 'none' : 'full', entitlements: null };
    if (row) {
      state.mode = row.mode as AccessMode;
      state.entitlements = (row.entitlements ?? {}) as Entitlements;
      // A janela de somente leitura pode ter acabado depois do último snapshot.
      if (state.mode === 'readonly' && row.readonlyUntil && now > row.readonlyUntil) state.mode = 'none';
    }
    this.cache.set(orgId, { state, at: now.getTime() });
    return state;
  }

  /** Busca o snapshot no control plane e grava. Sem assinatura neste produto: apaga a licença conhecida. */
  async refresh(): Promise<void> {
    const orgId = TenantContext.require();
    const claims = await this.client.snapshot(orgId);
    if (!claims) {
      await this.prisma.orgLicense.deleteMany({});
    } else {
      const data = {
        status: claims.status,
        mode: claims.mode,
        version: claims.ver,
        trialEndsAt: claims.trialEndsAt ? new Date(claims.trialEndsAt) : null,
        readonlyUntil: claims.readonlyUntil ? new Date(claims.readonlyUntil) : null,
        entitlements: claims.ent as object,
        refreshedAt: new Date(),
      };
      // Atômico: o INSERT ignora quem já existe (dois eventos simultâneos não colidem) e o UPDATE só vale se a versão não
      // regride, então um evento atrasado nunca sobrescreve um estado mais novo (a versão só cresce).
      await this.prisma.orgLicense.createMany({ data: [data], skipDuplicates: true });
      await this.prisma.orgLicense.updateMany({ where: { orgId, version: { lte: claims.ver } }, data });
    }
    this.cache.delete(orgId);
  }
}
