-- Spec 003 §7: reversed / failed settlements must never be counted as payable.
-- Enum values are added in their own migration: a new enum value cannot be used in the
-- transaction that adds it, and the backfill in 20261107090200 uses them.
ALTER TYPE "SettlementStatus" ADD VALUE IF NOT EXISTS 'REVERSED';
ALTER TYPE "SettlementStatus" ADD VALUE IF NOT EXISTS 'FAILED';
