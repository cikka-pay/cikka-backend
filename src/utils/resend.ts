import dotenv from "dotenv";
dotenv.config();

export interface SendEmailPayload {
  to: string;
  sellerName?: string;
}

export interface SendRejectionEmailPayload {
  to: string;
  sellerName?: string;
  reason?: string;
  uploadLink?: string;
}

export interface SendMissingDocPayload {
  to: string;
  sellerName?: string;
  documentTitle: string;
  reason: string;
  uploadLink?: string;
}

export interface SendOtpPayload {
  to: string;
  code: string;
  purpose?: string;
}

export interface SendTeamInvitePayload {
  to: string;
  inviteeName: string;
  businessName: string;
  role: string;
  otpCode: string;
  loginUrl?: string;
}

export interface EmailLogEntry {
  id: string;
  to: string;
  subject: string;
  template: string;
  status: "SENT" | "FAILED";
  resendId?: string;
  error?: string;
  sentAt: string;
}

// In-memory circular log for admin dashboard visibility
const recentEmailLogs: EmailLogEntry[] = [];
const MAX_LOGS = 100;

export function logEmailDispatch(entry: Omit<EmailLogEntry, "id" | "sentAt">) {
  const fullEntry: EmailLogEntry = {
    ...entry,
    id: `log_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
    sentAt: new Date().toISOString(),
  };
  recentEmailLogs.unshift(fullEntry);
  if (recentEmailLogs.length > MAX_LOGS) {
    recentEmailLogs.pop();
  }
}

export function getRecentEmailLogs(): EmailLogEntry[] {
  return [...recentEmailLogs];
}

const DEFAULT_FROM_EMAIL = "noreply@cikka.club";
const DEFAULT_PORTAL_URL = (
  process.env.SELLER_PORTAL_URL ||
  process.env.FRONTEND_URL ||
  "https://seller.cikka.club"
).replace(/\/+$/, "");

/**
 * Core function to send emails via Resend REST API (https://api.resend.com/emails)
 * Delivers directly to all real recipient email addresses.
 */
export async function sendResendMail(options: {
  to: string;
  subject: string;
  html: string;
  templateName?: string;
}): Promise<{ success: boolean; id?: string; error?: string }> {
  const templateName = options.templateName || "custom";
  try {
    const apiKey = (process.env.RESEND_API_KEY || "").trim();
    const fromEmail = (process.env.RESEND_FROM_EMAIL || DEFAULT_FROM_EMAIL).trim();

    if (!options.to || !options.to.includes("@")) {
      const err = `Invalid recipient email address: "${options.to}"`;
      console.error("[Resend Error]", err);
      logEmailDispatch({
        to: options.to,
        subject: options.subject,
        template: templateName,
        status: "FAILED",
        error: err,
      });
      return { success: false, error: err };
    }

    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: `Cikka Team <${fromEmail}>`,
        to: [options.to],
        subject: options.subject,
        html: options.html,
      }),
    });

    const data = (await response.json()) as any;

    if (!response.ok) {
      const errorMsg = data.message || "Failed to send email via Resend";
      console.error("[Resend API Error]", data);
      logEmailDispatch({
        to: options.to,
        subject: options.subject,
        template: templateName,
        status: "FAILED",
        error: errorMsg,
      });
      return { success: false, error: errorMsg };
    }

    console.log(`[Resend API Success] Email sent to ${options.to}, Resend ID: ${data.id}`);
    logEmailDispatch({
      to: options.to,
      subject: options.subject,
      template: templateName,
      status: "SENT",
      resendId: data.id,
    });

    return { success: true, id: data.id };
  } catch (error: any) {
    const errText = error?.message || "Internal email transport error";
    console.error("[Resend Exception]", error);
    logEmailDispatch({
      to: options.to,
      subject: options.subject,
      template: templateName,
      status: "FAILED",
      error: errText,
    });
    return { success: false, error: errText };
  }
}

const CIKKA_LOGO_URL = "https://seller.cikka.club/logo.png";

const SOCIAL_LINKS = {
  linkedin: "https://www.linkedin.com/company/cikkaclub/",
  x: "https://x.com/Cikkaclub",
  instagram: "https://www.instagram.com/cikka.club/",
};

// Universal email-safe PNG icons (Hosted on high-speed CDN, fully loaded by Gmail Image Proxy, Outlook, Apple Mail)
const SOCIAL_ICONS = {
  linkedin: "https://img.icons8.com/ios-filled/50/7c3aed/linkedin.png",
  x: "https://img.icons8.com/ios-filled/50/7c3aed/twitterx--v1.png",
  instagram: "https://img.icons8.com/ios-filled/50/7c3aed/instagram-new.png",
};

interface CikkaMailLayoutProps {
  subject: string;
  badge?: {
    text: string;
    type?: "purple" | "green" | "red" | "amber" | "blue";
  };
  headline: string;
  bodyHtml: string;
}

/**
 * Universal email layout matching the modern Cikka aesthetic:
 * - Minimal purplish boundary / background (#f6f3fc) replacing dark container
 * - Header block with Cikka official logo
 * - Responsive white card container preserving all merchant content
 * - Social section with LinkedIn, Instagram, and X SVG redirect links
 */
export function renderCikkaMailLayout(props: CikkaMailLayoutProps): string {
  const badgeStyles = {
    purple: "color: #7c3aed; background: #f5f3ff; border: 1px solid #ddd6fe;",
    green: "color: #059669; background: #ecfdf5; border: 1px solid #a7f3d0;",
    red: "color: #dc2626; background: #fef2f2; border: 1px solid #fecaca;",
    amber: "color: #d97706; background: #fffbeb; border: 1px solid #fde68a;",
    blue: "color: #0284c7; background: #f0f9ff; border: 1px solid #bae6fd;",
  };

  const badgeStyle = props.badge ? (badgeStyles[props.badge.type || "purple"] || badgeStyles.purple) : "";

  return `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${props.subject}</title>
  <style>
    body {
      margin: 0;
      padding: 32px 12px;
      background-color: #f6f3fc;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
      color: #0f172a;
      -webkit-font-smoothing: antialiased;
    }
    .main-wrapper {
      max-width: 560px;
      margin: 0 auto;
    }
    .email-card {
      background-color: #ffffff;
      border-radius: 20px;
      border: 1.5px solid #ede9fe;
      box-shadow: 0 10px 30px rgba(124, 58, 237, 0.06);
      overflow: hidden;
    }
    .badge {
      display: inline-block;
      font-size: 11px;
      font-weight: 700;
      letter-spacing: 1.2px;
      border-radius: 999px;
      padding: 4px 14px;
      text-transform: uppercase;
      margin-bottom: 18px;
    }
    .title {
      font-size: 22px;
      font-weight: 800;
      color: #0f172a;
      margin: 0 0 18px 0;
      line-height: 1.35;
      letter-spacing: -0.4px;
    }
    p {
      font-size: 14px;
      line-height: 1.6;
      color: #334155;
      margin: 14px 0;
    }
    .btn {
      display: inline-block;
      background: #7c3aed;
      color: #ffffff !important;
      font-weight: 700;
      font-size: 13px;
      letter-spacing: 0.5px;
      text-transform: uppercase;
      text-decoration: none;
      padding: 14px 30px;
      border-radius: 999px;
      box-shadow: 0 4px 14px rgba(124, 58, 237, 0.3);
      margin: 18px 0;
    }
    .social-btn {
      display: inline-block;
      width: 40px;
      height: 40px;
      line-height: 40px;
      background: #ffffff;
      border: 1.5px solid #ede9fe;
      border-radius: 50%;
      margin: 0 6px;
      text-align: center;
      vertical-align: middle;
      text-decoration: none;
      box-shadow: 0 2px 8px rgba(124, 58, 237, 0.08);
    }
  </style>
</head>
<body style="margin: 0; padding: 32px 12px; background-color: #f6f3fc; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; color: #0f172a;">
  <div class="main-wrapper" style="max-width: 560px; margin: 0 auto;">
    
    <!-- Outer boundary is minimal purplish: White card with subtle purplish border and shadow -->
    <div class="email-card" style="background-color: #ffffff; border-radius: 20px; border: 1.5px solid #ede9fe; box-shadow: 0 10px 30px rgba(124, 58, 237, 0.06); overflow: hidden;">
      
      <!-- Top Header with Cikka Official Logo (Dark Purplish Background without circle) -->
      <table cellpadding="0" cellspacing="0" border="0" width="100%" style="background: #1b0a33; background: linear-gradient(135deg, #2b1052 0%, #120524 100%);">
        <tr>
          <td style="padding: 18px 24px;">
            <table cellpadding="0" cellspacing="0" border="0">
              <tr>
                <td style="vertical-align: middle; padding-right: 12px; width: 36px;">
                  <a href="${DEFAULT_PORTAL_URL}" target="_blank" rel="noopener noreferrer" style="text-decoration: none; display: block; line-height: 0;">
                    <img src="${CIKKA_LOGO_URL}" alt="Cikka" width="36" height="36" style="display: block; width: 36px; height: 36px; object-fit: contain; border: 0;" />
                  </a>
                </td>
                <td style="vertical-align: middle;">
                  <span style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; font-size: 18px; font-weight: 800; color: #ffffff; letter-spacing: -0.3px; line-height: 1.2; display: block;">CIKKA</span>
                  <span style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; font-size: 11px; font-weight: 600; color: #c4b5fd; letter-spacing: 0.8px; text-transform: uppercase; line-height: 1.3; display: block; margin-top: 2px;">Seller Network &bull; Official</span>
                </td>
              </tr>
            </table>
          </td>
        </tr>
      </table>

      <!-- Main Email Content (Preserving exact merchant content) -->
      <div style="padding: 32px 28px 24px 28px;">
        ${props.badge ? `
        <div style="margin-bottom: 18px;">
          <span style="display: inline-block; font-size: 11px; font-weight: 700; letter-spacing: 1.2px; border-radius: 999px; padding: 4px 14px; text-transform: uppercase; ${badgeStyle}">
            ${props.badge.text}
          </span>
        </div>` : ""}

        <h1 style="font-size: 22px; font-weight: 800; color: #0f172a; margin: 0 0 18px 0; line-height: 1.35; letter-spacing: -0.4px;">
          ${props.headline}
        </h1>

        <div style="font-size: 14px; line-height: 1.6; color: #334155;">
          ${props.bodyHtml}
        </div>

        <div style="margin-top: 32px; padding-top: 20px; border-top: 1px solid #f1f5f9; font-size: 13px; color: #64748b; line-height: 1.6;">
          Cheers,<br>
          <strong style="color: #0f172a; font-size: 14px;">Team Cikka</strong><br>
          <a href="mailto:support@cikka.club" style="color: #7c3aed; text-decoration: none; font-size: 12px; font-weight: 600;">support@cikka.club</a>
        </div>
      </div>
    </div>

    <!-- Minimal Purplish Footer with Social SVG Redirects & Platform Updates -->
    <div style="margin-top: 32px; text-align: center; padding: 0 16px;">
      <p style="margin: 0 0 16px 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; font-size: 13px; font-weight: 600; color: #6d28d9; letter-spacing: 0.3px;">
        Want updates through more platforms?
      </p>

      <!-- Official Social Icons in serial order: 1. LinkedIn, 2. X, 3. Instagram -->
      <table cellpadding="0" cellspacing="0" border="0" align="center" style="margin: 0 auto; border-collapse: separate; border-spacing: 12px 0;">
        <tr>
          <!-- 1. LinkedIn -->
          <td align="center" valign="middle" style="padding: 0; width: 44px; height: 44px;">
            <a href="${SOCIAL_LINKS.linkedin}" target="_blank" rel="noopener noreferrer" style="display: block; width: 44px; height: 44px; background-color: #ffffff; border: 1.5px solid #ede9fe; border-radius: 50%; text-decoration: none; box-shadow: 0 2px 8px rgba(124, 58, 237, 0.08); overflow: hidden;" title="Follow Cikka on LinkedIn">
              <table cellpadding="0" cellspacing="0" border="0" width="44" height="44" style="width: 44px; height: 44px; margin: 0; padding: 0; border-collapse: collapse;">
                <tr>
                  <td align="center" valign="middle" style="width: 44px; height: 44px; text-align: center; vertical-align: middle; padding: 0; line-height: 0;">
                    <img src="${SOCIAL_ICONS.linkedin}" alt="LinkedIn" width="20" height="20" style="display: block; margin: 0 auto; width: 20px; height: 20px; border: 0; outline: none; text-decoration: none;" />
                  </td>
                </tr>
              </table>
            </a>
          </td>

          <!-- 2. X (Twitter) -->
          <td align="center" valign="middle" style="padding: 0; width: 44px; height: 44px;">
            <a href="${SOCIAL_LINKS.x}" target="_blank" rel="noopener noreferrer" style="display: block; width: 44px; height: 44px; background-color: #ffffff; border: 1.5px solid #ede9fe; border-radius: 50%; text-decoration: none; box-shadow: 0 2px 8px rgba(124, 58, 237, 0.08); overflow: hidden;" title="Follow Cikka on X">
              <table cellpadding="0" cellspacing="0" border="0" width="44" height="44" style="width: 44px; height: 44px; margin: 0; padding: 0; border-collapse: collapse;">
                <tr>
                  <td align="center" valign="middle" style="width: 44px; height: 44px; text-align: center; vertical-align: middle; padding: 0; line-height: 0;">
                    <img src="${SOCIAL_ICONS.x}" alt="X" width="18" height="18" style="display: block; margin: 0 auto; width: 18px; height: 18px; border: 0; outline: none; text-decoration: none;" />
                  </td>
                </tr>
              </table>
            </a>
          </td>

          <!-- 3. Instagram -->
          <td align="center" valign="middle" style="padding: 0; width: 44px; height: 44px;">
            <a href="${SOCIAL_LINKS.instagram}" target="_blank" rel="noopener noreferrer" style="display: block; width: 44px; height: 44px; background-color: #ffffff; border: 1.5px solid #ede9fe; border-radius: 50%; text-decoration: none; box-shadow: 0 2px 8px rgba(124, 58, 237, 0.08); overflow: hidden;" title="Follow Cikka on Instagram">
              <table cellpadding="0" cellspacing="0" border="0" width="44" height="44" style="width: 44px; height: 44px; margin: 0; padding: 0; border-collapse: collapse;">
                <tr>
                  <td align="center" valign="middle" style="width: 44px; height: 44px; text-align: center; vertical-align: middle; padding: 0; line-height: 0;">
                    <img src="${SOCIAL_ICONS.instagram}" alt="Instagram" width="20" height="20" style="display: block; margin: 0 auto; width: 20px; height: 20px; border: 0; outline: none; text-decoration: none;" />
                  </td>
                </tr>
              </table>
            </a>
          </td>
        </tr>
      </table>

      <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; font-size: 12px; color: #64748b; line-height: 1.8;">
        <p style="margin: 0;">Cikka Club &bull; Modern Social &amp; Commerce Platform</p>
        <p style="margin: 4px 0 0 0;">
          <a href="mailto:support@cikka.club" style="color: #7c3aed; text-decoration: none; font-weight: 600;">support@cikka.club</a> &bull;
          <a href="${DEFAULT_PORTAL_URL}" style="color: #7c3aed; text-decoration: none; font-weight: 600;">seller.cikka.club</a>
        </p>
      </div>
    </div>

  </div>
</body>
</html>
  `.trim();
}

/**
 * Builders for all 6 template flows
 */
export function buildWaitlistReviewHtml(sellerName: string): string {
  const subject = "We've received your seller application";
  const bodyHtml = `
    <p>Hi <strong style="color: #0f172a;">${sellerName}</strong>,</p>
    <p>Got it &mdash; your seller onboarding application and verification documents have safely landed with our onboarding compliance team.</p>
    
    <div style="background: #fbf9ff; border: 1.5px solid #ede9fe; border-radius: 12px; padding: 14px 18px; margin: 20px 0;">
      <p style="margin: 0; font-size: 13px; color: #6d28d9; font-weight: 700;">&#9203; Standard Review SLA: 3 to 4 business hours</p>
    </div>

    <p>Our merchant operations team is currently verifying your GSTIN, PAN, and banking credentials. If any document needs clarification, we will notify you directly here in your inbox.</p>
    <p>No further action is required from you right now. You can track your real-time status anytime in the seller portal.</p>

    <div style="text-align: center; margin: 26px 0 10px 0;">
      <a href="${DEFAULT_PORTAL_URL}/onboarding" style="display: inline-block; background: #7c3aed; color: #ffffff !important; font-weight: 700; font-size: 13px; letter-spacing: 0.5px; text-transform: uppercase; text-decoration: none; padding: 14px 32px; border-radius: 999px; box-shadow: 0 4px 14px rgba(124, 58, 237, 0.3);">
        Check Application Status &rarr;
      </a>
    </div>
  `;

  return renderCikkaMailLayout({
    subject,
    badge: { text: "SELLER • APPLICATION UNDER REVIEW", type: "purple" },
    headline: "We've received your seller application",
    bodyHtml,
  });
}

export function buildSellerWelcomeHtml(sellerName: string): string {
  const subject = `Welcome to Cikka, ${sellerName} — you're officially live`;
  const bodyHtml = `
    <p>Hi <strong style="color: #0f172a;">${sellerName}</strong>,</p>
    <p>Congratulations! Your <strong>Cikka</strong> merchant store is fully verified and officially live.</p>
    
    <p>Here is what we recommend doing next to start generating sales:</p>
    <ol style="font-size: 14px; line-height: 1.8; color: #334155; padding-left: 20px; margin: 16px 0;">
      <li style="margin-bottom: 8px;"><strong>Add Your Products:</strong> Create your product catalog or sync your existing inventory.</li>
      <li style="margin-bottom: 8px;"><strong>Confirm Logistics:</strong> Review pickup address &amp; courier SLAs for automatic label generation.</li>
      <li style="margin-bottom: 8px;"><strong>Track Orders &amp; Settlements:</strong> Monitor live orders and automatic bank settlements.</li>
    </ol>

    <div style="text-align: center; margin: 28px 0 14px 0;">
      <a href="${DEFAULT_PORTAL_URL}/dashboard" style="display: inline-block; background: #7c3aed; color: #ffffff !important; font-weight: 700; font-size: 13px; letter-spacing: 0.5px; text-transform: uppercase; text-decoration: none; padding: 14px 32px; border-radius: 999px; box-shadow: 0 4px 14px rgba(124, 58, 237, 0.3);">
        Launch Seller Dashboard &rarr;
      </a>
    </div>

    <p style="margin-top: 20px;">If you get stuck anywhere, our team is one email away at <a href="mailto:support@cikka.club" style="color: #7c3aed; text-decoration: none; font-weight: 600;">support@cikka.club</a>.</p>
    <p>Excited to have you with us,</p>
  `;

  return renderCikkaMailLayout({
    subject,
    badge: { text: "SELLER • ACCOUNT ACTIVATED • LIVE", type: "green" },
    headline: `Welcome to Cikka, ${sellerName} — you're officially live`,
    bodyHtml,
  });
}

export function buildSellerRejectionHtml(sellerName: string, reason: string, uploadLink: string): string {
  const subject = "Action Required: Update your Cikka seller verification details";
  const bodyHtml = `
    <p>Hi <strong style="color: #0f172a;">${sellerName}</strong>,</p>
    <p>During our review of your seller application, our verification team noticed an item that needs your attention:</p>
    
    <div style="background: #fef2f2; border: 1.5px solid #fecaca; border-radius: 12px; padding: 16px 20px; margin: 20px 0;">
      <p style="margin: 0; color: #991b1b; font-size: 13px; line-height: 1.5;">
        <strong style="color: #dc2626;">Reason:</strong> ${reason}
      </p>
    </div>

    <p>Please update or re-upload the requested information to resume verification:</p>
    <div style="text-align: center; margin: 26px 0 14px 0;">
      <a href="${uploadLink}" style="display: inline-block; background: #7c3aed; color: #ffffff !important; font-weight: 700; font-size: 13px; letter-spacing: 0.5px; text-transform: uppercase; text-decoration: none; padding: 14px 32px; border-radius: 999px; box-shadow: 0 4px 14px rgba(124, 58, 237, 0.3);">
        Update Documents &rarr;
      </a>
    </div>

    <p style="margin-top: 20px;">Once updated, our team will immediately pick your application back up. If something isn't clear, simply reply to this email or contact us at <a href="mailto:support@cikka.club" style="color: #7c3aed; text-decoration: none; font-weight: 600;">support@cikka.club</a>.</p>
  `;

  return renderCikkaMailLayout({
    subject,
    badge: { text: "SELLER • ACTION REQUIRED", type: "red" },
    headline: "Verification Update Needed",
    bodyHtml,
  });
}

export function buildMissingDocumentHtml(sellerName: string, documentTitle: string, reason: string, uploadLink: string): string {
  const subject = `Action Required: Document Issue (${documentTitle})`;
  const bodyHtml = `
    <p>Hi <strong style="color: #0f172a;">${sellerName}</strong>,</p>
    <p>Our verification team reviewed your submitted documents and noticed an issue with your <strong>${documentTitle}</strong>:</p>
    
    <div style="background: #fffbeb; border: 1.5px solid #fde68a; border-radius: 12px; padding: 16px 20px; margin: 20px 0;">
      <p style="margin: 0 0 6px 0; font-size: 13px; color: #334155;"><strong style="color: #7c3aed;">Document:</strong> ${documentTitle}</p>
      <p style="margin: 0; font-size: 13px; color: #b45309;"><strong style="color: #dc2626;">Reason:</strong> ${reason}</p>
    </div>

    <p>Please re-upload a clear and valid copy of your ${documentTitle} so we can complete your verification without delay:</p>
    <div style="text-align: center; margin: 26px 0 14px 0;">
      <a href="${uploadLink}" style="display: inline-block; background: #7c3aed; color: #ffffff !important; font-weight: 700; font-size: 13px; letter-spacing: 0.5px; text-transform: uppercase; text-decoration: none; padding: 14px 32px; border-radius: 999px; box-shadow: 0 4px 14px rgba(124, 58, 237, 0.3);">
        Re-upload ${documentTitle} &rarr;
      </a>
    </div>

    <p style="margin-top: 20px;">If you have any questions, reach out to us at <a href="mailto:support@cikka.club" style="color: #7c3aed; text-decoration: none; font-weight: 600;">support@cikka.club</a>.</p>
  `;

  return renderCikkaMailLayout({
    subject,
    badge: { text: `DOCUMENT RE-SUBMISSION • ${documentTitle.toUpperCase()}`, type: "amber" },
    headline: `Document Update Needed: ${documentTitle}`,
    bodyHtml,
  });
}

export function buildOtpEmailHtml(code: string, purpose: string): string {
  const subject = `Your Cikka Verification Code: ${code}`;
  const bodyHtml = `
    <p style="text-align: center;">Enter the 6-digit verification code below to complete your ${purpose}:</p>
    
    <div style="background: #fbf9ff; border: 2px solid #7c3aed; border-radius: 16px; padding: 20px 24px; margin: 24px auto; letter-spacing: 10px; font-size: 34px; font-weight: 800; color: #6d28d9; text-align: center; font-family: ui-monospace, Menlo, Monaco, 'Courier New', monospace; max-width: 320px;">
      ${code}
    </div>

    <p style="font-size: 12px; color: #64748b; text-align: center; margin-top: 18px; line-height: 1.5;">
      This verification code expires in <strong>10 minutes</strong>.<br>
      If you did not request this code, you can safely ignore this email.
    </p>
  `;

  return renderCikkaMailLayout({
    subject,
    headline: "Verify Your Email Address",
    bodyHtml,
  });
}

export function buildTeamInviteHtml(inviteeName: string, businessName: string, role: string, otpCode: string, loginUrl: string): string {
  const subject = `You've been invited to join ${businessName} on Cikka`;
  const bodyHtml = `
    <p>Hi <strong style="color: #0f172a;">${inviteeName}</strong>,</p>
    <p>You have been invited to join the seller team at <strong>${businessName}</strong> on Cikka.</p>
    
    <div style="background: #fbf9ff; border: 1.5px solid #ede9fe; border-radius: 14px; padding: 18px 20px; margin: 20px 0;">
      <p style="margin: 0 0 8px 0; font-size: 13px; color: #334155;"><strong>Store:</strong> ${businessName}</p>
      <p style="margin: 0 0 8px 0; font-size: 13px; color: #334155;"><strong>Assigned Role:</strong> <span style="color: #7c3aed; font-weight: 700;">${role}</span></p>
      <p style="margin: 0; font-size: 13px; color: #334155;"><strong>Verification Code:</strong> <span style="color: #6d28d9; font-weight: 800; font-family: monospace; font-size: 18px; letter-spacing: 2px;">${otpCode}</span></p>
    </div>

    <p>Sign in using your mobile number and the verification code above to access your team dashboard:</p>
    <div style="text-align: center; margin: 26px 0 14px 0;">
      <a href="${loginUrl}" style="display: inline-block; background: #7c3aed; color: #ffffff !important; font-weight: 700; font-size: 13px; letter-spacing: 0.5px; text-transform: uppercase; text-decoration: none; padding: 14px 32px; border-radius: 999px; box-shadow: 0 4px 14px rgba(124, 58, 237, 0.3);">
        Sign In to Dashboard &rarr;
      </a>
    </div>

    <p style="margin-top: 20px;">If you have any questions, reach out to us at <a href="mailto:support@cikka.club" style="color: #7c3aed; text-decoration: none; font-weight: 600;">support@cikka.club</a>.</p>
  `;

  return renderCikkaMailLayout({
    subject,
    badge: { text: `TEAM INVITATION • ${role.toUpperCase()}`, type: "blue" },
    headline: `Join ${businessName} on Cikka`,
    bodyHtml,
  });
}

/**
 * Flow #1: Email sent when seller completes onboarding form / waitlist signup
 * Trigger: Seller completes Step 6 on Onboarding page
 */
export async function sendSellerWaitlistEmail(payload: SendEmailPayload) {
  const sellerName = payload.sellerName?.trim() || "Partner";
  const subject = "We've received your seller application";
  const html = buildWaitlistReviewHtml(sellerName);

  return sendResendMail({
    to: payload.to,
    subject,
    html,
    templateName: "waitlist_review",
  });
}

/**
 * Flow #2: Email sent when Admin approves seller in Admin Seller Dashboard
 * Trigger: Admin clicks "Approve & Verify Seller"
 */
export async function sendSellerWelcomeEmail(payload: SendEmailPayload) {
  const sellerName = payload.sellerName?.trim() || "Partner";
  const subject = `Welcome to Cikka, ${sellerName} — you're officially live`;
  const html = buildSellerWelcomeHtml(sellerName);

  return sendResendMail({
    to: payload.to,
    subject,
    html,
    templateName: "seller_welcome",
  });
}

/**
 * Flow #3: Email sent when seller verification hits a snag or requires re-submission
 * Trigger: Admin clicks "Reject Application" button
 */
export async function sendSellerRejectionEmail(payload: SendRejectionEmailPayload) {
  const sellerName = payload.sellerName?.trim() || "Partner";
  const reason = payload.reason?.trim() || "Document verification details required updating";
  const uploadLink = payload.uploadLink || `${DEFAULT_PORTAL_URL}/onboarding`;
  const subject = "Action Required: Update your Cikka seller verification details";
  const html = buildSellerRejectionHtml(sellerName, reason, uploadLink);

  return sendResendMail({
    to: payload.to,
    subject,
    html,
    templateName: "seller_rejection",
  });
}

/**
 * Flow #4: Missing or invalid document notification
 * Trigger: Admin flags a specific document in admin review
 */
export async function sendMissingDocumentEmail(payload: SendMissingDocPayload) {
  const sellerName = payload.sellerName?.trim() || "Partner";
  const uploadLink = payload.uploadLink || `${DEFAULT_PORTAL_URL}/onboarding`;
  const subject = `Action Required: Document Issue (${payload.documentTitle})`;
  const html = buildMissingDocumentHtml(sellerName, payload.documentTitle, payload.reason, uploadLink);

  return sendResendMail({
    to: payload.to,
    subject,
    html,
    templateName: "missing_document",
  });
}

/**
 * Flow #5: Branded Auth Email OTP Verification
 * Trigger: Seller signup email verification, customer email verification, or password reset
 */
export async function sendOtpEmail(payload: SendOtpPayload) {
  const code = payload.code;
  const purpose = payload.purpose || "account verification";
  const subject = `Your Cikka Verification Code: ${code}`;
  const html = buildOtpEmailHtml(code, purpose);

  return sendResendMail({
    to: payload.to,
    subject,
    html,
    templateName: "otp_verification",
  });
}

/**
 * Flow #6: Team member invitation
 * Trigger: Seller invites team member with role
 */
export async function sendTeamInviteEmail(payload: SendTeamInvitePayload) {
  const loginUrl = payload.loginUrl || `${DEFAULT_PORTAL_URL}/login`;
  const subject = `You've been invited to join ${payload.businessName} on Cikka`;
  const html = buildTeamInviteHtml(payload.inviteeName, payload.businessName, payload.role, payload.otpCode, loginUrl);

  return sendResendMail({
    to: payload.to,
    subject,
    html,
    templateName: "team_invite",
  });
}

/**
 * Return sample preview HTML for all templates to support Admin Dashboard preview
 */
export function getTemplatePreview(templateKey: string): { subject: string; html: string } {
  switch (templateKey) {
    case "waitlist_review":
      return {
        subject: "We've received your seller application",
        html: buildWaitlistReviewHtml("Vintvate Fashion"),
      };

    case "seller_welcome":
      return {
        subject: "Welcome to Cikka, Vintvate — you're officially live",
        html: buildSellerWelcomeHtml("Vintvate"),
      };

    case "seller_rejection":
      return {
        subject: "Action Required: Update your Cikka seller verification details",
        html: buildSellerRejectionHtml(
          "Vintvate Fashion",
          "Certificate of Incorporation scan was illegible.",
          `${DEFAULT_PORTAL_URL}/onboarding`
        ),
      };

    case "missing_document":
      return {
        subject: "Action Required: Document Issue (GST Certificate)",
        html: buildMissingDocumentHtml(
          "Vintvate Fashion",
          "GST Certificate",
          "Document copy was blurred. Please provide an original clear PDF scan.",
          `${DEFAULT_PORTAL_URL}/onboarding`
        ),
      };

    case "otp_verification":
      return {
        subject: "Your Cikka Verification Code: 451836",
        html: buildOtpEmailHtml("451836", "account verification"),
      };

    case "team_invite":
      return {
        subject: "You've been invited to join Vintvate on Cikka",
        html: buildTeamInviteHtml(
          "Alex Rivera",
          "Vintvate",
          "Executive",
          "381920",
          `${DEFAULT_PORTAL_URL}/login`
        ),
      };

    default:
      return {
        subject: "Cikka Notification",
        html: renderCikkaMailLayout({
          subject: "Cikka Notification",
          badge: { text: "NOTIFICATION", type: "purple" },
          headline: "Cikka Platform Update",
          bodyHtml: "<p>Sample Cikka notification email content.</p>",
        }),
      };
  }
}
