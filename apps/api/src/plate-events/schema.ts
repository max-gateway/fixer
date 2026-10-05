import { z } from 'zod';

/**
 * Espelha app/models/schemas.py::PlateEvent do microservice apps/plate-reader
 * (Python). Mantenha os dois em sincronia manualmente — não há geração de
 * schema compartilhado entre os dois serviços.
 */

export const PlateFormatSchema = z.enum(['mercosul', 'legacy_br', 'unknown']);

export const RecognitionStatusSchema = z.enum([
  'accepted',
  'pending_vote',
  'rejected',
]);

export const CandidatePlateSchema = z.object({
  plate: z.string(),
  confidence: z.number().min(0).max(100),
});

export const RecognitionResultSchema = z.object({
  plate: z.string().nullable(),
  plate_format: PlateFormatSchema,
  confidence: z.number().min(0).max(100),
  status: RecognitionStatusSchema,
  frames_used: z.number().int().nonnegative(),
  raw_candidates: z.array(CandidatePlateSchema),
});

export const PlateEventSchema = z.object({
  request_id: z.string(),
  location_id: z.string(),
  vehicle_track_id: z.string().nullable(),
  result: RecognitionResultSchema,
  captured_at: z.string().datetime({ offset: true }).nullable(),
  processed_at: z.string().datetime({ offset: true }),
});

export type PlateEvent = z.infer<typeof PlateEventSchema>;
