import "dotenv/config";
import { PrismaClient, WalletTxType } from "../src/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import pg from "pg";

const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL || "postgresql://postgres:Vedant%40123@localhost:5432/cikka_dashboard?schema=public",
});
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

async function main() {
  console.log("--- INSPECTING ALL USERS & WALLETS ---");

  const allWallets = await prisma.userWallet.findMany();
  console.log(`Found ${allWallets.length} total wallets:`);
  for (const w of allWallets) {
    console.log(`  Wallet ID: ${w.id}, userId: ${w.userId}, ciPoints: ${w.ciPoints}, cashPaise: ${w.cashPaise}`);
  }

  const allUsers = await prisma.user.findMany({
    where: {
      OR: [
        { phone: { contains: "1111111111" } },
        { id: { in: ["dev-bypass-1", "dev-bypass-user-id", "975ada92-b982-4205-8c49-4f2723fce75a"] } },
        { phone: { contains: "1000000000" } },
      ],
    },
    include: { wallet: true },
  });

  console.log(`\nFound ${allUsers.length} bypass-related users:`);
  for (const u of allUsers) {
    console.log(`  User ID: ${u.id}, Phone: ${u.phone}, CI Points: ${u.ciPoints}, Wallet CI: ${u.wallet?.ciPoints}`);
  }

  // Ensure dev-bypass-1 exists in User table
  const devBypass1User = await prisma.user.findUnique({ where: { id: "dev-bypass-1" } });
  if (!devBypass1User) {
    console.log("Creating User record for 'dev-bypass-1'...");
    await prisma.user.create({
      data: {
        id: "dev-bypass-1",
        phone: "+911111111112", // Unique phone to avoid constraint with +911111111111
        name: "DEV BYPASS USER",
        phoneVerified: true,
        panVerified: true,
        panNumber: "AAAAA1111A",
        ciPoints: 10000,
      },
    });
  } else {
    await prisma.user.update({
      where: { id: "dev-bypass-1" },
      data: { ciPoints: 10000 },
    });
  }

  // Ensure dev-bypass-user-id exists in User table
  const devBypassUserId = await prisma.user.findUnique({ where: { id: "dev-bypass-user-id" } });
  if (!devBypassUserId) {
    console.log("Creating User record for 'dev-bypass-user-id'...");
    await prisma.user.create({
      data: {
        id: "dev-bypass-user-id",
        phone: "+911111111113",
        name: "DEV BYPASS USER",
        phoneVerified: true,
        panVerified: true,
        panNumber: "AAAAA1111A",
        ciPoints: 10000,
      },
    });
  } else {
    await prisma.user.update({
      where: { id: "dev-bypass-user-id" },
      data: { ciPoints: 10000 },
    });
  }

  // Target User IDs that need 10,000 CI points in UserWallet
  const targetIds = ["975ada92-b982-4205-8c49-4f2723fce75a", "dev-bypass-1", "dev-bypass-user-id"];

  // Also include any other users with phone 1111111111
  for (const u of allUsers) {
    if (!targetIds.includes(u.id)) targetIds.push(u.id);
  }

  console.log("\nCrediting 10,000 CI Points to all target accounts:", targetIds);

  for (const tid of targetIds) {
    // 1. Update user
    await prisma.user.update({
      where: { id: tid },
      data: { ciPoints: 10000 },
    }).catch((e) => console.log(`User update note for ${tid}:`, e.message));

    // 2. Upsert wallet
    const updatedWallet = await prisma.userWallet.upsert({
      where: { userId: tid },
      update: {
        ciPoints: 10000,
        lifetimeEarnedPoints: 10000,
      },
      create: {
        userId: tid,
        ciPoints: 10000,
        cashPaise: 0,
        lifetimeEarnedPoints: 10000,
        lifetimeRedeemedPoints: 0,
        lifetimeEarnedPaise: 0,
        lifetimeRedeemedPaise: 0,
      },
    });

    console.log(`✅ Target ${tid} UserWallet now has ${updatedWallet.ciPoints} CI Points!`);
  }
}

main()
  .catch((err) => {
    console.error("Error:", err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
    await pool.end();
  });
