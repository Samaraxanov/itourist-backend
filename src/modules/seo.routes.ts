import { Router } from 'express';
import type { Request, Response } from 'express';
import { prisma } from '../lib/prisma.js';
import { catchAsync } from '../utils/catchAsync.js';
import { env } from '../config/env.js';

// SEO surface: robots.txt + a sitemap of every public tour and firm, pointing at
// the front-end site. Mounted at the app root (not under /api/v1).
const router = Router();

// Front-end origin (first CORS origin), where the public pages actually live.
const siteBase = env.CORS_ORIGIN.split(',')[0].trim().replace(/\/$/, '');

router.get('/robots.txt', (_req: Request, res: Response) => {
  res.type('text/plain').send(`User-agent: *\nAllow: /\nSitemap: ${env.PUBLIC_BASE_URL}/sitemap.xml\n`);
});

router.get(
  '/sitemap.xml',
  catchAsync(async (_req: Request, res: Response) => {
    const [tours, firms] = await Promise.all([
      prisma.tour.findMany({
        where: { status: 'PUBLISHED', deletedAt: null },
        select: { slug: true, updatedAt: true },
        orderBy: { updatedAt: 'desc' },
        take: 5000,
      }),
      prisma.firm.findMany({
        where: { status: 'VERIFIED' },
        select: { slug: true, updatedAt: true },
        take: 5000,
      }),
    ]);

    const url = (loc: string, lastmod: Date) =>
      `  <url><loc>${loc}</loc><lastmod>${lastmod.toISOString()}</lastmod></url>`;

    const urls = [
      `  <url><loc>${siteBase}/</loc></url>`,
      ...tours.map((t) => url(`${siteBase}/tours/${t.slug}`, t.updatedAt)),
      ...firms.map((f) => url(`${siteBase}/firms/${f.slug}`, f.updatedAt)),
    ].join('\n');

    res
      .type('application/xml')
      .send(`<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>\n`);
  })
);

export default router;
