/**
 * Storage Stub — local filesystem implementation for dev / test.
 * Used when STORAGE_PROVIDER=local (the default when no S3 bucket is configured).
 *
 * Files are saved to $LOCAL_UPLOADS_DIR (default /tmp/uploads)/{folder}/{entityId}/{timestamp}-{filename}
 * and served back through GET /api/files/<key>.
 * No real cloud interaction; safe for offline development and CI.
 */
import fs from "fs";
import path from "path";
import type { StorageService, StoredObject, UploadOptions, UploadResult } from "./storage.interface";
import { buildKey, isSafeKey, publicFileUrl } from "./storage.utils";

const UPLOADS_ROOT = process.env.LOCAL_UPLOADS_DIR || path.join("/tmp", "uploads");

/** Resolve a key to a path inside UPLOADS_ROOT, or null if the key is unsafe. */
function resolveKey(key: string): string | null {
  return isSafeKey(key) ? path.join(UPLOADS_ROOT, key) : null;
}

const MIME_BY_EXT: Record<string, string> = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".svg": "image/svg+xml",
  ".pdf": "application/pdf",
};

export const storageStub: StorageService = {
  async uploadFile(options: UploadOptions): Promise<UploadResult> {
    const key = buildKey(options);
    const filePath = path.join(UPLOADS_ROOT, key);
    const dir = path.dirname(filePath);

    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    fs.writeFileSync(filePath, options.buffer);

    // Also mirror to project uploads directory so the developer can see it locally
    try {
      const projectFilePath = path.join(process.cwd(), "uploads", key);
      const projectDir = path.dirname(projectFilePath);
      if (!fs.existsSync(projectDir)) {
        fs.mkdirSync(projectDir, { recursive: true });
      }
      fs.writeFileSync(projectFilePath, options.buffer);
    } catch {}

    const url = publicFileUrl(key);
    console.log(`[STORAGE STUB] Uploaded: ${url} (${options.buffer.length} bytes, ${options.mimeType})`);

    return {
      url,
      key,
      bucket: "local",
      size: options.buffer.length,
      mimeType: options.mimeType,
    };
  },

  async deleteFile(key: string): Promise<void> {
    const filePath = resolveKey(key);
    if (filePath && fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
      console.log(`[STORAGE STUB] Deleted: ${key}`);
    } else {
      console.warn(`[STORAGE STUB] File not found for deletion: ${key}`);
    }
    try {
      const projectFilePath = path.join(process.cwd(), "uploads", key);
      if (fs.existsSync(projectFilePath)) {
        fs.unlinkSync(projectFilePath);
      }
    } catch {}
  },

  async getSignedUrl(key: string, _expiresInSeconds?: number): Promise<string> {
    // In stub mode, just return the public file route — no actual signing
    const url = publicFileUrl(key);
    console.log(`[STORAGE STUB] Signed URL (stub): ${url}`);
    return url;
  },

  async getObject(key: string): Promise<StoredObject | null> {
    const filePath = resolveKey(key);
    if (!filePath || !fs.existsSync(filePath)) return null;
    return {
      body: fs.createReadStream(filePath),
      contentType: MIME_BY_EXT[path.extname(filePath).toLowerCase()] ?? "application/octet-stream",
      contentLength: fs.statSync(filePath).size,
    };
  },

  async exists(key: string): Promise<boolean> {
    const filePath = resolveKey(key);
    const found = !!filePath && fs.existsSync(filePath);
    console.log(`[STORAGE STUB] Exists check: ${key} → ${found}`);
    return found;
  },
};
