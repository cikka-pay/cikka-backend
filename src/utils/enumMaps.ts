import { BusinessType, FulfillmentType, SettlementCycle } from "@prisma/client";

/**
 * Maps human-readable UI values for BusinessType to Prisma enum values.
 * Also passes through already-correct enum strings for idempotency.
 */
export const BUSINESS_TYPE_MAP: Record<string, BusinessType> = {
  // UI option values from OnboardingPage.tsx
  "pvt_ltd": "PRIVATE_LIMITED",
  "proprietorship": "PROPRIETORSHIP",
  "llp": "LLP",
  "partnership": "PARTNERSHIP",
  // Human readable labels
  "Private Limited (Pvt Ltd)": "PRIVATE_LIMITED",
  "Sole Proprietorship": "PROPRIETORSHIP",
  "Proprietorship": "PROPRIETORSHIP",
  "Limited Liability Partnership (LLP)": "LLP",
  "LLP": "LLP",
  "Partnership": "PARTNERSHIP",
  // Passthrough — already correct enum values
  "PRIVATE_LIMITED": "PRIVATE_LIMITED",
};

/**
 * Maps human-readable UI values for FulfillmentType to Prisma enum values.
 */
export const FULFILLMENT_TYPE_MAP: Record<string, FulfillmentType> = {
  // UI radio values (from HTML)
  "self": "SELF",
  "3pl": "THREE_PL",
  "cikka": "CIKKA",
  // UI label values
  "Self Fulfillment": "SELF",
  "3PL Partner": "THREE_PL",
  // Passthrough
  "SELF": "SELF",
  "THREE_PL": "THREE_PL",
  "CIKKA": "CIKKA",
};

/**
 * Maps human-readable UI values for SettlementCycle to Prisma enum values.
 */
export const SETTLEMENT_CYCLE_MAP: Record<string, SettlementCycle> = {
  // UI radio values (from HTML)
  "T+1": "T_PLUS_1",
  "T+3": "T_PLUS_3",
  "T+7": "T_PLUS_7",
  "T+14": "T_PLUS_14",
  "t1": "T_PLUS_1",
  "t3": "T_PLUS_3",
  "t7": "T_PLUS_7",
  "t14": "T_PLUS_14",
  // Passthrough
  "T_PLUS_1": "T_PLUS_1",
  "T_PLUS_3": "T_PLUS_3",
  "T_PLUS_7": "T_PLUS_7",
  "T_PLUS_14": "T_PLUS_14",
};
