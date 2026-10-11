import { ArgumentsHost, Catch, ExceptionFilter, HttpException, HttpStatus, Logger } from '@nestjs/common';
import type { Request, Response } from 'express';
import { ZodError } from 'zod';

/** RFC 9457: todo erro da API sai como application/problem+json, com o `Request-Id` para o suporte rastrear. */
@Catch()
export class ProblemFilter implements ExceptionFilter {
  private readonly logger = new Logger('Problem');

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const res = ctx.getResponse<Response>();
    const req = ctx.getRequest<Request & { id?: string }>();

    let status = HttpStatus.INTERNAL_SERVER_ERROR;
    let title = 'Erro interno';
    let detail: string | undefined;
    let errors: unknown;

    if (exception instanceof ZodError) {
      status = HttpStatus.BAD_REQUEST;
      title = 'Requisição inválida';
      errors = exception.issues.map((i) => ({ path: i.path.join('.'), message: i.message }));
    } else if (exception instanceof HttpException) {
      status = exception.getStatus();
      const body = exception.getResponse();
      title = typeof body === 'string' ? body : ((body as { message?: string | string[] }).message?.toString() ?? exception.message);
      detail = title;
    } else {
      this.logger.error(`Falha não tratada em ${req.method} ${req.url}: ${(exception as Error)?.message}`, (exception as Error)?.stack);
    }

    res
      .status(status)
      .type('application/problem+json')
      .json({ type: 'about:blank', title, status, ...(detail ? { detail } : {}), ...(errors ? { errors } : {}), requestId: req.id });
  }
}
