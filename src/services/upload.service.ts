/**
 * Upload Service — thin orchestration layer over the storage provider.
 *
 * Any controller or service can import these helpers to upload, delete,
 * or generate URLs for files. The underlying provider (GCS / stub) is
 * selected automatically via the external services factory.
 */
import { storageService } from "../external";
import type { UploadResult } from "../external/storage/storage.interface";
import { UPLOAD_ERRORS } from "../constants/errors";

// ── Public API ──────────────────────────────────────────────────────────────

export interface UploadFileParams {
  /** The multer file object (req.file) */
  file: Express.Multer.File;
  /** Logical folder / prefix (e.g. "logos", "products") */
  folder: string;
  /** Entity ID for namespacing (e.g. sellerId) */
  entityId: string;
  /** Whether the uploaded file should be publicly accessible */
  public?: boolean;
  /** Optional metadata key-value pairs */
  metadata?: Record<string, string>;
}

/**
 * Upload a file to the configured storage provider.
 * Validates the file exists, delegates to storageService, and returns the result.
 */
export async function uploadFile(params: UploadFileParams): Promise<UploadResult> {
  const { file, folder, entityId, public: isPublic, metadata } = params;

  if (!file || !file.buffer) {
    throw Object.assign(new Error(UPLOAD_ERRORS.FILE_REQUIRED), { status: 400 });
  }

  try {
    const result = await storageService.uploadFile({
      buffer: file.buffer,
      filename: file.originalname,
      mimeType: file.mimetype,
      folder,
      entityId,
      public: isPublic,
      metadata,
    });

    console.log(
      `[Upload Service] Success: ${result.key} (${result.size} bytes, ${result.mimeType})`
    );

    return result;
  } catch (err) {
    console.error("[Upload Service] Upload failed:", err);
    throw Object.assign(new Error(UPLOAD_ERRORS.UPLOAD_FAILED), { status: 500 });
  }
}

/**
 * Delete a file from storage by its key.
 */
export async function deleteFile(key: string): Promise<void> {
  try {
    const fileExists = await storageService.exists(key);
    if (!fileExists) {
      throw Object.assign(new Error(UPLOAD_ERRORS.FILE_NOT_FOUND), { status: 404 });
    }

    await storageService.deleteFile(key);
    console.log(`[Upload Service] Deleted: ${key}`);
  } catch (err) {
    if ((err as any).status) throw err; // re-throw known errors
    console.error("[Upload Service] Delete failed:", err);
    throw Object.assign(new Error(UPLOAD_ERRORS.DELETE_FAILED), { status: 500 });
  }
}

/**
 * Generate a signed / temporary URL for accessing a private file.
 */
export async function getFileUrl(
  key: string,
  expiresInSeconds?: number
): Promise<string> {
  const fileExists = await storageService.exists(key);
  if (!fileExists) {
    throw Object.assign(new Error(UPLOAD_ERRORS.FILE_NOT_FOUND), { status: 404 });
  }

  return storageService.getSignedUrl(key, expiresInSeconds);
}
