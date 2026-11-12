import crypto from "crypto";
import jwt from "jsonwebtoken";
import { config } from "../config/env";
import { prisma } from "../config/prisma";
import { getSetuHeaders } from "./setu/setuAuth.service";

export type BillpayRedirectTo = "transactions" | "disputes";

export type BillpayHistoryStatus = "PENDING" | "SUCCESS" | "FAILED" | "REFUNDED";

export interface BillpayHistoryItem {
  id: string;
  setuOrderId: string | null;
  bbpsTxnId: string | null;
  refId: string | null;
  refID: string | null;
  billerId: string | null;
  billerName: string | null;
  category: string | null;
  mobileNumber: string | null;
  billAmount: string | null;
  amountPaid: string | null;
  amount: number;
  status: BillpayHistoryStatus;
  paidOn: string | null;
  bbpsRefNo: string | null;
  errorCode: string | null;
  errorMessage: string | null;
  disputeRefId: string | null;
  disputeStatus: string | null;
  createdAt: string;
  updatedAt: string;
}

export class BillpaySessionError extends Error {
  status: number;
  code: "USER_NOT_FOUND" | "INVALID_PHONE" | "PHONE_NOT_VERIFIED" | "SETU_UNAVAILABLE";

  constructor(
    message: string,
    status: number,
    code: "USER_NOT_FOUND" | "INVALID_PHONE" | "PHONE_NOT_VERIFIED" | "SETU_UNAVAILABLE"
  ) {
    super(message);
    this.name = "BillpaySessionError";
    this.status = status;
    this.code = code;
  }
}

const normalizeBillpayStatus = (rawStatus?: string | null): BillpayHistoryStatus => {
  const s = (rawStatus || "").toUpperCase();
  if (s === "SUCCESS") return "SUCCESS";
  if (s === "FAILED" || s === "EXPIRED") return "FAILED";
  if (s === "REFUNDED") return "REFUNDED";
  return "PENDING";
};

const formatMoney2 = (val: any): string | null => {
  if (val === null || val === undefined) return null;
  const num = Number(val.toString());
  if (!Number.isFinite(num)) return null;
  return num.toFixed(2);
};

export function toBillpayHistoryItem(tx: any): BillpayHistoryItem {
  const raw = (tx.rawPayload && typeof tx.rawPayload === "object" ? tx.rawPayload : {}) as Record<string, any>;
  const amountNum = tx.amount !== undefined && tx.amount !== null ? parseFloat(tx.amount.toString()) : 0;
  const amountStr = formatMoney2(tx.amount);
  const status = normalizeBillpayStatus(tx.status);

  return {
    id: tx.id,
    setuOrderId: tx.setuPaymentId || raw.setuOrderId || raw.orderId || null,
    bbpsTxnId: tx.bbpsRefNo || raw.bbpsTxnId || tx.internalTxnId || null,
    refId: tx.refID || null,
    refID: tx.refID || null,
    billerId: tx.billerId || null,
    billerName: tx.billerName || null,
    category: tx.category || null,
    mobileNumber: raw.mobileNumber || (tx.customerParams as any)?.mobileNumber || null,
    billAmount: formatMoney2(raw.billAmount) ?? amountStr,
    amountPaid: status === "SUCCESS" || status === "REFUNDED" ? amountStr : formatMoney2(raw.amountPaid) ?? amountStr,
    amount: Number.isFinite(amountNum) ? amountNum : 0,
    status,
    paidOn: tx.receiptDate
      ? new Date(tx.receiptDate).toISOString()
      : status === "SUCCESS" && tx.updatedAt
        ? new Date(tx.updatedAt).toISOString()
        : null,
    bbpsRefNo: tx.bbpsRefNo || null,
    errorCode: raw.errorCode || null,
    errorMessage: tx.errorMessage || tx.failureReason || raw.errorMessage || null,
    disputeRefId: raw.disputeRefId || raw.disputeId || null,
    disputeStatus: raw.disputeStatus || null,
    createdAt: tx.createdAt ? new Date(tx.createdAt).toISOString() : new Date().toISOString(),
    updatedAt: tx.updatedAt ? new Date(tx.updatedAt).toISOString() : new Date().toISOString(),
  };
}

export async function getUserBillpayHistory(userId: string): Promise<BillpayHistoryItem[]> {
  const transactions = await prisma.bbpsTransaction.findMany({
    where: { userId },
    orderBy: { createdAt: "desc" },
    take: 50,
  });

  return transactions.map(toBillpayHistoryItem);
}

export async function getUserBillpayHistoryItem(
  userId: string,
  idOrRef: string
): Promise<BillpayHistoryItem | null> {
  const tx = await prisma.bbpsTransaction.findFirst({
    where: {
      userId,
      OR: [
        { id: idOrRef },
        { refID: idOrRef },
        { internalTxnId: idOrRef },
        { bbpsRefNo: idOrRef },
      ],
    },
  });

  return tx ? toBillpayHistoryItem(tx) : null;
}

export interface CreateBillpaySessionInput {
  userId: string;
  categoryName?: string;
  billerId?: string;
  redirectTo?: BillpayRedirectTo;
  transactionRef?: string;
}

export interface CreateBillpaySessionResult {
  link: string;
  sessionId: string;
}

const normalizeIndianMobile = (rawPhone?: string | null): string | null => {
  if (!rawPhone) return null;
  const digits = rawPhone.replace(/\D/g, "").slice(-10);
  return /^[6-9]\d{9}$/.test(digits) ? digits : null;
};

const extractSetuLinkPayload = (data: any): { link?: string; sessionId?: string } => {
  const src = data?.data || data || {};
  const rawLink = src.link || src.url || src.shortUrl || src.paymentLink;
  const sessionId = src.sessionId || src.id || src.traceId;
  let link: string | undefined;
  if (typeof rawLink === "string" && rawLink.trim()) {
    const trimmed = rawLink.trim();
    if (/^https?:\/\//i.test(trimmed)) {
      link = trimmed;
    } else if (/^[a-z0-9.-]*setu\.co\b/i.test(trimmed)) {
      link = `https://${trimmed}`;
    }
  }
  return {
    link,
    sessionId: typeof sessionId === "string" ? sessionId : undefined,
  };
};

export async function createBillpaySessionService(
  input: CreateBillpaySessionInput
): Promise<CreateBillpaySessionResult> {
  const user = await prisma.user.findUnique({
    where: { id: input.userId },
    select: { id: true, phone: true, phoneVerified: true },
  });

  if (!user) {
    throw new BillpaySessionError("Account not found.", 404, "USER_NOT_FOUND");
  }

  const mobile = normalizeIndianMobile(user.phone);
  if (!mobile) {
    throw new BillpaySessionError("Valid Indian mobile number is required.", 400, "INVALID_PHONE");
  }

  const cleanRef = input.transactionRef?.trim() || undefined;

  if (!config.isRealExternalServices) {
    const sessionId = `setu_sess_${crypto.randomBytes(6).toString("hex")}`;
    const qs = new URLSearchParams();
    qs.set("sessionId", sessionId);
    qs.set("mobileNumber", mobile);
    if (input.redirectTo) qs.set("redirectTo", input.redirectTo);
    if (input.categoryName) qs.set("categoryName", input.categoryName);
    if (input.billerId) qs.set("billerId", input.billerId);
    if (cleanRef) qs.set("refId", cleanRef);

    const path = input.redirectTo === "disputes" ? "/disputes" : input.redirectTo === "transactions" ? "/transactions" : "";
    return {
      sessionId,
      link: `https://billpay-qa.setu.co${path}?${qs.toString()}`,
    };
  }

  const hasWhiteLabelCreds =
    Boolean(config.setuBbpsSchemeId) &&
    config.setuBbpsSchemeId !== "setu_bbps_scheme_id" &&
    Boolean(config.setuBbpsSecret) &&
    config.setuBbpsSecret !== "setu_bbps_secret";

  const hasOAuthCreds = Boolean(config.setuClientId) && Boolean(config.setuSecret);

  if (!hasWhiteLabelCreds && !hasOAuthCreds) {
    throw new BillpaySessionError(
      "Setu BBPS credentials are not configured.",
      503,
      "SETU_UNAVAILABLE"
    );
  }

  const payload: Record<string, any> = {
    mobileNumber: mobile,
    customer: { mobile },
  };
  if (config.setuOrgId) payload.orgId = config.setuOrgId;
  if (input.categoryName) payload.categoryName = input.categoryName;
  if (input.billerId) payload.billerId = input.billerId;
  if (input.redirectTo) payload.redirectTo = input.redirectTo;
  if (cleanRef) {
    payload.refId = cleanRef;
    payload.transactionRef = cleanRef;
    payload.additionalParams = { refId: cleanRef, transactionRef: cleanRef };
  }

  // Prefer White-Label BBPS link creation when schemeId/secret are configured; fall back to Setu Ethereal/OAuth API
  if (hasWhiteLabelCreds) {
    const token = jwt.sign(
      {
        aud: config.setuBbpsSchemeId,
        iat: Math.floor(Date.now() / 1000),
        jti: crypto.randomUUID(),
      },
      config.setuBbpsSecret,
      { algorithm: "HS256" }
    );

    const base = config.setuBbpsBaseUrl.replace(/\/+$/, "");
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    };
    const instanceId = config.setuBbpsProductInstanceId || config.setuProductInstanceId;
    if (instanceId) {
      headers["X-Setu-Product-Instance-Id"] = instanceId;
    }

    const candidates = [
      `${base}/utilities/bills`,
      `${base}/utilities/bills/links`,
      `${base}/billpay/links`,
    ];

    for (const endpoint of candidates) {
      try {
        const res = await fetch(endpoint, {
          method: "POST",
          headers,
          body: JSON.stringify(payload),
        });
        const data: any = await res.json().catch(() => ({}));
        if (res.ok) {
          const parsed = extractSetuLinkPayload(data);
          if (parsed.link) {
            return { link: parsed.link, sessionId: parsed.sessionId || "" };
          }
        } else {
          console.warn(`[SetuSession] White-label POST ${endpoint} failed HTTP ${res.status}`);
        }
      } catch (err: any) {
        console.warn(`[SetuSession] White-label POST ${endpoint} error:`, err?.message);
      }
    }
  }

  if (hasOAuthCreds) {
    try {
      const headers = await getSetuHeaders();
      const resolvedInstanceId =
        config.setuProductInstanceId || config.setuBbpsProductInstanceId;
      if (
        !headers["X-Setu-Product-Instance-Id"] &&
        !headers["X-Setu-Product-Instance-ID"] &&
        resolvedInstanceId
      ) {
        headers["X-Setu-Product-Instance-Id"] = resolvedInstanceId;
        headers["X-Product-Instance-Id"] = resolvedInstanceId;
      }

      const base = config.setuBaseUrl.replace(/\/+$/, "");
      const etherealHost =
        config.setuEnvironment === "production"
          ? "https://coudc.setu.co"
          : "https://qa-coudc.setu.co";
      const candidates = Array.from(
        new Set([
          `${etherealHost}/api/v1/ethereal/link`,
          `${base}/api/v1/ethereal/link`,
          `${base}/api/v2/billpay/links`,
        ])
      );

      for (const endpoint of candidates) {
        const res = await fetch(endpoint, {
          method: "POST",
          headers,
          body: JSON.stringify(payload),
        });
        const data: any = await res.json().catch(() => ({}));
        if (res.ok) {
          const parsed = extractSetuLinkPayload(data);
          if (parsed.link) {
            return { link: parsed.link, sessionId: parsed.sessionId || "" };
          }
        } else {
          console.warn(`[SetuSession] OAuth POST ${endpoint} failed HTTP ${res.status}`);
        }
      }
    } catch (err: any) {
      console.error("[SetuSession] OAuth error:", err?.message);
    }
  }

  throw new BillpaySessionError(
    "Unable to initialize Setu BillPay session right now.",
    502,
    "SETU_UNAVAILABLE"
  );
}

