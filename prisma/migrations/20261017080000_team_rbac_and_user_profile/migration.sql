-- Columns added to schema.prisma without a migration (team RBAC #22, mobile user profile).
-- Production failed with P2022 "team_members.canViewFinancials does not exist" on seller sign-in.
-- Idempotent so it is safe if a column was already added by hand.

-- AlterTable
ALTER TABLE "team_members" ADD COLUMN IF NOT EXISTS "canViewFinancials" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "panNumber" TEXT,
ADD COLUMN IF NOT EXISTS "panVerified" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN IF NOT EXISTS "profilePic" TEXT;
