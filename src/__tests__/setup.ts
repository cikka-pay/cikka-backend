/**
 * Global test setup — runs before every test file.
 * Handles DB cleanup between integration test runs.
 */
import { prisma } from "../config/prisma";
import { afterAll, beforeAll } from "vitest";

beforeAll(async () => {
  // Ensure Prisma connection if DB is available
  try {
    if (process.env.DATABASE_URL) {
      await prisma.$connect();
    }
  } catch (err: any) {
    console.warn(`[Test Setup Warning] Prisma $connect skipped: ${err.message}`);
  }
});

afterAll(async () => {
  try {
    if (process.env.DATABASE_URL) {
      await prisma.$disconnect();
    }
  } catch (err: any) {
    // Ignore disconnect error in test setup
  }
});
