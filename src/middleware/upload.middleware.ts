/**
 * Centralized Multer upload middleware.
 *
 * Uses memory storage so file buffers can be streamed directly to cloud
 * storage without touching disk. Provides reusable presets and helpers
 * for MIME-type filtering and size limits.
 *
 * Usage in routes:
 *   import { uploadImage, createUpload } from "../middleware/upload.middleware";
 *   router.post("/avatar", uploadImage, controller);
 *   router.post("/doc", createUpload({ field: "document", maxSizeMB: 10, allowedMimes: DOC_MIMES }).single, controller);
 */
import multer, { type MulterError } from "multer";
import type { Request, Response, NextFunction, RequestHandler } from "express";
import { UPLOAD_ERRORS } from "../constants/errors";

// ── Allowed MIME type sets ──────────────────────────────────────────────────

export const IMAGE_MIMES = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
  "image/svg+xml",
];

export const DOC_MIMES = [
  "application/pdf",
  "image/jpeg",
  "image/png",
];

export const ALL_SUPPORTED_MIMES = [...new Set([...IMAGE_MIMES, ...DOC_MIMES])];

// ── Factory ─────────────────────────────────────────────────────────────────

interface UploadConfig {
  /** Form field name (default: "file") */
  field?: string;
  /** Maximum file size in MB (default: 5) */
  maxSizeMB?: number;
  /** Allowed MIME types. If empty / undefined, all types are accepted. */
  allowedMimes?: string[];
  /** Maximum number of files for multi-upload (default: 1) */
  maxCount?: number;
}

/**
 * Create a configured multer instance with MIME-type filtering.
 * Returns an object with `.single` and `.array` middleware.
 */
export function createUpload(cfg: UploadConfig = {}) {
  const {
    field = "file",
    maxSizeMB = 5,
    allowedMimes,
    maxCount = 1,
  } = cfg;

  const upload = multer({
    storage: multer.memoryStorage(),
    limits: {
      fileSize: maxSizeMB * 1024 * 1024,
    },
    fileFilter: allowedMimes?.length
      ? (_req, file, cb) => {
          if (allowedMimes.includes(file.mimetype)) {
            cb(null, true);
          } else {
            cb(new Error(UPLOAD_ERRORS.INVALID_MIME_TYPE(allowedMimes)));
          }
        }
      : undefined,
  });

  return {
    /** Single-file upload middleware */
    single: upload.single(field) as RequestHandler,
    /** Multi-file upload middleware */
    array: upload.array(field, maxCount) as RequestHandler,
  };
}

// ── Pre-built presets ───────────────────────────────────────────────────────

/** Single image upload, max 5 MB, field = "image" */
export const uploadImage = createUpload({
  field: "image",
  maxSizeMB: 5,
  allowedMimes: IMAGE_MIMES,
}).single;

/** Single document upload, max 10 MB, field = "document" */
export const uploadDocument = createUpload({
  field: "document",
  maxSizeMB: 10,
  allowedMimes: DOC_MIMES,
}).single;

/** Single logo upload, max 2 MB, field = "logo" */
export const uploadLogo = createUpload({
  field: "logo",
  maxSizeMB: 2,
  allowedMimes: IMAGE_MIMES,
}).single;

/** Generic single file upload, max 5 MB, field = "file", any type */
export const uploadFile = createUpload({
  field: "file",
  maxSizeMB: 5,
}).single;

// ── Error handler ───────────────────────────────────────────────────────────

/**
 * Express error-handling middleware for Multer errors.
 * Place after multer middleware in the route chain, or use globally.
 */
export function handleMulterError(
  err: Error,
  _req: Request,
  res: Response,
  next: NextFunction
): void {
  if ((err as MulterError).code === "LIMIT_FILE_SIZE") {
    res.status(413).json({ error: (err as MulterError).message || "File too large" });
    return;
  }
  if (err.message && err.message.startsWith("Invalid file type")) {
    res.status(415).json({ error: err.message });
    return;
  }
  next(err);
}
