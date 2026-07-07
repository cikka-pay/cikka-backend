/**
 * Global test setup — runs before every test file.
 * Handles DB cleanup between integration test runs.
 */
import { prisma } from "../config/prisma";
import { afterAll, beforeAll } from "vitest";

beforeAll(async () => {
  // Ensure Prisma is connected
  await prisma.$connect();
});

afterAll(async () => {
  await prisma.$disconnect();
});
