import { z } from 'zod';

export const createDepartureSchema = z.object({
  tourId: z.string().min(1),
  startDate: z.coerce.date().refine((d) => d > new Date(), 'Departure must be in the future'),
  endDate: z.coerce.date().optional(),
  capacity: z.number().int().positive().max(1000).default(10),
  priceOverride: z.number().int().nonnegative().optional(),
  instantConfirm: z.boolean().default(false),
});

export const updateDepartureSchema = z.object({
  startDate: z.coerce.date().optional(),
  endDate: z.coerce.date().optional(),
  capacity: z.number().int().positive().max(1000).optional(),
  priceOverride: z.number().int().nonnegative().nullable().optional(),
  instantConfirm: z.boolean().optional(),
  status: z.enum(['OPEN', 'CLOSED', 'CANCELLED']).optional(),
});

export const listPublicDeparturesQuerySchema = z.object({
  tourId: z.string().min(1),
});

export type CreateDepartureInput = z.infer<typeof createDepartureSchema>;
export type UpdateDepartureInput = z.infer<typeof updateDepartureSchema>;
