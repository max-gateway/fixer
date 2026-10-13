import { shortDate } from './invoices';

// Alerta de vencimento do certificado (GET /fiscal/certificate-alert). Datas chegam como string no JSON.
export type CertificateAlert = {
  level: 'info' | 'warning' | 'critical' | 'expired';
  daysLeft: number;
  notAfter: string;
  stale: boolean;
};

export type AlertCopy = {
  tone: 'info' | 'warn' | 'error';
  title: string;
  detail: string;
  /** Aviso crítico ou certificado vencido não some: dispensar esconderia justamente o que para a busca de notas. */
  dismissible: boolean;
};

/** Acima disto o alerta existe só porque o espelho está velho (a validade em si está longe). */
const FAR_DAYS = 60;

const plural = (n: number) => `${n} ${n === 1 ? 'dia' : 'dias'}`;

/** Texto do banner. O nível vem da API; aqui só se escolhe palavra e tom. */
export function alertCopy(a: CertificateAlert): AlertCopy {
  const until = shortDate(a.notAfter);
  const staleNote = a.stale ? ' Não conseguimos confirmar este dado recentemente, então ele pode estar desatualizado.' : '';

  if (a.level === 'expired') {
    const ago = a.daysLeft < 0 ? ` há ${plural(-a.daysLeft)}` : '';
    return {
      tone: 'error',
      title: `O certificado digital venceu${ago}.`,
      detail: `A busca de notas fiscais está parada. Envie o certificado renovado para voltar a receber as notas.${staleNote}`,
      dismissible: false,
    };
  }
  if (a.level === 'critical') {
    const when = a.daysLeft === 0 ? 'vence nas próximas 24 horas' : `vence em ${plural(a.daysLeft)}`;
    return {
      tone: 'error',
      title: `O certificado digital ${when} (${until}).`,
      detail: `Renove agora: depois de vencer, a busca de notas fiscais para.${staleNote}`,
      dismissible: false,
    };
  }
  if (a.daysLeft > FAR_DAYS) {
    return {
      tone: 'warn',
      title: 'Não foi possível confirmar a validade do certificado digital.',
      detail: 'A última conferência com o serviço de notas fiscais foi há mais de 24 horas. A busca de notas pode estar parada.',
      dismissible: true,
    };
  }
  return {
    tone: a.level === 'warning' ? 'warn' : 'info',
    title: `O certificado digital vence em ${plural(a.daysLeft)} (${until}).`,
    detail: `Providencie a renovação com antecedência para não interromper a busca de notas fiscais.${staleNote}`,
    dismissible: true,
  };
}

/** Chave de "dispensado": muda com o nível e com o certificado, então o aviso volta quando piora ou após renovar. */
export const dismissKey = (orgId: string, a: Pick<CertificateAlert, 'level' | 'notAfter' | 'daysLeft'>) =>
  `cert-alert:${orgId}:${a.notAfter}:${a.daysLeft > FAR_DAYS ? 'stale' : a.level}`;
