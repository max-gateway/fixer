import { HttpException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { CostProfileProvider } from './cost-profile.provider.js';

const prisma = (cnpj: string | null) => ({ tenantFiscalSettings: { findFirst: async () => (cnpj ? { cnpj } : null) } });
const client = (o: { enabled?: boolean; request?: (...a: unknown[]) => Promise<unknown> }) => ({ enabled: o.enabled ?? true, request: vi.fn(o.request ?? (async () => ({}))) });

describe('CostProfileProvider', () => {
  it('lê os coeficientes da fórmula de uma composição de custo zero', async () => {
    const c = client({
      request: async () => ({
        profileVersion: 3,
        items: [{ confidence: 'ESTIMADO', formula: { unitCost: '0.8000', insidePct: { fixed: '15.0000', variable: '4.1000', financial: '0.5000' } } }],
      }),
    });
    const p = await new CostProfileProvider(prisma('11222333000181') as never, c as never).forPricing();
    expect(p).toEqual({ status: 'OK', version: 3, channel: 'BALCAO', fixedPct: '15.0000', variablePct: '4.1000', financialPct: '0.5000', extraUnitCost: '0.8000', confidence: 'ESTIMADO' });
    expect(c.request).toHaveBeenCalledWith('POST', '/v1/companies/11222333000181/compositions', expect.objectContaining({ channel: 'BALCAO', items: [expect.objectContaining({ unitCost: 0 })] }));
  });

  it('estrutura sem base de rateio vem nula e vira 0', async () => {
    const c = client({ request: async () => ({ profileVersion: 1, items: [{ confidence: 'ESTIMADO', formula: { unitCost: '0', insidePct: { fixed: null, variable: '2', financial: '0' } } }] }) });
    expect(await new CostProfileProvider(prisma('11222333000181') as never, c as never).forPricing()).toMatchObject({ status: 'OK', fixedPct: '0' });
  });

  it('desligado, sem CNPJ, sem perfil publicado ou fora do ar: nunca falha o preço', async () => {
    expect(await new CostProfileProvider(prisma('x') as never, client({ enabled: false }) as never).forPricing()).toEqual({ status: 'OFF' });
    expect(await new CostProfileProvider(prisma(null) as never, client({}) as never).forPricing()).toEqual({ status: 'NONE' });
    const missing = client({ request: async () => Promise.reject(new HttpException({ message: 'sem perfil' }, 409)) });
    expect(await new CostProfileProvider(prisma('x') as never, missing as never).forPricing()).toEqual({ status: 'NONE' });
    const down = client({ request: async () => Promise.reject(new HttpException('fora do ar', 502)) });
    expect(await new CostProfileProvider(prisma('x') as never, down as never).forPricing()).toEqual({ status: 'UNAVAILABLE' });
  });
});
