/**
 * Mensagens iniciadas pela empresa só podem ser TEMPLATES aprovados pela Meta. Este registro é a
 * fonte de verdade local: o nome/idioma/nº de variáveis tem de bater com o que foi aprovado no
 * WhatsApp Manager. Validamos aqui para um erro de uso virar 422 imediato, e não uma falha
 * assíncrona na Meta depois de gastar tentativas.
 */
export interface TemplateDef {
  readonly language: string;
  /** Nome de cada variável posicional ({{1}}, {{2}}…), só para mensagens de erro e documentação. */
  readonly variables: readonly string[];
  /** Texto cadastrado na Meta (referência; não é enviado). */
  readonly body: string;
}

export const TEMPLATES = {
  /** Pré-aprovado em toda conta de teste da Meta: serve para validar token/número sem esperar aprovação. */
  hello_world: {
    language: 'en_US',
    variables: [],
    body: 'Welcome and congratulations!! This message demonstrates your ability to send a WhatsApp message notification from the Cloud API.',
  },
  os_portal_link: {
    language: 'pt_BR',
    variables: ['numero_os', 'oficina', 'link'],
    body: 'Olá! Abrimos a ordem de serviço #{{1}} na {{2}}. Acesse para completar seus dados e contar o que está acontecendo com o veículo: {{3}}',
  },
  os_status_update: {
    language: 'pt_BR',
    variables: ['numero_os', 'status', 'link'],
    body: 'Sua ordem de serviço #{{1}} mudou para: {{2}}. Acompanhe e converse com a oficina: {{3}}',
  },
} as const satisfies Record<string, TemplateDef>;

export type TemplateName = keyof typeof TEMPLATES;
export const isTemplateName = (n: string): n is TemplateName =>
  Object.hasOwn(TEMPLATES, n);

const MAX_PARAM = 1024;

/**
 * Valida e sanitiza as variáveis. A Meta rejeita parâmetros com quebra de linha, tab ou 4+ espaços
 * seguidos, então normalizamos em vez de falhar depois. Lança Error com mensagem para o chamador.
 */
export function prepareVariables(name: TemplateName, vars: unknown): string[] {
  const def: TemplateDef = TEMPLATES[name];
  if (!Array.isArray(vars) || vars.length !== def.variables.length) {
    throw new Error(
      `Template ${name} espera ${def.variables.length} variáveis: ${def.variables.join(', ')}`,
    );
  }
  return vars.map((v, i) => {
    if (typeof v !== 'string')
      throw new Error(`Variável "${def.variables[i]}" deve ser texto`);
    const clean = v.replace(/\s+/g, ' ').trim();
    if (!clean)
      throw new Error(`Variável "${def.variables[i]}" não pode ser vazia`);
    if (clean.length > MAX_PARAM)
      throw new Error(
        `Variável "${def.variables[i]}" passa de ${MAX_PARAM} caracteres`,
      );
    return clean;
  });
}
