/**
 * Google Cloud Storage adapter — real implementation.
 * Used when EXTERNAL_SERVICES_MODE=real.
 *
 * Environment variables:
 *   GCS_PROJECT_ID       — GCP project ID
 *   GCS_BUCKET_NAME      — target bucket (default: "cikka-uploads-dev")
 *   GCS_KEY_FILE         — path to service account JSON (omit for ADC)
 *   GCS_SIGNED_URL_EXPIRY — signed URL TTL in seconds (default: 3600)
 */
import { Storage, type Bucket } from "@google-cloud/storage";
import { config } from "../../config/env";
import type { StorageService, UploadOptions, UploadResult } from "./storage.interface";

// ── Lazy singleton ──────────────────────────────────────────────────────────

let _storage: Storage | null = null;
let _bucket: Bucket | null = null;

function getBucket(): Bucket {
  if (!_bucket) {
    const storageOpts: ConstructorParameters<typeof Storage>[0] = {};

    if (config.gcsProjectId) {
      storageOpts.projectId = config.gcsProjectId;
    }
    if (config.gcsKeyFile) {
      storageOpts.keyFilename = config.gcsKeyFile;
    }
    // If neither is set, the SDK falls back to Application Default Credentials (ADC).

    _storage = new Storage(storageOpts);
    _bucket = _storage.bucket(config.gcsBucketName);

    console.log(
      `[STORAGE GCS] Initialized — bucket: ${config.gcsBucketName}, ` +
        `project: ${config.gcsProjectId || "(ADC)"}`
    );
  }
  return _bucket;
}

// ── Helpers ─────────────────────────────────────────────────────────────────

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

// ── Implementation ──────────────────────────────────────────────────────────

export const storageGcs: StorageService = {
  async uploadFile(options: UploadOptions): Promise<UploadResult> {
    const bucket = getBucket();
    const key = buildKey(options);
    const file = bucket.file(key);

    // Stream the buffer into GCS
    await new Promise<void>((resolve, reject) => {
      const stream = file.createWriteStream({
        resumable: false, // small files don't need resumable uploads
        contentType: options.mimeType,
        metadata: {
          metadata: options.metadata || {},
        },
      });

      stream.on("error", reject);
      stream.on("finish", resolve);
      stream.end(options.buffer);
    });

    // Optionally make the file public
    if (options.public) {
      await file.makePublic();
    }

    // Determine the access URL
    let url: string;
    if (options.public) {
      url = `https://storage.googleapis.com/${config.gcsBucketName}/${key}`;
    } else {
      // Generate a signed URL for private files
      const [signedUrl] = await file.getSignedUrl({
        version: "v4",
        action: "read",
        expires: Date.now() + config.gcsSignedUrlExpiry * 1000,
      });
      url = signedUrl;
    }

    console.log(
      `[STORAGE GCS] Uploaded: ${key} (${options.buffer.length} bytes, ` +
        `${options.mimeType}, public=${!!options.public})`
    );

    return {
      url,
      key,
      bucket: config.gcsBucketName,
      size: options.buffer.length,
      mimeType: options.mimeType,
    };
  },

  async deleteFile(key: string): Promise<void> {
    const bucket = getBucket();
    const file = bucket.file(key);

    const [fileExists] = await file.exists();
    if (!fileExists) {
      console.warn(`[STORAGE GCS] File not found for deletion: ${key}`);
      return;
    }

    await file.delete();
    console.log(`[STORAGE GCS] Deleted: ${key}`);
  },

  async getSignedUrl(key: string, expiresInSeconds?: number): Promise<string> {
    const bucket = getBucket();
    const file = bucket.file(key);

    const ttl = expiresInSeconds ?? config.gcsSignedUrlExpiry;
    const [signedUrl] = await file.getSignedUrl({
      version: "v4",
      action: "read",
      expires: Date.now() + ttl * 1000,
    });

    console.log(`[STORAGE GCS] Signed URL for: ${key} (expires in ${ttl}s)`);
    return signedUrl;
  },

  async exists(key: string): Promise<boolean> {
    const bucket = getBucket();
    const file = bucket.file(key);
    const [fileExists] = await file.exists();
    return fileExists;
  },
};
