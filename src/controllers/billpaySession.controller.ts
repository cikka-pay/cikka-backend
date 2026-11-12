import { Request, Response } from "express";
import { asyncHandler } from "../utils/asyncHandler";
import { AUTH_ERRORS } from "../constants/errors";
import { createBillpaySessionService } from "../services/billpaySession.service";

// POST /api/bbps/session — returns a one-time Setu BillPay link for the logged-in user.
export const createBillpaySession = asyncHandler(async (req: Request, res: Response) => {
  const userId = req.user?.id;
  if (!userId) {
    res.status(401).json({ success: false, error: AUTH_ERRORS.UNAUTHORIZED });
    return;
  }

  try {
    const { link, sessionId } = await createBillpaySessionService(userId, req.body ?? {});
    res.status(200).json({ success: true, link, sessionId });
  } catch (err: any) {
    // Known service errors (400/404/502) carry a status + code; anything else goes to errorHandler.
    if (typeof err?.status === "number" && typeof err?.code === "string") {
      res.status(err.status).json({
        success: false,
        error: err.message,
        code: err.code,
        ...(err.traceId ? { traceId: err.traceId } : {}),
      });
      return;
    }
    throw err;
  }
});
