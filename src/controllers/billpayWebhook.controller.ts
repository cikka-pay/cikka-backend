/**
 * billpayWebhook.controller.ts — POST /api/webhooks/setu/billpay (spec 002).
 *
 * Auth: `X-BILL-WEBHOOK-API-KEY` header, constant-time compare. Missing/wrong key, or no
 * key configured on our side → 401 (in every environment).
 * Responses: 200 {status:"acknowledged"} / 200 {status:"duplicate"}; 500 when processing
 * failed after the event was stored (Setu retries; the retry reprocesses that event).
 */

import { Request, Response } from "express";
import {
  BillpayWebhookPayload,
  getBillpayWebhookApiKey,
  handleBillpayWebhook,
  verifyBillpayWebhookApiKey,
} from "../services/billpayWebhook.service";

export async function receiveBillpayWebhook(req: Request, res: Response): Promise<void> {
  if (!getBillpayWebhookApiKey()) {
    console.error("[BillPay webhook] SETU_BILLPAY_WEBHOOK_API_KEY is not configured — rejecting delivery");
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  if (!verifyBillpayWebhookApiKey(req.get("X-BILL-WEBHOOK-API-KEY"))) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  const body = req.body as unknown;
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    res.status(400).json({ error: "Invalid payload" });
    return;
  }
  const event = (body as Record<string, unknown>).event;
  if (typeof event !== "string" || event.trim() === "") {
    res.status(400).json({ error: "Missing event" });
    return;
  }

  try {
    const result = await handleBillpayWebhook({ ...(body as Record<string, unknown>), event: event.trim() } as BillpayWebhookPayload);
    res.status(200).json(result);
  } catch (err) {
    console.error("[BillPay webhook] Processing failed:", err instanceof Error ? err.message : err);
    res.status(500).json({ status: "error" });
  }
}
