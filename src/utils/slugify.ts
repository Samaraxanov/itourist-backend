// Simple, dependency-free slugify. Handles Latin + strips diacritics.
// For Cyrillic (uz/ru) titles you may want a transliteration lib later;
// firms usually have a Latin brand name so this is fine for slugs.
export function slugify(input: string): string {
  return input
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '') // strip accents
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60) || 'item';
}

import { customAlphabet } from 'nanoid';
// Human-friendly booking references, e.g. "TM-8F3K2A"
const nano = customAlphabet('ABCDEFGHJKLMNPQRSTUVWXYZ23456789', 6);
export const bookingReference = () => `TM-${nano()}`;
