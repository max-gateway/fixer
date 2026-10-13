import { describe, expect, it } from 'vitest';
import { certificateAlert, STALE_MIRROR_MS } from './certificate-alert.js';

const NOW = new Date('2026-10-12T12:00:00Z');
const inDays = (d: number, extraMs = 60_000) => new Date(NOW.getTime() + d * 86_400_000 + extraMs);
const fresh = new Date(NOW.getTime() - 60_000);
const direct = (notAfter: Date) => certificateAlert({ notAfter, mirroredAt: null, viaGateway: false }, NOW);
const viaGw = (notAfter: Date, mirroredAt: Date | null = fresh) => certificateAlert({ notAfter, mirroredAt, viaGateway: true }, NOW);

describe('certificateAlert', () => {
  it('sem alerta com mais de 60 dias', () => {
    expect(direct(inDays(61))).toBeNull();
    expect(viaGw(inDays(200))).toBeNull();
  });

  it.each([
    [60, 'info'],
    [31, 'info'],
    [30, 'warning'],
    [8, 'warning'],
    [7, 'critical'],
    [0, 'critical'],
  ])('faltando %i dias → %s', (days, level) => {
    expect(direct(inDays(days))).toMatchObject({ level, daysLeft: days, stale: false });
  });

  it('vencido: expired com dias negativos, sem arredondar para longe de zero', () => {
    expect(direct(inDays(-2, -60_000))).toMatchObject({ level: 'expired', daysLeft: -2 });
    expect(direct(NOW)).toMatchObject({ level: 'expired', daysLeft: 0 });
  });

  it('modo gateway: espelho velho ou inexistente marca stale, mesmo com validade longa', () => {
    const old = new Date(NOW.getTime() - STALE_MIRROR_MS - 1);
    expect(viaGw(inDays(200), old)).toMatchObject({ level: 'info', stale: true });
    expect(viaGw(inDays(200), null)).toMatchObject({ stale: true });
    expect(viaGw(inDays(5), old)).toMatchObject({ level: 'critical', stale: true });
  });

  it('modo direto nunca é stale (o certificado é local)', () => {
    expect(direct(inDays(5))).toMatchObject({ stale: false });
  });
});
