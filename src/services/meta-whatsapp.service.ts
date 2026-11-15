import axios from "axios";
import { config } from "../config/env";

export interface SendNewOrderAlertParams {
  sellerPhone: string;
  sellerName: string;
  orderNumber: string;
  quantity: number;
  productName: string;
  skuId: string;
  packDeadlineFormatted: string;
  cancellationDeadlineFormatted: string;
}

export interface SendShippingLabelParams {
  sellerPhone: string;
  orderNumber: string;
  awbNumber: string;
  courierName: string;
  labelUrl: string;
}

export interface SendOrderCancelledParams {
  sellerPhone: string;
  orderNumber: string;
  reason?: string;
}

const GRAPH_API_VERSION = "v21.0";

/**
 * Normalizes an Indian phone number to digits only with country code (e.g. 919876543210).
 */
function normalizePhone(rawPhone: string): string {
  const digits = rawPhone.replace(/\D/g, "");
  if (digits.startsWith("91") && digits.length === 12) {
    return digits;
  }
  if (digits.length === 10) {
    return `91${digits}`;
  }
  if (digits.startsWith("0") && digits.length === 11) {
    return `91${digits.slice(1)}`;
  }
  return digits;
}

function isBypassPhone(phone: string): boolean {
  const rawNumber = phone.replace(/^\+91/, "").replace(/\D/g, "");
  return (
    rawNumber === "1111111111" ||
    rawNumber === "11111111111" ||
    rawNumber.endsWith("1111111111") ||
    rawNumber === "9999900000" ||
    rawNumber === "9999999999"
  );
}

export const metaWhatsAppService = {
  /**
   * Helper to get Meta Graph API Messages endpoint URL
   */
  getMessagesEndpoint(): string {
    const phoneId = config.metaWhatsappPhoneNumberId || "MOCK_PHONE_ID";
    return `https://graph.facebook.com/${GRAPH_API_VERSION}/${phoneId}/messages`;
  },

  /**
   * Dispatches the interactive [URGENT] New Order Alert WhatsApp message to the seller via Meta Cloud API.
   */
  async sendNewOrderAlert(params: SendNewOrderAlertParams): Promise<{ success: boolean; messageId?: string; mock?: boolean; error?: string }> {
    const to = normalizePhone(params.sellerPhone);
    const orderId = params.orderNumber.replace(/^#/, "");

    // Mock / dev bypass
    if (config.externalServicesMode === "stub" || isBypassPhone(to) || !config.metaWhatsappToken) {
      console.log(`[Meta WhatsApp Mock] Dispatched New Order Alert to +${to}:
----------------------------------------------------------------------
[URGENT]
Dear ${params.sellerName},

You have received a new order on Cikka Mall with Order ID ${orderId}, for ${params.quantity} units of ${params.productName} bearing SKU ID ${params.skuId}.

You must click on *“Pack Order”* via WhatsApp or the Cikka Seller Dashboard before *${params.packDeadlineFormatted}*.

*IMPORTANT:* If you fail to click on “Pack Order” by ${params.packDeadlineFormatted}, the order will remain pending. Orders will be automatically cancelled if not dispatched within 2 days of the specified deadline, i.e., *${params.cancellationDeadlineFormatted}*. This will impact your seller performance score and eligibility for future orders.

*Please select one of the following options:*
[Pack Order (Payload: ACTION_PACK_${orderId})]   [Cancel Order (Payload: ACTION_CANCEL_${orderId})]
----------------------------------------------------------------------`);
      return { success: true, messageId: `mock_meta_${Date.now()}`, mock: true };
    }

    const payload = {
      messaging_product: "whatsapp",
      recipient_type: "individual",
      to,
      type: "template",
      template: {
        name: config.metaWhatsappTemplateOrder,
        language: {
          code: "en",
        },
        components: [
          {
            type: "body",
            parameters: [
              { type: "text", text: params.sellerName || "Seller Partner" },
              { type: "text", text: orderId },
              { type: "text", text: String(params.quantity || 1) },
              { type: "text", text: params.productName || "Product" },
              { type: "text", text: params.skuId || "SKU" },
              { type: "text", text: params.packDeadlineFormatted },
              { type: "text", text: params.cancellationDeadlineFormatted },
            ],
          },
          {
            type: "button",
            sub_type: "quick_reply",
            index: "0",
            parameters: [{ type: "payload", payload: `ACTION_PACK_${orderId}` }],
          },
          {
            type: "button",
            sub_type: "quick_reply",
            index: "1",
            parameters: [{ type: "payload", payload: `ACTION_CANCEL_${orderId}` }],
          },
        ],
      },
    };

    try {
      const response = await axios.post(this.getMessagesEndpoint(), payload, {
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${config.metaWhatsappToken}`,
        },
        timeout: 10000,
      });

      const messageId = response.data?.messages?.[0]?.id || "sent";
      console.log(`[Meta WhatsApp Cloud API] New Order Alert sent to +${to} (ID: ${messageId}) for Order #${orderId}`);
      return {
        success: true,
        messageId,
      };
    } catch (err: any) {
      const errMsg = err.response?.data?.error?.message || err.response?.data?.message || err.message;
      console.error(`[Meta WhatsApp Error] Failed sending order alert to +${to}:`, errMsg);
      return { success: false, error: errMsg };
    }
  },

  /**
   * Sends the official Shipway shipping label (PDF document) to the seller's WhatsApp chat
   * with mandatory Cikka SOP packing instructions.
   */
  async sendShippingLabelDocument(params: SendShippingLabelParams): Promise<{ success: boolean; mock?: boolean; error?: string }> {
    const to = normalizePhone(params.sellerPhone);
    const orderId = params.orderNumber.replace(/^#/, "");
    const publicUrl = config.publicBaseUrl || config.sellerPortalUrl || "https://seller.cikka.club";
    const sopUrl = `${publicUrl}/cikka-mall-order-packing-sop.docx`;

    const caption = `Print the label, securely attach it to the package, and pack the product according to Cikka Mall's Product Packaging SOP.\n\n📦 Courier: ${params.courierName}\n📑 AWB: ${params.awbNumber}\n📋 Packaging SOP: ${sopUrl}`;

    // Mock / dev bypass
    if (config.externalServicesMode === "stub" || isBypassPhone(to) || !config.metaWhatsappToken) {
      console.log(`[Meta WhatsApp Mock] Sent Shipping Label Document to +${to}:
----------------------------------------------------------------------
📄 File: Shipping_Label_${orderId}.pdf
🔗 Label URL: ${params.labelUrl}
📝 Caption: ${caption}
----------------------------------------------------------------------`);
      return { success: true, mock: true };
    }

    const payload = {
      messaging_product: "whatsapp",
      recipient_type: "individual",
      to,
      type: "document",
      document: {
        link: params.labelUrl,
        filename: `Shipping_Label_${orderId}.pdf`,
        caption,
      },
    };

    try {
      await axios.post(this.getMessagesEndpoint(), payload, {
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${config.metaWhatsappToken}`,
        },
        timeout: 10000,
      });

      console.log(`[Meta WhatsApp Cloud API] Shipping Label PDF dispatched to +${to} for Order #${orderId}`);
      return { success: true };
    } catch (err: any) {
      const errMsg = err.response?.data?.error?.message || err.response?.data?.message || err.message;
      console.error(`[Meta WhatsApp Error] Failed sending label document to +${to}:`, errMsg);

      // Fallback: send text message with direct label link if media upload fails
      try {
        await this.sendTextMessage(
          to,
          `📦 *Shipping Label Generated for Order #${orderId}*\n\nCarrier: *${params.courierName}*\nAWB: *${params.awbNumber}*\n\n🔗 *Download & Print Label:* ${params.labelUrl}\n\n*Important:* Print the label, securely attach it to the package, and pack the product according to Cikka Mall's Product Packaging SOP.\n\nDownload SOP Guide: ${sopUrl}`
        );
        return { success: true };
      } catch (fallbackErr: any) {
        return { success: false, error: errMsg };
      }
    }
  },

  /**
   * Sends confirmation that the seller selected [Cancel Order].
   */
  async sendOrderCancelledNotice(params: SendOrderCancelledParams): Promise<{ success: boolean; mock?: boolean }> {
    const to = normalizePhone(params.sellerPhone);
    const orderId = params.orderNumber.replace(/^#/, "");

    const text = `Order #${orderId} has been successfully cancelled as per your request.\n\nIf this was done in error or you need assistance fulfilling future orders, please contact Cikka Seller Support or review your Seller Dashboard.`;

    if (config.externalServicesMode === "stub" || isBypassPhone(to) || !config.metaWhatsappToken) {
      console.log(`[Meta WhatsApp Mock] Sent Order Cancelled Notice to +${to} for Order #${orderId}`);
      return { success: true, mock: true };
    }

    return this.sendTextMessage(to, text);
  },

  /**
   * Helper to send plain WhatsApp text message via Meta Cloud API
   */
  async sendTextMessage(to: string, message: string): Promise<{ success: boolean; error?: string }> {
    const recipient = normalizePhone(to);

    if (config.externalServicesMode === "stub" || isBypassPhone(recipient) || !config.metaWhatsappToken) {
      console.log(`[Meta WhatsApp Mock Text] To: +${recipient} | Message: ${message}`);
      return { success: true };
    }

    try {
      const payload = {
        messaging_product: "whatsapp",
        recipient_type: "individual",
        to: recipient,
        type: "text",
        text: {
          preview_url: false,
          body: message,
        },
      };

      await axios.post(this.getMessagesEndpoint(), payload, {
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${config.metaWhatsappToken}`,
        },
        timeout: 10000,
      });

      return { success: true };
    } catch (err: any) {
      const errMsg = err.response?.data?.error?.message || err.message;
      console.warn(`[Meta WhatsApp Text Error] Failed to send text to +${recipient}:`, errMsg);
      return { success: false, error: errMsg };
    }
  },
};

