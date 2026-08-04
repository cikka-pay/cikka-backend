import { describe, it, expect, beforeEach } from "vitest";
import {
  signSellerToken,
  signCustomerToken,
  verifySellerToken,
  verifyCustomerToken,
} from "../../utils/jwt";

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

  it("should successfully sign and verify customer token", () => {
    const token = signCustomerToken("customer-uuid-456");
    const payload = verifyCustomerToken(token);
    expect(payload.sub).toBe("customer-uuid-456");
    expect(payload.role).toBe("customer");
    expect(payload.aud).toBe("cikka-mobile-app");
  });

  it("should reject customer token when attempting to verify as seller", () => {
    const customerToken = signCustomerToken("customer-uuid-456");
    expect(() => verifySellerToken(customerToken)).toThrow("Invalid token role: expected seller");
  });

  it("should reject seller token when attempting to verify as customer", () => {
    const sellerToken = signSellerToken("seller-uuid-123");
    expect(() => verifyCustomerToken(sellerToken)).toThrow("Invalid token role: expected customer");
  });
});
