import { config } from "../../config/env";
import { prisma } from "../../config/prisma";
import { getSetuHeaders } from "./setuAuth.service";
import { Prisma } from "../../generated/prisma/client";

export interface CustomerParamDefinition {
  paramId: string;
  paramName: string;
  dataType: "NUMERIC" | "ALPHANUMERIC" | "TEXT";
  isMandatory: boolean;
  minLength?: number;
  maxLength?: number;
  regex?: string;
  hint?: string;
}

export interface SetuBillerOutput {
  id: string;
  billerId: string;
  billerName: string;
  category: string;
  description?: string | null;
  logoUrl?: string | null;
  coverageArea?: string | null;
  customerParams: CustomerParamDefinition[];
  paymentInstruments: string[];
  fetchRequirement: string;
  supportBillValidation: string;
  isActive: boolean;
}

import { COMPREHENSIVE_BBPS_BILLERS } from "./bbpsBillersCatalog";

// Complete high-utility BBPS billers catalog
const DEFAULT_BILLERS: SetuBillerOutput[] = COMPREHENSIVE_BBPS_BILLERS;

/**
 * Normalizes category names between UI display strings and Setu category keys.
 */
export function normalizeCategory(cat?: string): string {
  if (!cat) return "";
  const cleaned = cat.trim().toLowerCase();
  if (cleaned.includes("elect")) return "Electricity";
  if (cleaned.includes("mob") || cleaned.includes("recharge")) return "Mobile Recharge";
  if (cleaned.includes("dth")) return "DTH";
  if (cleaned.includes("cable")) return "Cable TV";
  if (cleaned.includes("water")) return "Water";
  if (cleaned.includes("gas") || cleaned.includes("cylinder") || cleaned.includes("lpg")) return "Piped Gas";
  if (cleaned.includes("fastag") || cleaned.includes("toll")) return "FASTag";
  if (cleaned.includes("broadband") || cleaned.includes("internet") || cleaned.includes("fiber")) return "Broadband";
  if (cleaned.includes("loan") || cleaned.includes("emi")) return "Loan Repayment";
  if (cleaned.includes("tax") || cleaned.includes("service") || cleaned.includes("municipal") || cleaned.includes("property")) return "Taxes";
  if (cleaned.includes("gst")) return "GST Payment";
  if (cleaned.includes("insur") || cleaned.includes("lic")) return "Insurance";
  if (cleaned.includes("card")) return "Credit Card";
  return cat;
}

/**
 * Fetches billers from Setu BBPS API or retrieves cached billers from database.
 */
export async function getBillersService(params?: {
  category?: string;
  search?: string;
}): Promise<SetuBillerOutput[]> {
  const normCat = normalizeCategory(params?.category);
  const search = params?.search?.trim().toLowerCase();

  // Try live Setu BBPS API call if online and credentials present
  try {
    const headers = await getSetuHeaders();
    const url = new URL(`${config.setuBaseUrl.replace(/\/+$/, "")}/utilities/bills/billers`);
    if (normCat) {
      url.searchParams.append("category", normCat);
    }
    if (search) {
      url.searchParams.append("search", search);
    }

    const response = await fetch(url.toString(), {
      method: "GET",
      headers,
    });

    if (response.ok) {
      const data: any = await response.json();
      const rawBillers = Array.isArray(data.data) ? data.data : Array.isArray(data) ? data : [];

      if (rawBillers.length > 0) {
        // Sync to database asynchronously
        const formatted = rawBillers.map((b: any) => formatSetuBiller(b));
        await syncBillersToDatabase(formatted);
        return filterBillers(formatted, normCat, search);
      }
    }
  } catch (err: any) {
    console.warn(`[SetuBillerService] Live biller fetch fallback: ${err.message}`);
  }

  // Fallback to database cached billers combined with catalog
  try {
    const dbBillers = await prisma.bbpsBiller.findMany({
      where: {
        isActive: true,
        ...(normCat ? { category: { equals: normCat, mode: "insensitive" } } : {}),
      },
    });

    const dbFormatted: SetuBillerOutput[] = dbBillers.map((b) => ({
      id: b.id,
      billerId: b.billerId,
      billerName: b.billerName,
      category: b.category,
      description: b.description,
      logoUrl: b.logoUrl,
      coverageArea: b.coverageArea,
      customerParams: (b.paramsSchema as any) || [],
      paymentInstruments: (b.paymentInstruments as any) || ["UPI", "NET_BANKING", "DEBIT_CARD"],
      fetchRequirement: b.fetchRequirement || "MANDATORY",
      supportBillValidation: b.supportBillValidation || "OPTIONAL",
      isActive: b.isActive,
    }));

    // Merge database billers with catalog so all categories are fully populated
    const mergedMap = new Map<string, SetuBillerOutput>();
    for (const b of DEFAULT_BILLERS) {
      if (!normCat || normalizeCategory(b.category) === normCat) {
        mergedMap.set(b.billerId, b);
      }
    }
    for (const b of dbFormatted) {
      mergedMap.set(b.billerId, b);
    }

    const merged = Array.from(mergedMap.values());
    if (merged.length > 0) {
      return filterBillers(merged, normCat, search);
    }
  } catch (_e) {}

  return filterBillers(DEFAULT_BILLERS, normCat, search);
}

/**
 * Retrieves details for a specific biller by billerId.
 */
export async function getBillerDetailsService(billerId: string): Promise<SetuBillerOutput | null> {
  try {
    const dbBiller = await prisma.bbpsBiller.findUnique({
      where: { billerId },
    });

    if (dbBiller) {
      return {
        id: dbBiller.id,
        billerId: dbBiller.billerId,
        billerName: dbBiller.billerName,
        category: dbBiller.category,
        description: dbBiller.description,
        logoUrl: dbBiller.logoUrl,
        coverageArea: dbBiller.coverageArea,
        customerParams: (dbBiller.paramsSchema as any) || [],
        paymentInstruments: (dbBiller.paymentInstruments as any) || ["UPI", "NET_BANKING", "DEBIT_CARD"],
        fetchRequirement: dbBiller.fetchRequirement || "MANDATORY",
        supportBillValidation: dbBiller.supportBillValidation || "OPTIONAL",
        isActive: dbBiller.isActive,
      };
    }
  } catch (_e) {}

  const match = DEFAULT_BILLERS.find((b) => b.billerId === billerId);
  return match || null;
}

function filterBillers(list: SetuBillerOutput[], category?: string, search?: string): SetuBillerOutput[] {
  let res = list;
  if (category) {
    res = res.filter((b) => normalizeCategory(b.category).toLowerCase() === category.toLowerCase());
  }
  if (search) {
    res = res.filter(
      (b) =>
        b.billerName.toLowerCase().includes(search) ||
        b.billerId.toLowerCase().includes(search) ||
        (b.description && b.description.toLowerCase().includes(search))
    );
  }
  return res;
}

function formatSetuBiller(raw: any): SetuBillerOutput {
  return {
    id: raw.id || raw.billerId,
    billerId: raw.billerId || raw.id,
    billerName: raw.name || raw.billerName || "BBPS Biller",
    category: normalizeCategory(raw.category || "Utilities"),
    description: raw.description || null,
    logoUrl: raw.logoUrl || raw.icon || null,
    coverageArea: raw.coverageArea || raw.state || "Pan India",
    customerParams: Array.isArray(raw.customerParams)
      ? raw.customerParams
      : Array.isArray(raw.inputParams)
      ? raw.inputParams
      : [],
    paymentInstruments: raw.paymentInstruments || ["UPI", "NET_BANKING", "DEBIT_CARD"],
    fetchRequirement: raw.fetchRequirement || "MANDATORY",
    supportBillValidation: raw.supportBillValidation || "OPTIONAL",
    isActive: raw.isActive !== false,
  };
}

async function syncBillersToDatabase(billers: SetuBillerOutput[]) {
  for (const b of billers) {
    try {
      await prisma.bbpsBiller.upsert({
        where: { billerId: b.billerId },
        update: {
          billerName: b.billerName,
          category: b.category,
          description: b.description,
          logoUrl: b.logoUrl,
          coverageArea: b.coverageArea,
          paramsSchema: b.customerParams as unknown as Prisma.InputJsonValue,
          paymentInstruments: b.paymentInstruments as unknown as Prisma.InputJsonValue,
          fetchRequirement: b.fetchRequirement,
          supportBillValidation: b.supportBillValidation,
          isActive: b.isActive,
        },
        create: {
          billerId: b.billerId,
          billerName: b.billerName,
          category: b.category,
          description: b.description,
          logoUrl: b.logoUrl,
          coverageArea: b.coverageArea,
          paramsSchema: b.customerParams as unknown as Prisma.InputJsonValue,
          paymentInstruments: b.paymentInstruments as unknown as Prisma.InputJsonValue,
          fetchRequirement: b.fetchRequirement,
          supportBillValidation: b.supportBillValidation,
          isActive: b.isActive,
        },
      });
    } catch (_err) {}
  }
}

async function bootstrapDefaultBillers() {
  await syncBillersToDatabase(DEFAULT_BILLERS);
}
