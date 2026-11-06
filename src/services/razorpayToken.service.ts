import axios from "axios";
import { config, isRazorpayStubMode } from "../config/env";
import { prisma } from "../config/prisma";

function getRazorpayAuthHeaders() {
  const keyId = (process.env.RAZORPAY_KEY_ID || config.razorpayKeyId || "").trim();
  const keySecret = (process.env.RAZORPAY_KEY_SECRET || config.razorpayKeySecret || "").trim();

  if (!keyId || !keySecret) {
    throw new Error("Razorpay credentials (RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET) are not configured.");
  }

  const base64Auth = Buffer.from(`${keyId}:${keySecret}`).toString("base64");

  return {
    Authorization: `Basic ${base64Auth}`,
    "Content-Type": "application/json",
  };
}

export interface SaveTokenDTO {
  userId: string;
  bankName: string;
  cardNetwork: string;
  cardType?: string;
  last4: string;
  cardholderName?: string;
  expiryMonth?: string;
  expiryYear?: string;
  isDefault?: boolean;
}

/** Demo cards shown only in stub mode, so local builds have something to pick. */
function stubCardsFor(userId: string, phone: string | null) {
  const stamp = Date.now();
  return [
    { bankName: "HDFC Bank", cardNetwork: "Visa", last4: "4821", expiryMonth: "08", expiryYear: "28", isDefault: true },
    { bankName: "ICICI Bank", cardNetwork: "Mastercard", last4: "9012", expiryMonth: "11", expiryYear: "29", isDefault: false },
  ].map((c) => ({
    ...c,
    userId,
    phone,
    razorpayCustomerId: null,
    razorpayTokenId: `token_stub_${userId.slice(0, 8)}_${stamp}_${c.last4}`,
    cardType: "credit",
    cardholderName: "Demo Cardholder",
    status: "ACTIVE",
  }));
}

export const razorpayTokenService = {
  /**
   * 1. Get or create the Razorpay Customer for a user (POST /v1/customers, fail_existing=0).
   * Uses the user's own phone/email only; returns null when it cannot be created.
   */
  async getOrCreateCustomer(user: { phone: string; email?: string | null; name?: string | null }): Promise<string | null> {
    if (isRazorpayStubMode()) return null;
    const headers = getRazorpayAuthHeaders();

    try {
      const body: Record<string, unknown> = {
        contact: user.phone.replace(/\D/g, "").slice(-10),
        fail_existing: 0, // Returns existing customer if already registered
      };
      if (user.name) body.name = user.name;
      if (user.email) body.email = user.email;
      const resp = await axios.post("https://api.razorpay.com/v1/customers", body, { headers, timeout: 10000 });
      return resp.data?.id || null;
    } catch (err: any) {
      console.warn(`[Razorpay Customer Notice]: ${err.response?.data?.error?.description || err.message}`);
      return null;
    }
  },

  /**
   * 2. Saved cards of this user only. No fake cards outside stub mode.
   */
  async getSavedCards(userId: string) {
    const where = { userId, status: "ACTIVE" };
    let cards = await prisma.userSavedCard.findMany({
      where,
      orderBy: [{ isDefault: "desc" }, { createdAt: "desc" }],
    });

    if (cards.length === 0 && isRazorpayStubMode()) {
      const user = await prisma.user.findUnique({ where: { id: userId } });
      if (user) {
        for (const c of stubCardsFor(userId, user.phone)) {
          await prisma.userSavedCard.create({ data: c });
        }
        cards = await prisma.userSavedCard.findMany({
          where,
          orderBy: [{ isDefault: "desc" }, { createdAt: "desc" }],
        });
      }
    }

    return cards;
  },

  /**
   * 3. Record a card for this user (last4/network metadata only — no PAN is ever stored).
   */
  async saveCardToken(data: SaveTokenDTO) {
    const user = await prisma.user.findUnique({ where: { id: data.userId } });
    if (!user) throw new Error("User not found");

    const customerId = await this.getOrCreateCustomer(user);
    const tokenId = `token_hq_${Date.now()}_${data.last4}`;

    if (data.isDefault) {
      await prisma.userSavedCard.updateMany({
        where: { userId: user.id },
        data: { isDefault: false },
      });
    }

    return prisma.userSavedCard.create({
      data: {
        phone: user.phone,
        userId: user.id,
        razorpayCustomerId: customerId,
        razorpayTokenId: tokenId,
        bankName: data.bankName,
        cardNetwork: data.cardNetwork,
        cardType: data.cardType || "credit",
        last4: data.last4,
        cardholderName: data.cardholderName || user.name || null,
        expiryMonth: data.expiryMonth || null,
        expiryYear: data.expiryYear || null,
        isDefault: Boolean(data.isDefault),
        status: "ACTIVE",
      },
    });
  },

  /**
   * 4. Revoke a card token — only the owner's card. Returns false when not found.
   */
  async deleteCardToken(id: string, userId: string): Promise<boolean> {
    const result = await prisma.userSavedCard.updateMany({
      where: { id, userId },
      data: { status: "REVOKED" },
    });
    return result.count > 0;
  },
};
