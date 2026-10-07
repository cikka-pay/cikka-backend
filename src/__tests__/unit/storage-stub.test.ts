/**
 * Unit tests for the Storage Stub implementation.
 * Tests uploadFile, deleteFile, getSignedUrl, and exists operations
 * against the local filesystem stub.
 */
import { describe, it, expect, afterEach } from "vitest";
import fs from "fs";
import path from "path";
import { storageStub } from "../../external/storage/storage.stub";

const UPLOADS_ROOT = path.join("/tmp", "uploads");

/** Helper: clean up a file created during test */
function cleanupFile(key: string) {
  const filePath = path.join(UPLOADS_ROOT, key);
  if (fs.existsSync(filePath)) {
    fs.unlinkSync(filePath);
  }
}

describe("Storage Stub", () => {
  const testBuffer = Buffer.from("hello world");
  let lastKey: string | null = null;

  afterEach(() => {
    if (lastKey) {
      cleanupFile(lastKey);
      lastKey = null;
    }
  });

  describe("uploadFile", () => {
    it("should upload a file and return correct result shape", async () => {
      const result = await storageStub.uploadFile({
        buffer: testBuffer,
        filename: "test-image.png",
        mimeType: "image/png",
      });

      lastKey = result.key;

      expect(result.url).toContain("/uploads/");
      expect(result.key).toMatch(/\d+-test-image\.png$/);
      expect(result.bucket).toBe("local");
      expect(result.size).toBe(testBuffer.length);
      expect(result.mimeType).toBe("image/png");
    });

    it("should create subdirectories for folder and entityId", async () => {
      const result = await storageStub.uploadFile({
        buffer: testBuffer,
        filename: "logo.jpg",
        mimeType: "image/jpeg",
        folder: "logos",
        entityId: "seller_123",
      });

      lastKey = result.key;

      expect(result.key).toMatch(/^logos\/seller_123\/\d+-logo\.jpg$/);
      expect(result.url).toContain("logos/seller_123/");

      // File should actually exist on disk
      const filePath = path.join(UPLOADS_ROOT, result.key);
      expect(fs.existsSync(filePath)).toBe(true);
    });

    it("should sanitize filenames with special characters", async () => {
      const result = await storageStub.uploadFile({
        buffer: testBuffer,
        filename: "my file (copy).png",
        mimeType: "image/png",
      });

      lastKey = result.key;

      // Spaces and parens should be replaced with underscores
      expect(result.key).not.toContain(" ");
      expect(result.key).not.toContain("(");
      expect(result.key).toContain("my_file__copy_");
    });

    it("should handle empty folder and entityId gracefully", async () => {
      const result = await storageStub.uploadFile({
        buffer: testBuffer,
        filename: "simple.txt",
        mimeType: "text/plain",
      });

      lastKey = result.key;

      // Key should just be timestamp-filename, no leading slashes
      expect(result.key).toMatch(/^\d+-simple\.txt$/);
    });
  });

  describe("deleteFile", () => {
    it("should delete an existing file", async () => {
      const result = await storageStub.uploadFile({
        buffer: testBuffer,
        filename: "to-delete.txt",
        mimeType: "text/plain",
      });

      const filePath = path.join(UPLOADS_ROOT, result.key);
      expect(fs.existsSync(filePath)).toBe(true);

      await storageStub.deleteFile(result.key);
      expect(fs.existsSync(filePath)).toBe(false);

      // No cleanup needed — file already deleted
      lastKey = null;
    });

    it("should not throw when deleting a non-existent file", async () => {
      await expect(
        storageStub.deleteFile("non-existent-key-12345.txt")
      ).resolves.not.toThrow();
    });
  });

  describe("getSignedUrl", () => {
    it("should return a local URL path", async () => {
      const result = await storageStub.uploadFile({
        buffer: testBuffer,
        filename: "signed.txt",
        mimeType: "text/plain",
      });

      lastKey = result.key;

      const url = await storageStub.getSignedUrl(result.key);
      expect(url).toBe(`/uploads/${result.key}`);
    });
  });

  describe("exists", () => {
    it("should return true for an uploaded file", async () => {
      const result = await storageStub.uploadFile({
        buffer: testBuffer,
        filename: "exists-check.txt",
        mimeType: "text/plain",
      });

      lastKey = result.key;

      const found = await storageStub.exists(result.key);
      expect(found).toBe(true);
    });

    it("should return false for a non-existent file", async () => {
      const found = await storageStub.exists("does-not-exist-999.txt");
      expect(found).toBe(false);
    });
  });
});
