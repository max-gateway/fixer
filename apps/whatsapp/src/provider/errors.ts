/**
 * Códigos de erro da WhatsApp Cloud API que NÃO adianta repetir (a mensagem/destinatário é o problema).
 * Fora desta lista, qualquer erro é tratado como transitório e tentado de novo com backoff.
 * https://developers.facebook.com/docs/whatsapp/cloud-api/support/error-codes
 */
const PERMANENT = new Set([
  100, //    parâmetro inválido
  131008, // parâmetro obrigatório ausente
  131009, // valor de parâmetro inválido
  131021, // remetente = destinatário
  131026, // mensagem não entregável (sem WhatsApp, versão antiga, não aceitou os termos)
  131030, // destinatário fora da lista permitida (modo de teste)
  131047, // fora da janela de 24h: só template
  131051, // tipo de mensagem não suportado
  131052,
  131053, // mídia
  132000, // nº de parâmetros do template não confere
  132001, // template inexistente / não aprovado no idioma
  132005, // texto traduzido longo demais
  132007, // política da Meta violada
  132012, // formato de parâmetro inválido
  132015, // template pausado
  132016, // template desabilitado
  133010, // número do remetente não registrado
]);

/** Transitórios que a Meta devolve com HTTP 4xx: limites de taxa e indisponibilidade. */
const TRANSIENT = new Set([
  4, //      limite de chamadas da app
  80007, //  limite de taxa da conta
  130429, // throughput excedido
  131000, // erro genérico/interno
  131016, // serviço indisponível
  131056, // limite de mensagens para o mesmo par de números
  133004,
  133005,
  133006,
  133016, // verificação/registro do número em andamento
]);

/** Erros do tipo "problema de credencial": repetir não resolve sozinho, mas é transitório do ponto de vista da mensagem. */
const AUTH = new Set([0, 190, 200, 10]);

export function classifyMetaError(
  httpStatus: number,
  code: number | undefined,
): { retryable: boolean; auth: boolean } {
  if (code !== undefined && PERMANENT.has(code))
    return { retryable: false, auth: false };
  if (code !== undefined && TRANSIENT.has(code))
    return { retryable: true, auth: false };
  const auth =
    (code !== undefined && AUTH.has(code)) ||
    httpStatus === 401 ||
    httpStatus === 403;
  // 4xx sem código conhecido (exceto 408/429) é erro de requisição nosso: não repetir.
  const clientError =
    httpStatus >= 400 &&
    httpStatus < 500 &&
    httpStatus !== 408 &&
    httpStatus !== 429 &&
    !auth;
  return { retryable: !clientError, auth };
}
