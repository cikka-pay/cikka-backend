import { describe, it, expect, beforeEach } from "vitest";
import {
  signSellerToken,
  signUserToken,
  verifySellerToken,
  verifyUserToken,
} from "../../utils/jwt";
import { AUTH_ERRORS } from "../../constants/errors";

describe("Role-Based JWT Isolation Tests", () => {
  beforeEach(() => {
    process.env.JWT_SECRET = "test_super_secret_key_123456789";
  });

  it("should successfully sign and verify seller token", () => {
    const token = signSellerToken("seller-uuid-123");
    const payload = verifySellerToken(token);
    expect(payload.sub).toBe("seller-uuid-123");
    expect(payload.role).toBe("seller");
    expect(payload.aud).toBe("cikka-seller-web");
  });

  it("should successfully sign and verify user token", () => {
    const token = signUserToken("user-uuid-456");
    const payload = verifyUserToken(token);
    expect(payload.sub).toBe("user-uuid-456");
    expect(payload.role).toBe("user");
    expect(payload.aud).toBe("cikka-mobile-app");
  });

  it("should reject user token when attempting to verify as seller", () => {
    const userToken = signUserToken("user-uuid-456");
    expect(() => verifySellerToken(userToken)).toThrow(AUTH_ERRORS.INVALID_SELLER_TOKEN);
  });

  it("should reject seller token when attempting to verify as user", () => {
    const sellerToken = signSellerToken("seller-uuid-123");
    expect(() => verifyUserToken(sellerToken)).toThrow(AUTH_ERRORS.INVALID_USER_TOKEN);
  });
});

