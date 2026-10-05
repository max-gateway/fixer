import { createParamDecorator, SetMetadata, type ExecutionContext } from '@nestjs/common';

export const IS_PUBLIC = 'isPublic';
/** Libera a rota do guard global de autenticação (ex.: /health). */
export const Public = () => SetMetadata(IS_PUBLIC, true);

export interface AuthUser {
  id: string; // User.id (cuid) — o que as FKs do schema usam
  keycloakId: string;
  name: string;
  email: string;
}

/** Usuário autenticado da requisição, já sincronizado na tabela User. */
export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): AuthUser =>
    ctx.switchToHttp().getRequest().user,
);
