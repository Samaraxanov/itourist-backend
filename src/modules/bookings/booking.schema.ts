import { z } from 'zod';

export const createBookingSchema = z
  .object({
    tourId: z.string().min(1),
    // Optional: book a specific departure (seat-managed). If omitted it's an open
    // request and startDate is required.
    departureId: z.string().min(1).optional(),
    startDate: z.coerce.date().optional(),
    peopleCount: z.number().int().positive().max(50).default(1),
    contactName: z.string().min(2).max(120),
    contactPhone: z.string().min(5).max(30),
    contactEmail: z.string().email(),
    note: z.string().max(1000).optional(),
  })
  .refine((v) => v.departureId || v.startDate, {
    message: 'Provide a departure or a start date',
    path: ['startDate'],
  });

export const respondSchema = z.object({
  action: z.enum(['confirm', 'decline']),
  message: z.string().max(1000).optional(),
});

export type CreateBookingInput = z.infer<typeof createBookingSchema>;
export type RespondInput = z.infer<typeof respondSchema>;
