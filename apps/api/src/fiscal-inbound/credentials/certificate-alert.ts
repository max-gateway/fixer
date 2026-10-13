export type CertificateAlertLevel = 'info' | 'warning' | 'critical' | 'expired';

export interface CertificateAlert {
  level: CertificateAlertLevel;
  /** Dias inteiros que faltam (0 = menos de 24 h); negativo = venceu há tantos dias. */
  daysLeft: number;
  notAfter: Date;
  /** Modo gateway sem confirmação recente: a validade mostrada pode estar desatualizada. */
  stale: boolean;
}

const DAY_MS = 86_400_000;
/** Mesmos limites do dfe-gateway (`expiry_state`): 60 → aviso, 30 → atenção, 7 → crítico. */
const INFO_DAYS = 60;
const WARNING_DAYS = 30;
const CRITICAL_DAYS = 7;
/** Espelho mais velho que isto vira "não foi possível confirmar" (o consumidor roda a cada ~1 min). */
export const STALE_MIRROR_MS = DAY_MS;

export interface AlertInput {
  notAfter: Date;
  /** Última confirmação com o gateway; `null` quando o certificado vive localmente (modo direto). */
  mirroredAt: Date | null;
  viaGateway: boolean;
}

/**
 * Alerta de vencimento para o banner. Devolve `null` quando está tudo certo (mais de 60 dias e espelho em dia).
 * Função pura: o relógio entra por parâmetro e o front só renderiza o que recebe.
 */
export function certificateAlert(input: AlertInput, now: Date = new Date()): CertificateAlert | null {
  const diff = input.notAfter.getTime() - now.getTime();
  const daysLeft = Math.trunc(diff / DAY_MS) || 0;
  const stale = input.viaGateway && (!input.mirroredAt || now.getTime() - input.mirroredAt.getTime() > STALE_MIRROR_MS);

  const level: CertificateAlertLevel | null =
    diff <= 0 ? 'expired' : daysLeft <= CRITICAL_DAYS ? 'critical' : daysLeft <= WARNING_DAYS ? 'warning' : daysLeft <= INFO_DAYS ? 'info' : null;
  if (!level) return stale ? { level: 'info', daysLeft, notAfter: input.notAfter, stale } : null;
  return { level, daysLeft, notAfter: input.notAfter, stale };
}
