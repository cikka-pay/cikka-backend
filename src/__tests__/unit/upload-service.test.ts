/**
 * Unit tests for the Upload Service.
 * Mocks the storageService to test orchestration logic without
 * hitting the filesystem or cloud.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import * as uploadService from "../../services/upload.service";
import { storageService } from "../../external";
import type { UploadResult } from "../../external/storage/storage.interface";
import { UPLOAD_ERRORS } from "../../constants/errors";

/** Create a fake Express.Multer.File */
function makeMockFile(overrides?: Partial<Express.Multer.File>): Express.Multer.File {
  return {
    fieldname: "file",
    originalname: "test-photo.jpg",
    encoding: "7bit",
    mimetype: "image/jpeg",
    buffer: Buffer.from("fake-image-data"),
    size: 15,
    destination: "",
    filename: "",
    path: "",
    stream: null as any,
    ...overrides,
  };
}

const mockUploadResult: UploadResult = {
  url: "/uploads/logos/seller_1/12345-test-photo.jpg",
  key: "logos/seller_1/12345-test-photo.jpg",
  bucket: "local",
  size: 15,
  mimeType: "image/jpeg",
};

describe("Upload Service", () => {
  let uploadFileSpy: any;
  let deleteFileSpy: any;
  let existsSpy: any;
  let getSignedUrlSpy: any;

  beforeEach(() => {
    uploadFileSpy = vi.spyOn(storageService, "uploadFile").mockResolvedValue(mockUploadResult);
    deleteFileSpy = vi.spyOn(storageService, "deleteFile").mockResolvedValue();
    existsSpy = vi.spyOn(storageService, "exists").mockResolvedValue(true);
    getSignedUrlSpy = vi.spyOn(storageService, "getSignedUrl").mockResolvedValue("https://signed.url/file");
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("uploadFile", () => {
    it("should upload a file successfully and return the result", async () => {
      const result = await uploadService.uploadFile({
        file: makeMockFile(),
        folder: "logos",
        entityId: "seller_1",
      });

      expect(result).toEqual(mockUploadResult);
      expect(uploadFileSpy).toHaveBeenCalledOnce();
      expect(uploadFileSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          buffer: expect.any(Buffer),
          filename: "test-photo.jpg",
          mimeType: "image/jpeg",
          folder: "logos",
          entityId: "seller_1",
        })
      );
    });

    it("should pass the public flag through to storage", async () => {
      await uploadService.uploadFile({
        file: makeMockFile(),
        folder: "products",
        entityId: "seller_2",
        public: true,
      });

      expect(uploadFileSpy).toHaveBeenCalledWith(
        expect.objectContaining({ public: true })
      );
    });

    it("should throw 400 if no file is provided", async () => {
      await expect(
        uploadService.uploadFile({
          file: null as any,
          folder: "logos",
          entityId: "seller_1",
        })
      ).rejects.toThrow(UPLOAD_ERRORS.FILE_REQUIRED);
    });

    it("should throw 400 if file has no buffer", async () => {
      await expect(
        uploadService.uploadFile({
          file: makeMockFile({ buffer: undefined as any }),
          folder: "logos",
          entityId: "seller_1",
        })
      ).rejects.toThrow(UPLOAD_ERRORS.FILE_REQUIRED);
    });

    it("should throw 500 if storage provider fails", async () => {
      uploadFileSpy.mockRejectedValueOnce(new Error("GCS connection failed"));

      await expect(
        uploadService.uploadFile({
          file: makeMockFile(),
          folder: "logos",
          entityId: "seller_1",
        })
      ).rejects.toThrow(UPLOAD_ERRORS.UPLOAD_FAILED);
    });
  });

  describe("deleteFile", () => {
    it("should delete a file by key", async () => {
      await uploadService.deleteFile("logos/seller_1/12345-photo.jpg");

      expect(existsSpy).toHaveBeenCalledWith("logos/seller_1/12345-photo.jpg");
      expect(deleteFileSpy).toHaveBeenCalledWith("logos/seller_1/12345-photo.jpg");
    });

    it("should throw 404 if file does not exist", async () => {
      existsSpy.mockResolvedValueOnce(false);

      await expect(
        uploadService.deleteFile("non-existent.jpg")
      ).rejects.toThrow(UPLOAD_ERRORS.FILE_NOT_FOUND);
    });
  });

  describe("getFileUrl", () => {
    it("should return a signed URL for an existing file", async () => {
      const url = await uploadService.getFileUrl("logos/seller_1/12345-photo.jpg");

      expect(url).toBe("https://signed.url/file");
      expect(existsSpy).toHaveBeenCalledWith("logos/seller_1/12345-photo.jpg");
      expect(getSignedUrlSpy).toHaveBeenCalledWith("logos/seller_1/12345-photo.jpg", undefined);
    });

    it("should pass custom expiry to storage", async () => {
      await uploadService.getFileUrl("logos/file.jpg", 7200);

      expect(getSignedUrlSpy).toHaveBeenCalledWith("logos/file.jpg", 7200);
    });

    it("should throw 404 if file does not exist", async () => {
      existsSpy.mockResolvedValueOnce(false);

      await expect(
        uploadService.getFileUrl("non-existent.jpg")
      ).rejects.toThrow(UPLOAD_ERRORS.FILE_NOT_FOUND);
    });
  });
});
