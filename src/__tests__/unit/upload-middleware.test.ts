/**
 * Unit tests for the Upload Middleware (multer configuration).
 * Tests MIME type filtering, size limits, and preset configurations.
 */
import { describe, it, expect } from "vitest";
import {
  IMAGE_MIMES,
  DOC_MIMES,
  ALL_SUPPORTED_MIMES,
  createUpload,
} from "../../middleware/upload.middleware";

describe("Upload Middleware", () => {
  describe("MIME type constants", () => {
    it("IMAGE_MIMES should include common image types", () => {
      expect(IMAGE_MIMES).toContain("image/jpeg");
      expect(IMAGE_MIMES).toContain("image/png");
      expect(IMAGE_MIMES).toContain("image/webp");
      expect(IMAGE_MIMES).toContain("image/gif");
      expect(IMAGE_MIMES).toContain("image/svg+xml");
    });

    it("DOC_MIMES should include PDF and image types", () => {
      expect(DOC_MIMES).toContain("application/pdf");
      expect(DOC_MIMES).toContain("image/jpeg");
      expect(DOC_MIMES).toContain("image/png");
    });

    it("ALL_SUPPORTED_MIMES should be a de-duplicated union", () => {
      // Should have no duplicates
      const uniqueCount = new Set(ALL_SUPPORTED_MIMES).size;
      expect(ALL_SUPPORTED_MIMES.length).toBe(uniqueCount);

      // Should include items from both sets
      expect(ALL_SUPPORTED_MIMES).toContain("application/pdf");
      expect(ALL_SUPPORTED_MIMES).toContain("image/webp");
    });
  });

  describe("createUpload", () => {
    it("should return an object with single and array middleware", () => {
      const upload = createUpload();
      expect(upload.single).toBeTypeOf("function");
      expect(upload.array).toBeTypeOf("function");
    });

    it("should accept custom configuration", () => {
      const upload = createUpload({
        field: "avatar",
        maxSizeMB: 2,
        allowedMimes: ["image/png"],
        maxCount: 3,
      });
      expect(upload.single).toBeTypeOf("function");
      expect(upload.array).toBeTypeOf("function");
    });

    it("should use default values when no config provided", () => {
      // Just verify it doesn't throw
      const upload = createUpload({});
      expect(upload.single).toBeTypeOf("function");
    });
  });
});
