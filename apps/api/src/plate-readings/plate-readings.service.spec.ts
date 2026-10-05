import { afterEach, describe, expect, it, vi } from 'vitest';
import { BadGatewayException } from '@nestjs/common';
import { PlateReadingsService } from './plate-readings.service.js';

const image = { buffer: Buffer.from([1, 2, 3]), mimetype: 'image/jpeg', originalname: 'p.jpg' };

afterEach(() => vi.unstubAllGlobals());

describe('PlateReadingsService', () => {
  it('envia a imagem ao reader e devolve o request_id', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ request_id: 'r1' }), { status: 202 }));
    vi.stubGlobal('fetch', fetchMock);
    const service = new PlateReadingsService({} as never);

    await expect(service.submit(image)).resolves.toEqual({ requestId: 'r1' });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toMatch(/\/v1\/recognize$/);
    expect((init.body as FormData).get('location_id')).toBe('balcao');
    expect((init.body as FormData).getAll('frames')).toHaveLength(1);
  });

  it('vira 502 se o reader falha ou está fora', async () => {
    const service = new PlateReadingsService({} as never);
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('boom', { status: 500 })));
    await expect(service.submit(image)).rejects.toBeInstanceOf(BadGatewayException);
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('ECONNREFUSED')));
    await expect(service.submit(image)).rejects.toBeInstanceOf(BadGatewayException);
  });

  it('result devolve processing até o evento chegar', async () => {
    const get = vi.fn().mockResolvedValueOnce(null).mockResolvedValueOnce({ status: 'accepted', plate: 'ABC1D23' });
    const service = new PlateReadingsService({ get } as never);
    await expect(service.result('r1')).resolves.toEqual({ status: 'processing' });
    await expect(service.result('r1')).resolves.toMatchObject({ requestId: 'r1', status: 'accepted', plate: 'ABC1D23' });
  });
});
