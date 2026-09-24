/**
 * Storage Stub — local filesystem implementation for dev / test.
 * Used when EXTERNAL_SERVICES_MODE=stub (default).
 *
 * Files are saved to /tmp/uploads/{folder}/{entityId}/{timestamp}-{filename}.
 * No real cloud interaction; safe for offline development and CI.
 */
import fs from "fs";
import path from "path";
import type { StorageService, UploadOptions, UploadResult } from "./storage.interface";

const UPLOADS_ROOT = path.join("/tmp", "uploads");

/** Sanitize a filename to prevent path traversal and weird characters. */
function sanitizeFilename(name: string): string {
  return name.replace(/[^a-zA-Z0-9._-]/g, "_");
}

/** Build the storage key (object path) from upload options. */
function buildKey(options: UploadOptions): string {
  const timestamp = Date.now();
  const safeName = sanitizeFilename(options.filename);
  const parts: string[] = [];

  if (options.folder) parts.push(options.folder);
  if (options.entityId) parts.push(options.entityId);
  parts.push(`${timestamp}-${safeName}`);

  return parts.join("/");
}

export const storageStub: StorageService = {
  async uploadFile(options: UploadOptions): Promise<UploadResult> {
    const key = buildKey(options);
    const filePath = path.join(UPLOADS_ROOT, key);
    const dir = path.dirname(filePath);

    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    fs.writeFileSync(filePath, options.buffer);

    const url = `/uploads/${key}`;
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
    const filePath = path.join(UPLOADS_ROOT, key);
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
      console.log(`[STORAGE STUB] Deleted: ${key}`);
    } else {
      console.warn(`[STORAGE STUB] File not found for deletion: ${key}`);
    }
  },

  async getSignedUrl(key: string, _expiresInSeconds?: number): Promise<string> {
    // In stub mode, just return the local path — no actual signing
    const url = `/uploads/${key}`;
    console.log(`[STORAGE STUB] Signed URL (stub): ${url}`);
    return url;
  },

  async exists(key: string): Promise<boolean> {
    const filePath = path.join(UPLOADS_ROOT, key);
    const found = fs.existsSync(filePath);
    console.log(`[STORAGE STUB] Exists check: ${key} → ${found}`);
    return found;
  },
};
