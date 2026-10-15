// Provisions (or resets the password of) an admin-panel user.
// Usage: npm run create-admin -- admin@cikka.in "Full Name" [SUPER_ADMIN|ONBOARDING_VERIFIER|COMPLIANCE_OFFICER]
import { PrismaClient } from "../src/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import pg from "pg";
import bcrypt from "bcryptjs";
import { generatePassword } from "../src/utils/credentials";
import "dotenv/config";

const ROLES = ["SUPER_ADMIN", "ONBOARDING_VERIFIER", "COMPLIANCE_OFFICER"];

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

async function main() {
  const [rawEmail, name, role = "SUPER_ADMIN"] = process.argv.slice(2);
  if (!rawEmail || !name || !ROLES.includes(role)) {
    console.error(`Usage: npm run create-admin -- <email> "<Full Name>" [${ROLES.join("|")}]`);
    process.exit(1);
  }

  const email = rawEmail.toLowerCase().trim();
  const plainPassword = generatePassword();
  const passwordHash = await bcrypt.hash(plainPassword, 10);

  const admin = await prisma.adminUser.upsert({
    where: { email },
    create: { email, name, role, passwordHash },
    update: { name, role, passwordHash, isActive: true },
  });

  console.log(`Admin ready: ${admin.email} (${admin.role})\n`);
  console.log("This password is not stored in plaintext and will not be shown again:\n");
  console.log(`  email:    ${admin.email}`);
  console.log(`  password: ${plainPassword}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
    await pool.end();
  });
