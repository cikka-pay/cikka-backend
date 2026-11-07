/**
 * Saved cards = the signed-in user's Razorpay customer tokens (spec 003 §9).
 *
 * Cards are saved by Razorpay Standard Checkout when the app passes `customer_id`
 * (POST /v1/customers with fail_existing=0 gives one customer per user). We never receive card
 * details. Listing / deleting go through the customer tokens API:
 *   GET    /v1/customers/:customer_id/tokens
 *   DELETE /v1/customers/:customer_id/tokens/:token_id
 * `UserSavedCard` is only a cache of those tokens (for card labels on our own screens and
 * card-id lookups); Razorpay is the source of truth and a listing refreshes it.
 * Stub mode keeps two demo cards so local builds have something to pick.
 */
import axios from "axios";
import { config, isRazorpayStubMode } from "../config/env";
import { prisma } from "../config/prisma";

const RAZORPAY_BASE_URL = "https://api.razorpay.com/v1";

function getRazorpayAuthHeaders() {
  const keyId = (process.env.RAZORPAY_KEY_ID || config.razorpayKeyId || "").trim();
  const keySecret = (process.env.RAZORPAY_KEY_SECRET || config.razorpayKeySecret || "").trim();
  if (!keyId || !keySecret) {
    throw new Error("Razorpay credentials (RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET) are not configured.");
  }
  return {
    Authorization: `Basic ${Buffer.from(`${keyId}:${keySecret}`).toString("base64")}`,
    "Content-Type": "application/json",
  };
}

/** Subset of the Razorpay token entity (customer tokens list). */
export interface RazorpayTokenEntity {
  id: string;
  method: string;
  status?: string;
  card?: {
    last4?: string | number;
    network?: string;
    issuer?: string;
    type?: string;
    expiry_month?: string | number;
    expiry_year?: string | number;
    name?: string;
  };
}

export class SavedCardError extends Error {
  constructor(public status: number, public code: string, message: string) {
    super(message);
    this.name = "SavedCardError";
  }
}

/** Demo cards shown only in stub mode. */
function stubCardsFor(userId: string, phone: string | null) {
  return [
    { bankName: "HDFC Bank", cardNetwork: "Visa", last4: "4821", expiryMonth: "08", expiryYear: "28", isDefault: true },
    { bankName: "ICICI Bank", cardNetwork: "Mastercard", last4: "9012", expiryMonth: "11", expiryYear: "29", isDefault: false },
  ].map((c) => ({
    ...c,
    userId,
    phone,
    razorpayCustomerId: null,
    razorpayTokenId: `token_stub_${userId}_${c.last4}`,
    cardType: "credit",
    cardholderName: "Demo Cardholder",
    status: "ACTIVE",
  }));
}

const activeCardsOf = (userId: string) =>
  prisma.userSavedCard.findMany({
    where: { userId, status: "ACTIVE" },
    orderBy: [{ isDefault: "desc" }, { createdAt: "desc" }],
  });

export const savedCardsService = {
  /**
   * The user's Razorpay customer id, created on first use (POST /v1/customers,
   * fail_existing=0 returns the existing customer for the same contact). null in stub mode or
   * when Razorpay cannot be reached (checkout then simply shows no saved cards).
   */
  async customerIdFor(userId: string): Promise<string | null> {
    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) return null;
    if (user.razorpayCustomerId) return user.razorpayCustomerId;
    if (isRazorpayStubMode()) return null;

    try {
      const digits = user.phone.replace(/\D/g, "").slice(-10);
      const body: Record<string, unknown> = { contact: `+91${digits}`, fail_existing: "0", notes: { cikka_user_id: user.id } };
      if (user.name && user.name.length >= 3) body.name = user.name.slice(0, 50);
      if (user.email) body.email = user.email;
      const resp = await axios.post(`${RAZORPAY_BASE_URL}/customers`, body, { headers: getRazorpayAuthHeaders(), timeout: 10000 });
      const customerId: string | undefined = resp.data?.id;
      if (!customerId) return null;
      await prisma.user.update({ where: { id: user.id }, data: { razorpayCustomerId: customerId } });
      return customerId;
    } catch (err: any) {
      console.warn(`[Razorpay Customer Notice]: ${err.response?.data?.error?.description || err.message}`);
      return null;
    }
  },

  /** The user's saved cards: Razorpay tokens of the user's own customer, cached locally. */
  async listCards(userId: string) {
    if (isRazorpayStubMode()) {
      const cached = await activeCardsOf(userId);
      if (cached.length > 0) return cached;
      const user = await prisma.user.findUnique({ where: { id: userId } });
      if (!user) return [];
      for (const c of stubCardsFor(userId, user.phone)) {
        await prisma.userSavedCard.upsert({ where: { razorpayTokenId: c.razorpayTokenId }, create: c, update: { status: "ACTIVE" } });
      }
      return activeCardsOf(userId);
    }

    const customerId = await this.customerIdFor(userId);
    if (!customerId) return [];
    const user = await prisma.user.findUnique({ where: { id: userId }, select: { phone: true } });

    let tokens: RazorpayTokenEntity[];
    try {
      const resp = await axios.get(`${RAZORPAY_BASE_URL}/customers/${customerId}/tokens`, {
        headers: getRazorpayAuthHeaders(),
        timeout: 10000,
      });
      tokens = ((resp.data?.items || []) as RazorpayTokenEntity[]).filter(
        (t) => t.method === "card" && (!t.status || t.status === "active")
      );
    } catch (err: any) {
      throw new SavedCardError(502, "RAZORPAY_UNAVAILABLE", err.response?.data?.error?.description || "Could not load saved cards.");
    }

    for (const t of tokens) {
      const existing = await prisma.userSavedCard.findUnique({ where: { razorpayTokenId: t.id } });
      if (existing && existing.userId !== userId) continue; // never move a cached token between users
      const data = {
        userId,
        phone: user?.phone ?? null,
        razorpayCustomerId: customerId,
        bankName: t.card?.issuer || "",
        cardNetwork: t.card?.network || "",
        cardType: t.card?.type || "credit",
        last4: String(t.card?.last4 ?? "").slice(-4),
        cardholderName: t.card?.name || null,
        expiryMonth: t.card?.expiry_month !== undefined ? String(t.card.expiry_month).padStart(2, "0") : null,
        expiryYear: t.card?.expiry_year !== undefined ? String(t.card.expiry_year).slice(-2) : null,
        status: "ACTIVE",
      };
      await prisma.userSavedCard.upsert({ where: { razorpayTokenId: t.id }, create: { ...data, razorpayTokenId: t.id }, update: data });
    }
    // Anything cached for this user that Razorpay no longer has (or never had: old token_hq_*) is revoked.
    await prisma.userSavedCard.updateMany({
      where: { userId, status: "ACTIVE", razorpayTokenId: { notIn: tokens.map((t) => t.id) } },
      data: { status: "REVOKED" },
    });
    return activeCardsOf(userId);
  },

  /** A cached ACTIVE card of this user, by our id or by its Razorpay token id. */
  findUserCard(userId: string, idOrToken: string) {
    return prisma.userSavedCard.findFirst({
      where: { userId, status: "ACTIVE", OR: [{ id: idOrToken }, { razorpayTokenId: idOrToken }] },
    });
  },

  /**
   * Delete one of the user's own cards at Razorpay, then revoke the cache row.
   * Returns false when the card is not this user's.
   */
  async deleteCard(userId: string, idOrToken: string): Promise<boolean> {
    const card = await this.findUserCard(userId, idOrToken);
    if (!card) return false;

    if (!isRazorpayStubMode() && card.razorpayTokenId.startsWith("token_")) {
      const customerId = await this.customerIdFor(userId);
      if (!customerId || (card.razorpayCustomerId && card.razorpayCustomerId !== customerId)) return false;
      try {
        await axios.delete(`${RAZORPAY_BASE_URL}/customers/${customerId}/tokens/${card.razorpayTokenId}`, {
          headers: getRazorpayAuthHeaders(),
          timeout: 10000,
        });
      } catch (err: any) {
        if (err.response?.status !== 404 && err.response?.status !== 400) {
          throw new SavedCardError(502, "RAZORPAY_UNAVAILABLE", err.response?.data?.error?.description || "Could not delete the card.");
        }
        // 400/404: Razorpay no longer has this token for the customer; just drop it locally.
      }
    }

    await prisma.userSavedCard.update({ where: { id: card.id }, data: { status: "REVOKED", isDefault: false } });
    return true;
  },
};
