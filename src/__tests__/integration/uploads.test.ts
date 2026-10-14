import request from "supertest";
import { describe, it, expect, beforeEach } from "vitest";
import app from "../../app";
import { prisma } from "../../config/prisma";
import { cleanTestData, createTestSeller } from "../helpers";

// 1x1 transparent PNG
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=",
  "base64"
);

describe("Onboarding logo upload", () => {
  let token = "";
  let sellerId = "";

  beforeEach(async () => {
    await cleanTestData(["+919000000777"]);
    const res = await createTestSeller({ phone: "+919000000777" });
    token = res.token;
    sellerId = res.seller.id;
  });

  it("stores the logo in storage and saves a servable URL on the onboarding record", async () => {
    const res = await request(app)
      .post("/api/onboarding/upload/logo")
      .set("Authorization", `Bearer ${token}`)
      .attach("logo", PNG, { filename: "logo.png", contentType: "image/png" });

    expect(res.status).toBe(200);
    expect(res.body.url).toMatch(new RegExp(`/api/files/logos/${sellerId}/\\d+-logo\\.png$`));

    const onboarding = await prisma.sellerOnboarding.findUnique({ where: { sellerId } });
    expect(onboarding?.logoUrl).toBe(res.body.url);

    const path = new URL(res.body.url, "http://localhost").pathname;
    const served = await request(app).get(path);
    expect(served.status).toBe(200);
    expect(served.headers["content-type"]).toBe("image/png");
  });

  it("returns 400 when no file is sent", async () => {
    const res = await request(app)
      .post("/api/onboarding/upload/logo")
      .set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(400);
  });
});
