/**
 * S3 storage adapter (Railway Buckets) with a mocked S3 client.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { Readable } from "stream";

const send = vi.fn();

vi.mock("@aws-sdk/client-s3", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@aws-sdk/client-s3")>();
  return { ...actual, S3Client: vi.fn(() => ({ send })) };
});
vi.mock("@aws-sdk/s3-request-presigner", () => ({
  getSignedUrl: vi.fn(async () => "https://bucket.example/signed"),
}));
vi.mock("../../config/env", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../config/env")>();
  return {
    config: {
      ...actual.config,
      publicBaseUrl: "https://api.cikka.test",
      s3Endpoint: "https://storage.example",
      s3Region: "auto",
      s3Bucket: "cikka-test",
      s3AccessKeyId: "key",
      s3SecretAccessKey: "secret",
      s3ForcePathStyle: false,
      s3SignedUrlExpiry: 3600,
    },
  };
});

import { storageS3 } from "../../external/storage/storage.s3";

const notFound = Object.assign(new Error("NotFound"), { name: "NotFound", $metadata: { httpStatusCode: 404 } });

describe("Storage S3", () => {
  beforeEach(() => send.mockReset());

  it("uploads with PutObject and returns a stable public file URL", async () => {
    send.mockResolvedValueOnce({});
    const result = await storageS3.uploadFile({
      buffer: Buffer.from("img"),
      filename: "my logo.png",
      mimeType: "image/png",
      folder: "logos",
      entityId: "seller1",
    });

    const cmd = send.mock.calls[0][0];
    expect(cmd.constructor.name).toBe("PutObjectCommand");
    expect(cmd.input).toMatchObject({ Bucket: "cikka-test", ContentType: "image/png" });
    expect(result.key).toMatch(/^logos\/seller1\/\d+-my_logo\.png$/);
    expect(result.url).toBe(`https://api.cikka.test/api/files/${result.key}`);
    expect(result).toMatchObject({ bucket: "cikka-test", size: 3, mimeType: "image/png" });
  });

  it("exists() maps 404 to false and other errors are thrown", async () => {
    send.mockResolvedValueOnce({});
    expect(await storageS3.exists("a/b.png")).toBe(true);
    send.mockRejectedValueOnce(notFound);
    expect(await storageS3.exists("a/b.png")).toBe(false);
    send.mockRejectedValueOnce(new Error("boom"));
    await expect(storageS3.exists("a/b.png")).rejects.toThrow("boom");
  });

  it("getObject() returns the stream and metadata, or null when missing", async () => {
    const body = Readable.from(["x"]);
    send.mockResolvedValueOnce({ Body: body, ContentType: "image/png", ContentLength: 1, ETag: '"e"' });
    expect(await storageS3.getObject("a/b.png")).toEqual({
      body,
      contentType: "image/png",
      contentLength: 1,
      etag: '"e"',
    });
    send.mockRejectedValueOnce(Object.assign(new Error("NoSuchKey"), { name: "NoSuchKey" }));
    expect(await storageS3.getObject("a/b.png")).toBeNull();
  });

  it("getSignedUrl() presigns a GetObject", async () => {
    expect(await storageS3.getSignedUrl("a/b.png", 60)).toBe("https://bucket.example/signed");
  });

  it("deleteFile() sends DeleteObject", async () => {
    send.mockResolvedValueOnce({});
    await storageS3.deleteFile("a/b.png");
    expect(send.mock.calls[0][0].constructor.name).toBe("DeleteObjectCommand");
  });
});
