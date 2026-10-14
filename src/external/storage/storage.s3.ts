/**
 * S3-compatible storage adapter — used for Railway Buckets (or any S3 API:
 * AWS S3, Cloudflare R2, MinIO).
 * Selected when STORAGE_PROVIDER=s3 (or S3_BUCKET is set).
 *
 * Environment variables:
 *   S3_ENDPOINT          — e.g. https://storage.railway.app (omit for AWS)
 *   S3_REGION            — bucket region (default: "auto")
 *   S3_BUCKET            — bucket name
 *   S3_ACCESS_KEY_ID     — access key
 *   S3_SECRET_ACCESS_KEY — secret key
 *   S3_FORCE_PATH_STYLE  — "true" for MinIO-style path addressing (default: false)
 *   S3_SIGNED_URL_EXPIRY — signed URL TTL in seconds (default: 3600)
 *
 * Railway Buckets are private, so the URL returned by uploadFile() points at
 * the backend's public file route (GET /api/files/<key>), which streams the
 * object from the bucket. That keeps the URL stored in the DB stable.
 */
import {
  S3Client,
  PutObjectCommand,
  DeleteObjectCommand,
  HeadObjectCommand,
  GetObjectCommand,
} from "@aws-sdk/client-s3";
import { getSignedUrl as presign } from "@aws-sdk/s3-request-presigner";
import type { Readable } from "stream";
import { config } from "../../config/env";
import type { StorageService, StoredObject, UploadOptions, UploadResult } from "./storage.interface";
import { buildKey, publicFileUrl } from "./storage.utils";

// ── Lazy singleton ──────────────────────────────────────────────────────────

let _client: S3Client | null = null;

function getClient(): S3Client {
  if (!_client) {
    if (!config.s3Bucket || !config.s3AccessKeyId || !config.s3SecretAccessKey) {
      throw new Error(
        "S3 storage is not configured (S3_BUCKET, S3_ACCESS_KEY_ID, S3_SECRET_ACCESS_KEY)"
      );
    }
    _client = new S3Client({
      region: config.s3Region,
      endpoint: config.s3Endpoint || undefined,
      forcePathStyle: config.s3ForcePathStyle,
      credentials: {
        accessKeyId: config.s3AccessKeyId,
        secretAccessKey: config.s3SecretAccessKey,
      },
    });
    console.log(
      `[STORAGE S3] Initialized — bucket: ${config.s3Bucket}, ` +
        `endpoint: ${config.s3Endpoint || "(aws default)"}`
    );
  }
  return _client;
}

function isNotFound(err: unknown): boolean {
  const e = err as { name?: string; $metadata?: { httpStatusCode?: number } };
  return e?.name === "NotFound" || e?.name === "NoSuchKey" || e?.$metadata?.httpStatusCode === 404;
}

// ── Implementation ──────────────────────────────────────────────────────────

export const storageS3: StorageService = {
  async uploadFile(options: UploadOptions): Promise<UploadResult> {
    const key = buildKey(options);

    await getClient().send(
      new PutObjectCommand({
        Bucket: config.s3Bucket,
        Key: key,
        Body: options.buffer,
        ContentType: options.mimeType,
        Metadata: options.metadata,
      })
    );

    console.log(
      `[STORAGE S3] Uploaded: ${key} (${options.buffer.length} bytes, ${options.mimeType})`
    );

    return {
      url: publicFileUrl(key),
      key,
      bucket: config.s3Bucket!,
      size: options.buffer.length,
      mimeType: options.mimeType,
    };
  },

  async deleteFile(key: string): Promise<void> {
    await getClient().send(new DeleteObjectCommand({ Bucket: config.s3Bucket, Key: key }));
    console.log(`[STORAGE S3] Deleted: ${key}`);
  },

  async getSignedUrl(key: string, expiresInSeconds?: number): Promise<string> {
    const ttl = expiresInSeconds ?? config.s3SignedUrlExpiry;
    return presign(
      getClient(),
      new GetObjectCommand({ Bucket: config.s3Bucket, Key: key }),
      { expiresIn: ttl }
    );
  },

  async getObject(key: string): Promise<StoredObject | null> {
    try {
      const res = await getClient().send(
        new GetObjectCommand({ Bucket: config.s3Bucket, Key: key })
      );
      return {
        body: res.Body as Readable,
        contentType: res.ContentType,
        contentLength: res.ContentLength,
        etag: res.ETag,
      };
    } catch (err) {
      if (isNotFound(err)) return null;
      throw err;
    }
  },

  async exists(key: string): Promise<boolean> {
    try {
      await getClient().send(new HeadObjectCommand({ Bucket: config.s3Bucket, Key: key }));
      return true;
    } catch (err) {
      if (isNotFound(err)) return false;
      throw err;
    }
  },
};
