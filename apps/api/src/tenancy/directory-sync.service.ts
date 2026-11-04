import { ManagedDirectorySync, type ProductSyncStatus, type SyncHealth } from '@max-gateway/directory-sync';
import { Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { SystemPrismaService } from '../prisma/system-prisma.service.js';
import { FixerDirectoryStore } from './fixer-directory.store.js';

/**
 * Liga o registro de organizações e membros do Fixer ao `@max-gateway/directory-sync`. Os eventos do control plane continuam sendo o caminho
 * rápido (`ControlPlaneEventsConsumer`); este sync é a reconciliação: corrige o que um evento perdido deixou e, principalmente, remove quem saiu
 * da organização (nenhum evento de remoção chega ao Fixer). Configuração (`CONTROL_PLANE_URL`, `CONTROL_PLANE_API_KEY`, `CONTROL_PLANE_PRODUCT`,
 * `TENANT_SYNC_*`), convergência, proteções e atraso são do pacote. Sem URL e chave fica desligado e avisa no boot.
 */
@Injectable()
export class DirectorySyncService implements OnModuleInit, OnModuleDestroy {
  private readonly sync: ManagedDirectorySync;

  constructor(system: SystemPrismaService) {
    this.sync = new ManagedDirectorySync({ defaultProduct: 'fixer', store: new FixerDirectoryStore(system), logger: new Logger(DirectorySyncService.name) });
  }

  // Não bloqueia o boot: o control plane fora do ar não impede a API de subir.
  onModuleInit(): void {
    this.sync.start();
  }

  onModuleDestroy(): void {
    this.sync.stop();
  }

  status(): ProductSyncStatus {
    return this.sync.status();
  }

  health(): SyncHealth {
    return this.sync.health();
  }
}
