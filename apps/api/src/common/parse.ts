import { BadRequestException } from '@nestjs/common';
import type { ZodType } from 'zod';

/** Valida `body` com o schema zod; erros viram 400 com as mensagens concatenadas. */
export function parse<T>(schema: ZodType<T, any, any>, body: unknown): T {
  const result = schema.safeParse(body);
  if (!result.success) {
    throw new BadRequestException(result.error.issues.map((i) => i.message).join('; '));
  }
  return result.data;
}
