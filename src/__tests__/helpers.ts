/**
 * Test helper — cleans up seller test data between tests.
 * Call cleanTestSeller() in beforeEach for integration tests.
 */
import { prisma } from "../config/prisma";

export async function cleanTestData(phones: string[]) {
  // Delete in reverse-dependency order
  const sellers = await prisma.seller.findMany({
    where: { phone: { in: phones } },
    select: { id: true },
  });
  const ids = sellers.map((s) => s.id);
  if (ids.length === 0) return;

  await prisma.notification.deleteMany({ where: { sellerId: { in: ids } } });
  await prisma.return.deleteMany({ where: { order: { sellerId: { in: ids } } } });
  await prisma.orderItem.deleteMany({ where: { order: { sellerId: { in: ids } } } });
  await prisma.order.deleteMany({ where: { sellerId: { in: ids } } });
  await prisma.productVariant.deleteMany({ where: { product: { sellerId: { in: ids } } } });
  await prisma.product.deleteMany({ where: { sellerId: { in: ids } } });
  await prisma.settlement.deleteMany({ where: { sellerId: { in: ids } } });
  await prisma.sellerSettings.deleteMany({ where: { sellerId: { in: ids } } });
  await prisma.sellerOnboarding.deleteMany({ where: { sellerId: { in: ids } } });
  await prisma.seller.deleteMany({ where: { id: { in: ids } } });
}

/** Creates a verified test seller and returns auth JWT */
export async function createTestSeller(overrides?: {
  phone?: string;
  email?: string;
  businessName?: string;
}) {
  const bcrypt = await import("bcryptjs");
  const { signToken } = await import("../utils/jwt");

  const phone = overrides?.phone ?? "+919000000001";
  const email = overrides?.email ?? `test-${phone.replace("+", "")}@testbrand.com`;
  const businessName = overrides?.businessName ?? "Test Brand";

  const passwordHash = await bcrypt.hash("Test@1234", 10);

  const seller = await prisma.seller.create({
    data: {
      phone,
      phoneVerified: true,
      email,
      emailVerified: true,
      passwordHash,
      businessName,
      kycVerified: true,
      onboardingStatus: "VERIFIED",
    },
  });

  const token = signToken(seller.id);
  return { seller, token };
}
