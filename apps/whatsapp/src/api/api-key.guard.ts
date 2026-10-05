import { createHash, timingSafeEqual } from 'node:crypto';
import {
  CanActivate,
  ExecutionContext,
  Inject,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { CONFIG, type AppConfig } from '../config/config.js';

const digest = (s: string) => createHash('sha256').update(s).digest();

/**
 * Autenticação serviço-a-serviço (apps/api, apps/notifications): Bearer com uma das chaves
 * configuradas. Compara hashes em tempo constante para não vazar a chave por timing, e aceita
 * várias chaves ao mesmo tempo para rotação sem downtime (adiciona a nova, migra, remove a antiga).
 */
@Injectable()
export class ApiKeyGuard implements CanActivate {
  private readonly keys: Buffer[];

  constructor(@Inject(CONFIG) cfg: AppConfig) {
    this.keys = cfg.apiKeys.map(digest);
  }

  canActivate(ctx: ExecutionContext): boolean {
    const header = String(
      ctx.switchToHttp().getRequest().headers.authorization ?? '',
    );
    const [scheme, token] = header.split(' ');
    if (scheme?.toLowerCase() !== 'bearer' || !token)
      throw new UnauthorizedException('Chave ausente');
    const got = digest(token);
    if (!this.keys.some((k) => timingSafeEqual(k, got)))
      throw new UnauthorizedException('Chave inválida');
    return true;
  }
}
