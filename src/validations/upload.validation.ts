/**
 * Zod schemas for file upload request validation.
 */
import { z } from "zod";

/** Body schema for upload requests that include metadata alongside the file. */
export const uploadBodySchema = z.object({
  /** Logical folder / category (e.g. "logos", "products", "documents") */
  folder: z
    .string()
    .min(1)
    .max(64)
    .regex(/^[a-zA-Z0-9_-]+$/, "Folder must be alphanumeric with dashes/underscores")
    .optional(),
  /** Entity ID for namespacing (e.g. sellerId). Typically set server-side. */
  entityId: z.string().min(1).max(128).optional(),
  /** Whether the file should be publicly accessible */
  public: z
    .enum(["true", "false"])
    .transform((v) => v === "true")
    .optional(),
});

/** Params schema for delete / get-url operations */
export const fileKeyParamsSchema = z.object({
  /** The storage key (object path) — uses a catch-all param with slashes */
  key: z.string().min(1, "File key is required"),
});

export type UploadBody = z.infer<typeof uploadBodySchema>;
export type FileKeyParams = z.infer<typeof fileKeyParamsSchema>;
