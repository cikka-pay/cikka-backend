// Provisions a new seller with a generated loginId + password.
// Usage: npm run create-seller -- "Business Name"
import { PrismaClient } from "../src/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import pg from "pg";
import bcrypt from "bcryptjs";
import { generateLoginId, generatePassword } from "../src/utils/credentials";
import "dotenv/config";

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

async function main() {
  const businessName = process.argv[2];
  if (!businessName) {
    console.error('Usage: npm run create-seller -- "Business Name"');
    process.exit(1);
  }

  const loginId = generateLoginId();
  const plainPassword = generatePassword();
  const passwordHash = await bcrypt.hash(plainPassword, 10);

  const seller = await prisma.seller.create({
    data: { businessName, phone: loginId, passwordHash },
  });

  console.log(`Seller created: ${seller.businessName} (${seller.id})\n`);
  console.log("Hand these credentials to the client now — they are not stored in plaintext");
  console.log("anywhere and will not be shown again:\n");
  console.log(`  loginId:  ${loginId}`);
  console.log(`  password: ${plainPassword}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
