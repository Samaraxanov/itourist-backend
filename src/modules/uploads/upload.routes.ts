import path from 'node:path';
import fs from 'node:fs';
import crypto from 'node:crypto';
import { Router } from 'express';
import type { Request, Response } from 'express';
import multer from 'multer';
import { env } from '../../config/env.js';
import { ApiError } from '../../utils/apiError.js';
import { authenticate } from '../../middleware/authenticate.js';
import { authorize } from '../../middleware/authorize.js';

// Local, mock object storage. In production this route is replaced by
// direct-to-cloud uploads (S3/Cloudinary presigned URLs); the client contract
// (POST files → receive URLs) stays the same.

const uploadDir = path.resolve(process.cwd(), env.UPLOAD_DIR);
fs.mkdirSync(uploadDir, { recursive: true });

const ALLOWED = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/avif']);

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, uploadDir),
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase() || '.jpg';
    cb(null, `${Date.now()}-${crypto.randomBytes(6).toString('hex')}${ext}`);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024, files: 10 }, // 5MB each, up to 10
  fileFilter: (_req, file, cb) => {
    if (ALLOWED.has(file.mimetype)) cb(null, true);
    else cb(new ApiError(400, 'Only JPEG, PNG, WebP or AVIF images are allowed', 'BAD_REQUEST'));
  },
});

const router = Router();

// Firms upload tour/firm imagery. Returns absolute URLs served from /uploads.
router.post(
  '/',
  authenticate,
  authorize('FIRM', 'ADMIN'),
  upload.array('files', 10),
  (req: Request, res: Response) => {
    const files = (req.files as Express.Multer.File[] | undefined) ?? [];
    if (files.length === 0) throw ApiError.badRequest('No files uploaded (field name must be "files")');
    const urls = files.map((f) => `${env.PUBLIC_BASE_URL}/uploads/${f.filename}`);
    res.status(201).json({ urls });
  }
);

export default router;
