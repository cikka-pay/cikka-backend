import { PrismaClient } from "@prisma/client";

// Single shared Prisma client instance. Import this everywhere instead of
// instantiating `new PrismaClient()` per-file (avoids exhausting DB connections).
export const prisma = new PrismaClient();
