/**
 * Helpers shared by every storage provider.
 */
import { config } from "../../config/env";
import type { UploadOptions } from "./storage.interface";

/** Sanitize a filename to prevent path traversal and weird characters. */
export function sanitizeFilename(name: string): string {
  return name.replace(/[^a-zA-Z0-9._-]/g, "_");
}

/** Build the storage key (object path) from upload options. */
export function buildKey(options: UploadOptions): string {
  const timestamp = Date.now();
  const safeName = sanitizeFilename(options.filename);
  const parts: string[] = [];

  if (options.folder) parts.push(sanitizeFilename(options.folder));
  if (options.entityId) parts.push(sanitizeFilename(options.entityId));
  parts.push(`${timestamp}-${safeName}`);

  return parts.join("/");
}

/**
 * Stable public URL for a stored file, served by GET /api/files/<key>.
 * Absolute when PUBLIC_BASE_URL (or Railway's RAILWAY_PUBLIC_DOMAIN) is known,
 * so the dashboard and mobile app can load it from any origin.
 */
export function publicFileUrl(key: string): string {
  const encoded = key.split("/").map(encodeURIComponent).join("/");
  return `${config.publicBaseUrl}/api/files/${encoded}`;
}

/** Reject keys that could escape the storage root (used by the local provider and file route). */
export function isSafeKey(key: string): boolean {
  if (!key || key.length > 512) return false;
  return key.split("/").every((part) => part !== "" && part !== "." && part !== ".." && /^[a-zA-Z0-9._-]+$/.test(part));
}
