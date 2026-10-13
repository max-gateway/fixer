import { describe, expect, it } from 'vitest';
import { alertCopy, dismissKey, type CertificateAlert } from './certificate-alert';

const alert = (over: Partial<CertificateAlert>): CertificateAlert => ({ level: 'info', daysLeft: 45, notAfter: '2026-11-26T12:00:00Z', stale: false, ...over });

describe('alertCopy', () => {
  it('60 dias: informativo e dispensável', () => {
    const c = alertCopy(alert({ level: 'info', daysLeft: 45 }));
    expect(c).toMatchObject({ tone: 'info', dismissible: true });
    expect(c.title).toContain('vence em 45 dias');
  });

  it('30 dias: atenção, ainda dispensável', () => {
    expect(alertCopy(alert({ level: 'warning', daysLeft: 12 }))).toMatchObject({ tone: 'warn', dismissible: true });
  });

  it('7 dias: crítico e NÃO dispensável; singular e "24 horas"', () => {
    expect(alertCopy(alert({ level: 'critical', daysLeft: 1 }))).toMatchObject({ tone: 'error', dismissible: false });
    expect(alertCopy(alert({ level: 'critical', daysLeft: 1 })).title).toContain('vence em 1 dia ');
    expect(alertCopy(alert({ level: 'critical', daysLeft: 0 })).title).toContain('próximas 24 horas');
  });

  it('vencido: erro, não dispensável, diz há quantos dias e que a busca parou', () => {
    const c = alertCopy(alert({ level: 'expired', daysLeft: -3 }));
    expect(c).toMatchObject({ tone: 'error', dismissible: false });
    expect(c.title).toContain('há 3 dias');
    expect(c.detail).toContain('parada');
    expect(alertCopy(alert({ level: 'expired', daysLeft: 0 })).title).not.toContain('há');
  });

  it('só espelho velho (validade longe): pede conferência em vez de inventar prazo', () => {
    const c = alertCopy(alert({ level: 'info', daysLeft: 200, stale: true }));
    expect(c.title).toContain('Não foi possível confirmar');
    expect(c.title).not.toContain('vence em');
  });

  it('espelho velho com prazo curto avisa que o dado pode estar desatualizado', () => {
    expect(alertCopy(alert({ level: 'critical', daysLeft: 3, stale: true })).detail).toContain('desatualizado');
  });
});

describe('dismissKey', () => {
  it('muda com o nível, com a renovação e com a organização', () => {
    const a = alert({ level: 'info', daysLeft: 45 });
    expect(dismissKey('o1', a)).not.toBe(dismissKey('o1', { ...a, level: 'warning' }));
    expect(dismissKey('o1', a)).not.toBe(dismissKey('o1', { ...a, notAfter: '2027-11-26T12:00:00Z' }));
    expect(dismissKey('o1', a)).not.toBe(dismissKey('o2', a));
  });
});
