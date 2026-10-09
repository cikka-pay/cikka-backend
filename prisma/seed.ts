// Demo data matching the reference dashboard mockup.
// Run with: npm run seed
// Re-running is safe — existing data is wiped before seeding.
import { PrismaClient } from "../src/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import pg from "pg";
import bcrypt from "bcryptjs";
import { generatePassword } from "../src/utils/credentials";
import "dotenv/config";

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

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

  const phone = "+919999999999";
  const plainPassword = "password123";
  const passwordHash = await bcrypt.hash(plainPassword, 10);

  const sneakerSeller = await prisma.seller.create({
    data: {
      businessName: "Nike India Hub",
      phone: "+919876543210",
      phoneNumber: "9876543210",
      countryCode: "91",
      passwordHash,
      kycVerified: true,
      phoneVerified: true,
      onboardingStatus: "VERIFIED",
      onboarding: {
        create: {
          businessName: "Nike India Hub",
          pickupAddress: {
            line1: "DLF Cyber City, Sector 24",
            city: "Gurgaon",
            state: "Haryana",
            pincode: "122008",
          },
          completedSteps: 6,
        },
      },
    },
  });

  const linenSeller = await prisma.seller.create({
    data: {
      businessName: "Fabindia Lucknow Hub",
      phone: "+919876543211",
      phoneNumber: "9876543211",
      countryCode: "91",
      passwordHash,
      kycVerified: true,
      phoneVerified: true,
      onboardingStatus: "VERIFIED",
      onboarding: {
        create: {
          businessName: "Fabindia Lucknow Hub",
          pickupAddress: {
            line1: "Hazratganj Main Market",
            city: "Lucknow",
            state: "Uttar Pradesh",
            pincode: "226005",
          },
          completedSteps: 6,
        },
      },
    },
  });

  const seller = sneakerSeller;

  const products = await prisma.$transaction([
    prisma.product.create({
      data: {
        sellerId: sneakerSeller.id,
        name: "Sneakers Pro",
        brandName: "Nike",
        sku: "NK-SNK-122008",
        category: "Footwear",
        price: 4999.0,
        mrp: 11999.0,
        stockQty: 50,
        lowStockThreshold: 5,
        status: "ACTIVE",
      },
    }),
    prisma.product.create({
      data: {
        sellerId: linenSeller.id,
        name: "Linen Co-ord Set",
        brandName: "Fabindia",
        sku: "FB-LIN-226005",
        category: "Apparel",
        price: 3499.0,
        mrp: 4199.0,
        stockQty: 30,
        lowStockThreshold: 5,
        status: "ACTIVE",
      },
    }),
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

  // This week's settlement (pending payout) — matching exact ₹4,999 -> ₹3,773.03 payout logic
  const seedGrossSales = 4999.0;
  const seedBasePrice = 4236.44;
  const seedGstOnSale = 762.56;
  const seedCommissionRate = 21.0;
  const seedCommission = 889.65; // 21% of base price
  const seedGstOnCommission = 160.14; // 18% of commission
  const seedShippingFee = 150.0;
  const seedTds = 5.0; // 0.1% TDS on Gross Price
  const seedTcs = 21.18; // 0.5% TCS on Net Taxable Base Price
  const seedTaxes = seedTds + seedTcs; // 26.18
  const seedTotalDeductions = seedCommission + seedGstOnCommission + seedShippingFee + seedTaxes; // 1225.97
  const seedNetPayable = seedGrossSales - seedTotalDeductions; // 3773.03

  await prisma.settlement.create({
    data: {
      sellerId: seller.id,
      periodStart: weekStart,
      periodEnd: now,
      category: "Cosmetics",
      grossSales: seedGrossSales,
      basePrice: seedBasePrice,
      gstOnSale: seedGstOnSale,
      commissionRate: seedCommissionRate,
      commissionAmount: seedCommission,
      gstOnCommission: seedGstOnCommission,
      shippingFee: seedShippingFee,
      tdsAmount: seedTds,
      tcsAmount: seedTcs,
      statutoryTaxes: seedTaxes,
      shippingGstAmount: seedGstOnCommission + seedShippingFee + seedTaxes,
      netPayable: seedNetPayable,
      status: "PENDING",
      payoutDate: new Date(now.getFullYear(), now.getMonth(), 24),
    } as any,
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
