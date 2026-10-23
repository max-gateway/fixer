import { AuthError } from '@max-gateway/auth';
import {
  BadRequestException,
  ForbiddenException,
  HttpException,
  NotFoundException,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';

/**
 * Erro do `@max-gateway/auth` → exceção HTTP do Nest. Fora do concedido é 404 idêntico ao inexistente (a mensagem não distingue).
 * O que não é `AuthError` sobe como está: é defeito, não resultado de autenticação.
 */
export function authErrorToHttp(err: unknown): unknown {
  if (!(err instanceof AuthError)) return err;
  switch (err.status) {
    case 400:
      return new BadRequestException(err.message);
    case 401:
      return new UnauthorizedException('Token inválido');
    case 403:
      return new ForbiddenException(err.message);
    case 404:
      return new NotFoundException('Não encontrado');
    case 503:
      return new ServiceUnavailableException(err.message);
    default:
      return new HttpException(err.message, err.status);
  }
}
