import { randomUUID } from "crypto";
import type { BillpayLink, CreateBillpayLinkInput, SetuBillpayClient } from "./billpay.interface";

// Stub mode (EXTERNAL_SERVICES_MODE=stub): returns a fake Setu link without any network call.
export const setuBillpayStub: SetuBillpayClient = {
  async createLink(_input: CreateBillpayLinkInput): Promise<BillpayLink> {
    const id = randomUUID().replace(/-/g, "");
    return {
      link: `https://billpay-qa.setu.co/${id}`,
      sessionId: `stub-${id}`,
      traceId: `stub-trace-${id.slice(0, 12)}`,
    };
  },
};
