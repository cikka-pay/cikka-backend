/**
 * GCS storage adapter with a mocked @google-cloud/storage client.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { Readable } from "stream";

const file = {
  save: vi.fn(),
  delete: vi.fn(),
  getSignedUrl: vi.fn(),
  getMetadata: vi.fn(),
  createReadStream: vi.fn(),
  exists: vi.fn(),
};
const bucketFn = vi.fn(() => ({ file: vi.fn(() => file) }));

vi.mock("@google-cloud/storage", () => ({
  Storage: vi.fn(() => ({ bucket: bucketFn })),
}));
vi.mock("../../config/env", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../config/env")>();
  return {
    config: {
      ...actual.config,
      publicBaseUrl: "https://api.cikka.test",
      gcsBucketName: "cikka-test",
      gcsSignedUrlExpiry: 3600,
    },
  };
});
process.env.GCS_BUCKET_NAME = "cikka-test";

import { storageGcs } from "../../external/storage/storage.gcs";

const notFound = Object.assign(new Error("No such object"), { code: 404 });

describe("Storage GCS", () => {
  beforeEach(() => Object.values(file).forEach((f) => f.mockReset()));

  it("uploads and returns a stable public file URL", async () => {
    file.save.mockResolvedValueOnce(undefined);
    const result = await storageGcs.uploadFile({
      buffer: Buffer.from("img"),
      filename: "my logo.png",
      mimeType: "image/png",
      folder: "logos",
      entityId: "seller1",
    });

    expect(bucketFn).toHaveBeenCalledWith("cikka-test");
    expect(file.save).toHaveBeenCalledWith(Buffer.from("img"), expect.objectContaining({ contentType: "image/png" }));
    expect(result.key).toMatch(/^logos\/seller1\/\d+-my_logo\.png$/);
    expect(result.url).toBe(`https://api.cikka.test/api/files/${result.key}`);
    expect(result).toMatchObject({ bucket: "cikka-test", size: 3, mimeType: "image/png" });
  });

  it("getObject() streams the file and maps 404 to null", async () => {
    const body = Readable.from(["x"]);
    file.getMetadata.mockResolvedValueOnce([{ contentType: "image/png", size: "1", etag: "e" }]);
    file.createReadStream.mockReturnValueOnce(body);
    expect(await storageGcs.getObject("a/b.png")).toEqual({
      body,
      contentType: "image/png",
      contentLength: 1,
      etag: "e",
    });

    file.getMetadata.mockRejectedValueOnce(notFound);
    expect(await storageGcs.getObject("missing.png")).toBeNull();

    file.getMetadata.mockRejectedValueOnce(Object.assign(new Error("boom"), { code: 500 }));
    await expect(storageGcs.getObject("x.png")).rejects.toThrow("boom");
  });

  it("exists(), deleteFile() and getSignedUrl() delegate to the client", async () => {
    file.exists.mockResolvedValueOnce([false]);
    expect(await storageGcs.exists("a.png")).toBe(false);

    file.delete.mockResolvedValueOnce(undefined);
    await storageGcs.deleteFile("a.png");
    expect(file.delete).toHaveBeenCalledWith({ ignoreNotFound: true });

    file.getSignedUrl.mockResolvedValueOnce(["https://signed"]);
    expect(await storageGcs.getSignedUrl("a.png", 60)).toBe("https://signed");
    expect(file.getSignedUrl.mock.calls[0][0]).toMatchObject({ version: "v4", action: "read" });
  });
});
