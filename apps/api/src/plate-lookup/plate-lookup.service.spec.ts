import { Test, TestingModule } from '@nestjs/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PrismaService } from '../prisma/prisma.service.js';
import { PlateLookupClient } from './plate-lookup.client.js';
import { InvalidPlateError, PlateLookupService } from './plate-lookup.service.js';
import type { PlateLookupResult } from './schema.js';

const fakeResult: PlateLookupResult = {
  error: false,
  message: 'ok',
  basico: {
    error: false,
    dados: { marca: 'FIAT', modelo: 'UNO', ano: 2020 },
  },
};

describe('PlateLookupService', () => {
  let service: PlateLookupService;
  let prisma: { plateLookup: { findUnique: ReturnType<typeof vi.fn>; upsert: ReturnType<typeof vi.fn> } };
  let client: { consultaPlaca: ReturnType<typeof vi.fn> };

  beforeEach(async () => {
    prisma = {
      plateLookup: {
        findUnique: vi.fn(),
        upsert: vi.fn(),
      },
    };
    client = {
      consultaPlaca: vi.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PlateLookupService,
        { provide: PrismaService, useValue: prisma },
        { provide: PlateLookupClient, useValue: client },
      ],
    }).compile();

    service = module.get(PlateLookupService);
  });

  it('rejects a malformed plate without calling anything', async () => {
    await expect(service.lookup('AB1')).rejects.toBeInstanceOf(InvalidPlateError);
    expect(prisma.plateLookup.findUnique).not.toHaveBeenCalled();
    expect(client.consultaPlaca).not.toHaveBeenCalled();
  });

  it('returns the cached record without calling the external service again', async () => {
    const queriedAt = new Date('2026-01-01T00:00:00Z');
    prisma.plateLookup.findUnique.mockResolvedValue({
      plate: 'ABC1D23',
      rawResponse: fakeResult,
      queriedAt,
    });

    const record = await service.lookup('abc-1d23');

    expect(record.cached).toBe(true);
    expect(record.plate).toBe('ABC1D23');
    expect(record.result).toEqual(fakeResult);
    expect(client.consultaPlaca).not.toHaveBeenCalled();
    expect(prisma.plateLookup.upsert).not.toHaveBeenCalled();
  });

  it('calls the external service and persists the result on first lookup', async () => {
    prisma.plateLookup.findUnique.mockResolvedValue(null);
    client.consultaPlaca.mockResolvedValue(fakeResult);
    prisma.plateLookup.upsert.mockResolvedValue({
      plate: 'ABC1D23',
      queriedAt: new Date('2026-01-01T00:00:00Z'),
    });

    const record = await service.lookup('ABC1D23');

    expect(client.consultaPlaca).toHaveBeenCalledWith('ABC1D23');
    expect(prisma.plateLookup.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { plate: 'ABC1D23' },
        create: expect.objectContaining({ plate: 'ABC1D23', brand: 'FIAT', model: 'UNO', year: 2020 }),
      }),
    );
    expect(record.cached).toBe(false);
    expect(record.result).toEqual(fakeResult);
  });
});
