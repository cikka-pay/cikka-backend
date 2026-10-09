import { PrismaClient } from "../generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import pg from "pg";

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const adapter = new PrismaPg(pool);

// Single shared Prisma client instance. Import this everywhere instead of
// instantiating `new PrismaClient()` per-file (avoids exhausting DB connections).
export const prisma = new PrismaClient({ adapter });
