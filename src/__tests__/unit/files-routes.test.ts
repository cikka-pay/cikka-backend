/**
 * Upload + serve round trip through the HTTP layer using the local storage
 * provider (the default when no S3 bucket is configured). No DB required.
 */
import request from "supertest";
import { describe, it, expect } from "vitest";
import app from "../../app";
import { signSellerToken } from "../../utils/jwt";

// 1x1 transparent PNG
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=",
  "base64"
);

describe("Files API", () => {
  const token = signSellerToken("seller_files_test");

  it("POST /api/uploads/image stores the image and GET /api/files/<key> serves it", async () => {
    const upload = await request(app)
      .post("/api/uploads/image?folder=products")
      .set("Authorization", `Bearer ${token}`)
      .attach("image", PNG, { filename: "pixel.png", contentType: "image/png" });

    expect(upload.status).toBe(201);
    expect(upload.body.key).toMatch(/^products\/seller-seller_files_test\/\d+-pixel\.png$/);
    expect(upload.body.url).toContain(`/api/files/${upload.body.key}`);

    const served = await request(app).get(`/api/files/${upload.body.key}`);
    expect(served.status).toBe(200);
    expect(served.headers["content-type"]).toBe("image/png");
    expect(served.headers["cache-control"]).toContain("immutable");
    expect(served.headers["x-content-type-options"]).toBe("nosniff");
    expect(Buffer.compare(served.body as Buffer, PNG)).toBe(0);
  });

  it("rejects uploads without auth", async () => {
    const res = await request(app)
      .post("/api/uploads/image")
      .attach("image", PNG, { filename: "pixel.png", contentType: "image/png" });
    expect(res.status).toBe(401);
  });

  it("rejects non-image files with 415", async () => {
    const res = await request(app)
      .post("/api/uploads/image")
      .set("Authorization", `Bearer ${token}`)
      .attach("image", Buffer.from("hello"), { filename: "a.txt", contentType: "text/plain" });
    expect(res.status).toBe(415);
  });

  it("rejects unknown folders", async () => {
    const res = await request(app)
      .post("/api/uploads/image?folder=../etc")
      .set("Authorization", `Bearer ${token}`)
      .attach("image", PNG, { filename: "pixel.png", contentType: "image/png" });
    expect(res.status).toBe(400);
  });

  it("returns 404 for missing or path-traversal keys", async () => {
    expect((await request(app).get("/api/files/products/nope/123-missing.png")).status).toBe(404);
    expect((await request(app).get("/api/files/..%2F..%2Fetc%2Fpasswd")).status).toBe(404);
    // Unencoded "../" is normalised by the client before routing, so it never reaches the file route.
    expect((await request(app).get("/api/files/products/../../etc/passwd")).status).not.toBe(200);
  });
});
