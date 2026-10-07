/**
 * Storage Service Interface — provider-agnostic file storage abstraction.
 *
 * Implementations:
 *   - storage.stub.ts  → local filesystem (dev / test)
 *   - storage.gcs.ts   → Google Cloud Storage (production)
 *
 * To add a new provider (e.g. AWS S3), create a new file that satisfies
 * this interface and wire it up in external/index.ts.
 */

// ── Upload Options ──────────────────────────────────────────────────────────

export interface UploadOptions {
  /** Raw file contents */
  buffer: Buffer;
  /** Original filename (will be sanitized before storage) */
  filename: string;
  /** MIME type (e.g. "image/png", "application/pdf") */
  mimeType: string;
  /** Logical folder / prefix (e.g. "logos", "documents", "products") */
  folder?: string;
  /** Entity ID for namespacing (e.g. sellerId, userId) */
  entityId?: string;
  /** Whether the file should be publicly accessible (default: false → signed URL) */
  public?: boolean;
  /** Custom metadata key-value pairs stored alongside the file */
  metadata?: Record<string, string>;
}

// ── Upload Result ───────────────────────────────────────────────────────────

export interface UploadResult {
  /** Public URL or signed URL to access the file */
  url: string;
  /** Storage key / object path (e.g. "logos/seller_abc/1695000000-logo.png") */
  key: string;
  /** Bucket or container name (or "local" for stub) */
  bucket: string;
  /** File size in bytes */
  size: number;
  /** MIME type */
  mimeType: string;
}

// ── Service Contract ────────────────────────────────────────────────────────

export interface StorageService {
  /** Upload a file and return its URL + metadata */
  uploadFile(options: UploadOptions): Promise<UploadResult>;

  /** Delete a file by its storage key */
  deleteFile(key: string): Promise<void>;

  /** Generate a signed / temporary URL for a private file */
  getSignedUrl(key: string, expiresInSeconds?: number): Promise<string>;

  /** Check if a file exists in storage */
  exists(key: string): Promise<boolean>;
}
