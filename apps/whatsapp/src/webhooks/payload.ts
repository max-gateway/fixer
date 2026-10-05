import { z } from 'zod';

/**
 * Subconjunto do payload de webhook da Cloud API que nos interessa. Tudo é opcional/tolerante: a Meta
 * adiciona campos sem aviso, e um payload de tipo que não tratamos não pode virar 500 (a Meta
 * reentregaria para sempre).
 */
const Status = z.object({
  id: z.string(),
  status: z.string(),
  timestamp: z.string().optional(),
  errors: z
    .array(
      z.object({
        code: z.number().optional(),
        title: z.string().optional(),
        message: z.string().optional(),
      }),
    )
    .optional(),
});

const Inbound = z.object({
  id: z.string(),
  from: z.string(),
  timestamp: z.string(),
  type: z.string(),
  text: z.object({ body: z.string() }).optional(),
  button: z
    .object({ text: z.string().optional(), payload: z.string().optional() })
    .optional(),
});

export const WebhookPayload = z.object({
  object: z.string(),
  entry: z
    .array(
      z.object({
        changes: z
          .array(
            z.object({
              field: z.string(),
              value: z
                .object({
                  statuses: z.array(Status).optional(),
                  messages: z.array(Inbound).optional(),
                })
                .passthrough(),
            }),
          )
          .default([]),
      }),
    )
    .default([]),
});
export type StatusUpdate = z.infer<typeof Status>;
export type InboundMessage = z.infer<typeof Inbound>;

const OPT_OUT = new Set([
  'PARAR',
  'SAIR',
  'STOP',
  'DESCADASTRAR',
  'NAO QUERO RECEBER',
]);
const OPT_IN = new Set(['VOLTAR', 'START', 'RECEBER']);

const norm = (s: string) =>
  s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-zA-Z ]/g, '')
    .trim()
    .toUpperCase();

/** Palavra-chave de descadastro/reativação. Só vale a mensagem INTEIRA, para "não pare de avisar" não descadastrar. */
export function optIntent(
  text: string | undefined,
): 'OPTED_OUT' | 'OPTED_IN' | null {
  if (!text) return null;
  const n = norm(text);
  if (OPT_OUT.has(n)) return 'OPTED_OUT';
  if (OPT_IN.has(n)) return 'OPTED_IN';
  return null;
}
