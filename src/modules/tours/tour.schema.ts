import { z } from 'zod';

// Multilingual field: at least the default locale should be present.
const multilingual = z.object({
  uz: z.string().optional(),
  ru: z.string().optional(),
  en: z.string().optional(),
});

const multilingualList = z.object({
  uz: z.array(z.string()).optional(),
  ru: z.array(z.string()).optional(),
  en: z.array(z.string()).optional(),
});

export const createTourSchema = z.object({
  title: multilingual.refine((v) => v.uz || v.ru || v.en, 'Provide a title in at least one language'),
  summary: multilingual.optional(),
  description: multilingual.optional(),
  itinerary: z.array(z.record(z.any())).optional(),
  priceFrom: z.number().int().nonnegative(),
  currency: z.enum(['UZS', 'USD', 'EUR']).default('UZS'),
  durationDays: z.number().int().positive().default(1),
  durationHours: z.number().int().positive().optional(),
  maxGroupSize: z.number().int().positive().optional(),
  minAge: z.number().int().nonnegative().optional(),
  languages: z.array(z.enum(['uz', 'ru', 'en'])).default([]),
  categoryId: z.string().optional(),
  regionId: z.string().optional(),
  images: z.array(z.string().url()).max(20).default([]),
  included: multilingualList.optional(),
  excluded: multilingualList.optional(),
});

// All fields optional on update.
export const updateTourSchema = createTourSchema.partial();

// Public listing filters. Coerced from query strings.
export const listToursQuerySchema = z.object({
  q: z.string().trim().min(1).optional(), // free-text search
  regionId: z.string().optional(),
  categoryId: z.string().optional(),
  minPrice: z.coerce.number().int().nonnegative().optional(),
  maxPrice: z.coerce.number().int().nonnegative().optional(),
  minDuration: z.coerce.number().int().positive().optional(),
  maxDuration: z.coerce.number().int().positive().optional(),
  language: z.enum(['uz', 'ru', 'en']).optional(), // guide language
  firmId: z.string().optional(),
  sort: z.enum(['newest', 'price_asc', 'price_desc', 'rating']).default('newest'),
  page: z.coerce.number().int().positive().default(1),
  pageSize: z.coerce.number().int().positive().max(48).default(12),
});

export const tourParamsSchema = z.object({ id: z.string().min(1) });
export const publishSchema = z.object({ publish: z.boolean() });

export type CreateTourInput = z.infer<typeof createTourSchema>;
export type UpdateTourInput = z.infer<typeof updateTourSchema>;
export type ListToursQuery = z.infer<typeof listToursQuerySchema>;
