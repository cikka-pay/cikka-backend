/**
 * Storage Service — file upload abstraction.
 * Stub saves to /uploads/ locally; Real will use S3/GCS.
 */
import fs from "fs";
import path from "path";

export interface StorageService {
  uploadFile(buffer: Buffer, filename: string, mimeType: string): Promise<{ url: string }>;
}

const UPLOADS_DIR = path.join(process.cwd(), "uploads");

export const storageStub: StorageService = {
  async uploadFile(buffer, filename) {
    if (!fs.existsSync(UPLOADS_DIR)) {
      fs.mkdirSync(UPLOADS_DIR, { recursive: true });
    }
    const safeName = `${Date.now()}-${filename.replace(/[^a-zA-Z0-9._-]/g, "_")}`;
    const filePath = path.join(UPLOADS_DIR, safeName);
    fs.writeFileSync(filePath, buffer);
    const url = `/uploads/${safeName}`;
    console.log(`[STORAGE STUB] Saved file: ${url}`);
    return { url };
  },
};

export const storageReal: StorageService = {
  async uploadFile() {
    throw new Error("Real storage not implemented. Set EXTERNAL_SERVICES_MODE=stub.");
  },
};
