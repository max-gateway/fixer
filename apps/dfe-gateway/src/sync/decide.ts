/**
 * Decisão pura de "o que fazer depois desta resposta da SEFAZ" (docs/specs/nfe-import.md §6.2).
 * Fica separada do runner para ser testada sem banco e sem rede.
 */

const MIN = 60_000;
const HOUR = 60 * MIN;

/** cStat que significam problema de certificado/CNPJ: repetir não adianta, o sync é desligado. */
const CERT_REJECTIONS = new Set([280, 281, 283, 284, 285, 286, 472, 473, 489, 490, 593]);

/** Após esta quantidade de 656 seguidos o sync é desligado e exige ação humana (§6.6). */
export const MAX_CONSECUTIVE_BLOCKS = 3;

export type Outcome =
  /** Há mais documentos: continuar agora, sem esperar a hora cheia. */
  | 'MORE'
  /** Fila esgotada (137 ou ultNSU = maxNSU): esperar 1 h. */
  | 'IDLE'
  /** 656: o CNPJ está bloqueado por 1 h; esperar mais que isso. */
  | 'BLOCKED'
  /** Falha transitória: backoff exponencial. */
  | 'RETRY'
  /** Problema permanente: desligar o sync. */
  | 'DISABLE';

export interface Decision {
  outcome: Outcome;
  nextPollAt: Date;
  /** Novo valor de `consecutiveFailures`. */
  failures: number;
  /** Texto para `lastError`; null limpa o erro anterior. */
  error: string | null;
}

export interface DecideInput {
  cStat: number;
  xMotivo: string;
  ultNsu: bigint | null;
  maxNsu: bigint | null;
  prevFailures: number;
  prevStatusCode: number | null;
  now: Date;
  /** [0,1); injetável para teste. */
  random: () => number;
}

const at = (now: Date, ms: number) => new Date(now.getTime() + ms);

/** Espera de 1 h + jitter de 0–5 min, para as réplicas e os tenants não baterem na SEFAZ juntos. */
const idleDelay = (rand: () => number) => HOUR + Math.floor(rand() * 5 * MIN);

export function backoffMs(failures: number): number {
  return Math.min(2 ** Math.max(0, failures - 1) * MIN, HOUR);
}

export function decide(i: DecideInput): Decision {
  const retry = (error: string): Decision => {
    const failures = i.prevFailures + 1;
    return { outcome: 'RETRY', nextPollAt: at(i.now, backoffMs(failures)), failures, error };
  };

  if (i.cStat === 138) {
    // 138 sem avançar o NSU seria um laço infinito; trata como fila esgotada.
    const advanced = i.ultNsu !== null && i.maxNsu !== null && i.ultNsu < i.maxNsu;
    return advanced
      ? { outcome: 'MORE', nextPollAt: at(i.now, 1_000), failures: 0, error: null }
      : { outcome: 'IDLE', nextPollAt: at(i.now, idleDelay(i.random)), failures: 0, error: null };
  }

  if (i.cStat === 137) {
    return { outcome: 'IDLE', nextPollAt: at(i.now, idleDelay(i.random)), failures: 0, error: null };
  }

  if (i.cStat === 656) {
    // 656 em sequência: o bloqueio de 1 h já tinha passado, então algo está errado (outro sistema no
    // mesmo CNPJ, ou bug de agendamento). Depois de MAX_CONSECUTIVE_BLOCKS, desliga.
    const failures = (i.prevStatusCode === 656 ? i.prevFailures : 0) + 1;
    const error = `656 consumo indevido${i.ultNsu !== null ? ` (último NSU conhecido pela SEFAZ: ${i.ultNsu})` : ''}: ${i.xMotivo}`;
    if (failures >= MAX_CONSECUTIVE_BLOCKS) {
      return { outcome: 'DISABLE', nextPollAt: at(i.now, HOUR), failures, error: `${error}. Sincronização desligada após ${failures} bloqueios seguidos` };
    }
    // Consultar antes de 1 h zera a contagem (NT §3.11.4.2), então espera com folga.
    return { outcome: 'BLOCKED', nextPollAt: at(i.now, HOUR + 5 * MIN), failures, error };
  }

  if (CERT_REJECTIONS.has(i.cStat)) {
    return {
      outcome: 'DISABLE',
      nextPollAt: at(i.now, HOUR),
      failures: i.prevFailures + 1,
      error: `Rejeição ${i.cStat}: ${i.xMotivo}. Sincronização desligada; corrija o certificado/CNPJ e ligue de novo`,
    };
  }

  if (i.cStat === 589) {
    // NSU nosso maior que o da SEFAZ: estado corrompido. Não se corrige sozinho (pularia/duplicaria documentos).
    return retry(`589: NSU informado superior ao maior NSU do Ambiente Nacional. ${i.xMotivo}`);
  }

  return retry(`SEFAZ respondeu ${i.cStat}: ${i.xMotivo}`);
}

/** Falha sem resposta da SEFAZ (rede, TLS, timeout, HTTP ≠ 200). */
export function decideTransportFailure(prevFailures: number, now: Date, message: string): Decision {
  const failures = prevFailures + 1;
  return { outcome: 'RETRY', nextPollAt: at(now, backoffMs(failures)), failures, error: message };
}
