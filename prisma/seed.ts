// Demo data matching the reference dashboard mockup.
// Run with: npm run seed
// Re-running is safe — existing data is wiped before seeding.
import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";
import { generatePassword } from "../src/utils/credentials";

const prisma = new PrismaClient();

function startOfWeek(date: Date): Date {
  const d = new Date(date);
  const day = d.getDay();
  const diff = d.getDate() - day + (day === 0 ? -6 : 1); // Monday
  d.setDate(diff);
  d.setHours(0, 0, 0, 0);
  return d;
}

// Deletes all rows in FK-safe order so the script is idempotent.
async function wipeExisting() {
  await prisma.return.deleteMany();
  await prisma.orderItem.deleteMany();
  await prisma.order.deleteMany();
  await prisma.settlement.deleteMany();
  await prisma.product.deleteMany();
  await prisma.seller.deleteMany();
  console.log("Existing data wiped.");
}

async function main() {
  await wipeExisting();

  const phone = "9999999999";
  const plainPassword = "dL5M$Vm6E%!B";
  const passwordHash = await bcrypt.hash(plainPassword, 10);

  const seller = await prisma.seller.create({
    data: {
      businessName: "Aura Vogue",
      loginId: "CIKKA-ACD945",
      phone,
      passwordHash,
      kycVerified: true,
    },
  });

  const products = await prisma.$transaction([
    prisma.product.create({
      data: {
        sellerId: seller.id,
        name: "Matte Lipstick - Ruby",
        sku: "LIPS-RUBY-01",
        category: "Cosmetics",
        price: 499.0,
        stockQty: 2,
        lowStockThreshold: 5,
        status: "ACTIVE",
      },
    }),
    prisma.product.create({
      data: {
        sellerId: seller.id,
        name: "Vitamin C Serum 30ml",
        sku: "SER-VITC-30",
        category: "Cosmetics",
        price: 899.0,
        stockQty: 0,
        lowStockThreshold: 5,
        status: "ACTIVE",
      },
    }),
    prisma.product.create({
      data: {
        sellerId: seller.id,
        name: "Hydrating Face Mist",
        sku: "MIST-HYD-100",
        category: "Cosmetics",
        price: 349.0,
        stockQty: 5,
        lowStockThreshold: 10,
        status: "ACTIVE",
      },
    }),
    prisma.product.create({
      data: {
        sellerId: seller.id,
        name: "Charcoal Face Wash",
        sku: "WASH-CHAR-150",
        category: "Cosmetics",
        price: 299.0,
        stockQty: 42,
        lowStockThreshold: 10,
        status: "ACTIVE",
      },
    }),
  ]);

  const now = new Date();
  const weekStart = startOfWeek(now);

  // Orders this week, summing to ~58,400 gross sales to match the mockup
  const orderAmounts = [12400, 9800, 15600, 11200, 9400];
  const statuses = ["PENDING", "PENDING", "PACKED", "SHIPPED", "PENDING"] as const;
  for (let i = 0; i < orderAmounts.length; i++) {
    await prisma.order.create({
      data: {
        sellerId: seller.id,
        orderNumber: `CIK-${1000 + i}`,
        customerName: `Customer ${i + 1}`,
        status: statuses[i],
        totalAmount: orderAmounts[i],
        createdAt: new Date(weekStart.getTime() + i * 1000 * 60 * 60 * 6),
        items: {
          create: [
            {
              productId: products[i % products.length].id,
              quantity: 1,
              unitPrice: orderAmounts[i],
            },
          ],
        },
      },
    });
  }

  // 24 additional pending orders "to pack" (lighter weight, no line items needed for the demo)
  for (let i = 0; i < 19; i++) {
    await prisma.order.create({
      data: {
        sellerId: seller.id,
        orderNumber: `CIK-${2000 + i}`,
        customerName: `Customer ${i + 6}`,
        status: "PENDING",
        totalAmount: 500 + i * 25,
        createdAt: new Date(weekStart.getTime() + i * 1000 * 60 * 60 * 3),
      },
    });
  }

  // Last week's orders, for the WoW % comparison
  const lastWeekStart = new Date(weekStart);
  lastWeekStart.setDate(lastWeekStart.getDate() - 7);
  await prisma.order.create({
    data: {
      sellerId: seller.id,
      orderNumber: "CIK-0999",
      customerName: "Customer 0",
      status: "DELIVERED",
      totalAmount: 51950,
      createdAt: new Date(lastWeekStart.getTime() + 1000 * 60 * 60 * 24),
    },
  });

  // This week's settlement (pending payout)
  await prisma.settlement.create({
    data: {
      sellerId: seller.id,
      periodStart: weekStart,
      periodEnd: now,
      category: "Cosmetics",
      grossSales: 58400.0,
      commissionRate: 15.0,
      commissionAmount: 8760.0,
      shippingGstAmount: 4409.0,
      netPayable: 45231.0,
      status: "PENDING",
      payoutDate: new Date(now.getFullYear(), now.getMonth(), 24),
    },
  });

  console.log("Seed complete.\n");
  console.log("Demo login credentials (also work via npm run create-seller for new sellers):");
  console.log(`  phone:    ${phone}`);
  console.log(`  password: ${plainPassword}`);
  console.log("\nThese are only shown once — store them now if you want to log in as this demo seller.");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
