/**
 * Setu BillPay — pre-built screens (spec 002).
 * We only create a one-time link; the user picks a biller and pays by UPI on Setu's screens.
 */

export type BillpayRedirectTo = "transactions" | "disputes";

export interface BillpayParam {
  name: string;
  value: string;
}

export interface CreateBillpayLinkInput {
  /** 10-digit verified mobile number of the user. */
  mobileNumber: string;
  /** Our user id; Setu echoes it back as `customerId` in webhooks. */
  custID: string;
  categoryName?: string;
  billerId?: string;
  billParams?: BillpayParam[];
  redirectTo?: BillpayRedirectTo;
  additionalInfo?: Record<string, unknown>;
}

export interface BillpayLink {
  link: string;
  sessionId: string;
  shortLink?: string;
  traceId?: string;
}

export interface SetuBillpayClient {
  createLink(input: CreateBillpayLinkInput): Promise<BillpayLink>;
}

/**
 * Raised for every Setu BillPay failure in real mode (HTTP error, network error, bad
 * response, missing config). Callers must surface it — never replace it with stub data.
 */
export class SetuBillpayError extends Error {
  /** HTTP status Setu returned, or 0 when no response was received. */
  readonly status: number;
  readonly code: string;
  readonly traceId?: string;

  constructor(message: string, opts: { status: number; code: string; traceId?: string }) {
    super(message);
    this.name = "SetuBillpayError";
    this.status = opts.status;
    this.code = opts.code;
    this.traceId = opts.traceId;
  }
}
