import { prisma } from "../config/prisma";

export type NotificationTargetScreen =
  | "wallet"
  | "orders"
  | "my-coupons"
  | "payment-history"
  | "mall-product"
  | "reward-product"
  | "security-settings"
  | "profile"
  | "notifications";

export interface NotificationTargetInput {
  screen: NotificationTargetScreen;
  params?: Record<string, string | number | boolean | undefined>;
  actionLabel?: string;
}

export interface WalletNotificationMeta extends Partial<NotificationTargetInput> {
  category?: string;
  title?: string;
  body?: string;
  extra?: Record<string, unknown>;
}

export interface CreateUserNotificationInput {
  userId: string;
  category: string;
  title: string;
  body: string;
  screen?: NotificationTargetScreen;
  params?: Record<string, string | number | boolean | undefined>;
  actionLabel?: string;
  metadata?: Record<string, unknown>;
}

type PrismaLikeClient = {
  userNotification: {
    create: typeof prisma.userNotification.create;
  };
};

function compactRecord(
  input?: Record<string, unknown>,
): Record<string, unknown> | undefined {
  if (!input) return undefined;
  const cleaned: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(input)) {
    if (value !== undefined) {
      cleaned[key] = value;
    }
  }
  return Object.keys(cleaned).length > 0 ? cleaned : undefined;
}

export function buildNotificationMetadata(
  target?: Partial<NotificationTargetInput>,
  extra?: Record<string, unknown>,
): Record<string, unknown> {
  const base = compactRecord(extra) ?? {};
  const cleanParams = compactRecord(target?.params as Record<string, unknown> | undefined);

  return {
    ...base,
    ...(target?.screen ? { screen: target.screen } : {}),
    ...(cleanParams ? { params: cleanParams } : {}),
    ...(target?.actionLabel ? { actionLabel: target.actionLabel } : {}),
  };
}

export function defaultNotificationTargetForWalletTx(
  txType: string,
  opts?: { orderId?: string; redemptionId?: string; cashPaiseDelta?: number },
): NotificationTargetInput {
  if (txType === "EARN_BBPS" || txType === "DEBIT_BBPS") {
    return {
      screen: "payment-history",
      params: { initialFilter: "utilities" },
      actionLabel: "View Receipt",
    };
  }

  if (
    txType === "EARN_ORDER" ||
    (txType === "DEBIT_REFUND" && opts?.orderId)
  ) {
    return {
      screen: "orders",
      params: opts?.orderId ? { highlightOrderId: opts.orderId } : undefined,
      actionLabel: "View Order",
    };
  }

  if (txType === "EARN_CASHBACK" || txType === "CASHBACK_REDEEM") {
    return {
      screen: "wallet",
      params: { tab: "cashback" },
      actionLabel: "Open Wallet",
    };
  }

  return {
    screen: "wallet",
    params: {
      tab: opts?.cashPaiseDelta && opts.cashPaiseDelta !== 0 ? "cashback" : "points",
    },
    actionLabel: "Open Wallet",
  };
}

const WALLET_CREDIT_OR_CASHBACK_TX_TYPES = new Set([
  "EARN_ORDER",
  "EARN_CASHBACK",
  "EARN_BBPS",
  "EARN_SIGNUP",
  "EARN_REFERRAL",
  "EARN_ADMIN",
  "REDEEM_REWARD",
  "CASHBACK_REDEEM",
  "DEBIT_BBPS",
  "DEBIT_EXPIRY",
  "DEBIT_REFUND",
  "DEBIT_ADMIN",
]);

export function isWalletCreditOrCashbackNotification(notif: {
  title?: string | null;
  body?: string | null;
  metadata?: unknown;
}): boolean {
  const meta =
    notif?.metadata && typeof notif.metadata === "object"
      ? (notif.metadata as Record<string, unknown>)
      : undefined;

  const txType = typeof meta?.txType === "string" ? meta.txType.toUpperCase() : "";
  if (txType && WALLET_CREDIT_OR_CASHBACK_TX_TYPES.has(txType)) {
    return true;
  }
  if (meta?.source === "APP_RATING") {
    return true;
  }

  const title = String(notif?.title || "").trim();
  const body = String(notif?.body || "").trim();

  return (
    /ci\s*points?\s*(?:credited|earned|added|redeemed|restored)/i.test(title) ||
    /^\s*\+?[\d,]+\s*ci\s*points?\b/i.test(title) ||
    /cashback\s*(?:credited|earned|applied|withdrawal)/i.test(title) ||
    /^\s*₹[\d,.]+\s*(?:cashback|cash\s*applied)\b/i.test(title) ||
    /^cikka\s+(?:mall|pay)\s+(?:ci\s+points|cashback)/i.test(body)
  );
}

export function isExcludedUserNotification(notif: {
  category?: string | null;
  title?: string | null;
  body?: string | null;
  metadata?: unknown;
}): boolean {
  if (isWalletCreditOrCashbackNotification(notif)) {
    return true;
  }
  const category = String(notif.category || "").trim().toLowerCase();
  if (category === "orders" || category === "order") {
    return true;
  }
  const meta =
    notif.metadata && typeof notif.metadata === "object"
      ? (notif.metadata as Record<string, unknown>)
      : null;
  const screen = String(meta?.screen || "").trim().toLowerCase();
  if (screen === "orders") {
    return true;
  }
  const title = String(notif.title || "").trim().toLowerCase();
  return (
    /^(reward\s+)?order\s+(confirmed|dispatched|shipped|delivered|cancelled)/.test(title) ||
    /^out\s+for\s+delivery/.test(title)
  );
}

export async function createUserNotificationSafely(
  input: CreateUserNotificationInput,
  client?: PrismaLikeClient,
): Promise<void> {
  if (!input.userId) return;
  if (
    isExcludedUserNotification({
      category: input.category,
      title: input.title,
      body: input.body,
      metadata: { ...(input.metadata || {}), screen: input.screen },
    })
  ) {
    return;
  }

  try {
    const db = client ?? prisma;
    const metadata = buildNotificationMetadata(
      {
        screen: input.screen,
        params: input.params,
        actionLabel: input.actionLabel,
      },
      input.metadata,
    );

    await db.userNotification.create({
      data: {
        userId: input.userId,
        category: input.category,
        title: input.title,
        body: input.body,
        metadata: metadata as any,
      },
    });
  } catch (err) {
    console.warn("[UserNotification] Non-fatal notification write error:", err);
  }
}
