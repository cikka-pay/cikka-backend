/**
 * Google Cloud Storage — production file storage on GCP.
 * Selected when STORAGE_PROVIDER=gcs.
 *
 * Auth is keyless: on Cloud Run the client uses the service's runtime service
 * account (Application Default Credentials). The org policy forbids service
 * account keys, so HMAC/S3-interop is not an option.
 *   • the runtime SA needs roles/storage.objectAdmin on the bucket
 *   • getSignedUrl() signs via the IAM signBlob API, so the SA also needs
 *     roles/iam.serviceAccountTokenCreator on itself
 *
 * Environment variables:
 *   GCS_BUCKET_NAME        — bucket name
 *   GCS_PROJECT_ID         — optional, inferred from ADC
 *   GCS_KEY_FILE           — optional, local dev only
 *   GCS_SIGNED_URL_EXPIRY  — signed URL TTL in seconds (default: 3600)
 *
 * Like the S3 provider, uploadFile() returns the backend's public file route
 * (GET /api/files/<key>), so URLs stored in the DB don't depend on the bucket.
 */
import { Storage, type Bucket } from "@google-cloud/storage";
import { config } from "../../config/env";
import type { StorageService, StoredObject, UploadOptions, UploadResult } from "./storage.interface";
import { buildKey, publicFileUrl } from "./storage.utils";

let _bucket: Bucket | null = null;

function getBucket(): Bucket {
  if (!_bucket) {
    if (!process.env.GCS_BUCKET_NAME) {
      throw new Error("GCS storage is not configured (GCS_BUCKET_NAME)");
    }
    const storage = new Storage({
      projectId: config.gcsProjectId || undefined,
      keyFilename: config.gcsKeyFile || undefined,
    });
    _bucket = storage.bucket(config.gcsBucketName);
    console.log(`[STORAGE GCS] Initialized — bucket: ${config.gcsBucketName}`);
  }
  return _bucket;
}

function isNotFound(err: unknown): boolean {
  return (err as { code?: number })?.code === 404;
}

export const storageGcs: StorageService = {
  async uploadFile(options: UploadOptions): Promise<UploadResult> {
    const key = buildKey(options);
    await getBucket()
      .file(key)
      .save(options.buffer, {
        resumable: false,
        contentType: options.mimeType,
        metadata: options.metadata ? { metadata: options.metadata } : undefined,
      });

    console.log(`[STORAGE GCS] Uploaded: ${key} (${options.buffer.length} bytes, ${options.mimeType})`);

    return {
      url: publicFileUrl(key),
      key,
      bucket: config.gcsBucketName,
      size: options.buffer.length,
      mimeType: options.mimeType,
    };
  },

  async deleteFile(key: string): Promise<void> {
    await getBucket().file(key).delete({ ignoreNotFound: true });
    console.log(`[STORAGE GCS] Deleted: ${key}`);
  },

  async getSignedUrl(key: string, expiresInSeconds?: number): Promise<string> {
    const ttl = expiresInSeconds ?? config.gcsSignedUrlExpiry;
    const [url] = await getBucket()
      .file(key)
      .getSignedUrl({ version: "v4", action: "read", expires: Date.now() + ttl * 1000 });
    return url;
  },

  async getObject(key: string): Promise<StoredObject | null> {
    const file = getBucket().file(key);
    try {
      const [meta] = await file.getMetadata();
      return {
        body: file.createReadStream(),
        contentType: meta.contentType,
        contentLength: meta.size !== undefined ? Number(meta.size) : undefined,
        etag: meta.etag,
      };
    } catch (err) {
      if (isNotFound(err)) return null;
      throw err;
    }
  },

  async exists(key: string): Promise<boolean> {
    const [exists] = await getBucket().file(key).exists();
    return exists;
  },
};
