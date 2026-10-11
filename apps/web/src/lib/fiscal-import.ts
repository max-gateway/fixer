// Estado da importação de NF-e (GET /fiscal/status). BigInt (NSU) e datas chegam como string no JSON.

export type SyncState = {
  lastNsu: string;
  maxNsu: string;
  nextPollAt: string;
  lastStatusCode: number | null;
  lastError: string | null;
  lastRunAt: string | null;
  lastSuccessAt: string | null;
  consecutiveFailures: number;
};

export type FiscalCredentialView = {
  environment: 'PRODUCTION' | 'HOMOLOGATION';
  subject: string;
  certCnpj: string;
  notBefore: string;
  notAfter: string;
  enabled: boolean;
  autoManifest: boolean;
  autoExport: boolean;
  updatedAt: string;
  syncState: SyncState | null;
};

export type FiscalStatus = {
  /** false = a API subiu sem FISCAL_ENC_KEYS: não dá para guardar certificado neste ambiente. */
  keyAvailable: boolean;
  settings: { cnpj: string | null; legalName: string | null; ufCode: number | null } | null;
  credential: FiscalCredentialView | null;
};

const DAY = 86_400_000;

export const daysUntil = (iso: string, now = Date.now()) => Math.floor((new Date(iso).getTime() - now) / DAY);

/** "há 3 horas", "em 40 minutos". */
export function relativeTime(iso: string | null, now = Date.now()): string {
  if (!iso) return 'nunca';
  const diff = new Date(iso).getTime() - now;
  const abs = Math.abs(diff);
  const rtf = new Intl.RelativeTimeFormat('pt-BR', { numeric: 'auto' });
  if (abs < 60_000) return diff < 0 ? 'agora há pouco' : 'em instantes';
  if (abs < 3_600_000) return rtf.format(Math.round(diff / 60_000), 'minute');
  if (abs < DAY) return rtf.format(Math.round(diff / 3_600_000), 'hour');
  return rtf.format(Math.round(diff / DAY), 'day');
}

export type Health = { tone: 'ok' | 'warn' | 'error' | 'off'; title: string; detail?: string };

/**
 * Resume a saúde da sincronização em uma frase. A NT da SEFAZ só gera NSU para quem consultou nos últimos
 * 60 dias (docs/specs/nfe-import.md §6.5): daí os avisos de "parada há muito tempo" em 7 e 30 dias.
 */
export function syncHealth(c: FiscalCredentialView, now = Date.now()): Health {
  const s = c.syncState;
  if (daysUntil(c.notAfter, now) < 0) return { tone: 'error', title: 'Certificado vencido', detail: 'Envie o certificado renovado para voltar a buscar notas.' };
  if (!c.enabled) {
    return s?.lastError
      ? { tone: 'error', title: 'Sincronização desligada por erro', detail: s.lastError }
      : { tone: 'off', title: 'Sincronização desligada', detail: 'As notas não estão sendo buscadas.' };
  }
  if (s?.lastError) return { tone: 'warn', title: 'Última consulta falhou', detail: s.lastError };
  const idle = s?.lastSuccessAt ? (now - new Date(s.lastSuccessAt).getTime()) / DAY : null;
  if (idle !== null && idle > 30) return { tone: 'error', title: 'Sem consulta bem-sucedida há mais de 30 dias', detail: 'Notas emitidas nesse período podem não ser recuperadas: a SEFAZ para de gerar a fila após 60 dias.' };
  if (idle !== null && idle > 7) return { tone: 'warn', title: 'Sem consulta bem-sucedida há mais de 7 dias' };
  if (!s?.lastSuccessAt) return { tone: 'ok', title: 'Aguardando a primeira consulta', detail: 'Ela acontece em até 30 segundos depois de ligar.' };
  return { tone: 'ok', title: 'Sincronizando', detail: `Última consulta ${relativeTime(s.lastSuccessAt, now)}; próxima ${relativeTime(s.nextPollAt, now)}.` };
}
