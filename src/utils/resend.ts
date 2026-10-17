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

/**
 * Flow #1: Email sent when seller completes onboarding form / waitlist signup
 * Trigger: Seller completes Step 6 on Onboarding page
 */
export async function sendSellerWaitlistEmail(payload: SendEmailPayload) {
  const sellerName = payload.sellerName?.trim() || "Partner";
  const subject = "We've received your seller application";

  const html = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${subject}</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; background-color: #f8fafc; color: #0f172a; margin: 0; padding: 40px 16px; }
    .container { max-width: 580px; margin: 0 auto; background: #ffffff; border-radius: 16px; border: 1px solid #e2e8f0; padding: 36px 32px; box-shadow: 0 4px 20px rgba(0,0,0,0.04); }
    .badge { display: inline-block; font-size: 11px; font-weight: 700; letter-spacing: 1px; color: #7c3aed; background: #f5f3ff; border: 1px solid #ddd6fe; border-radius: 999px; padding: 4px 12px; text-transform: uppercase; margin-bottom: 20px; }
    .title { font-size: 20px; font-weight: 700; color: #0f172a; margin-bottom: 20px; border-bottom: 1px solid #f1f5f9; padding-bottom: 16px; }
    p { font-size: 14px; line-height: 1.6; color: #334155; margin: 16px 0; }
    .highlight { font-weight: 600; color: #0f172a; }
    .card { background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 12px; padding: 16px; margin: 20px 0; }
    .card p { margin: 0; font-size: 13px; color: #6d28d9; font-weight: 600; }
    .footer { margin-top: 32px; padding-top: 20px; border-top: 1px solid #f1f5f9; font-size: 13px; color: #475569; line-height: 1.6; }
    .brand { color: #0f172a; font-weight: 700; font-size: 14px; }
    .support-link { color: #7c3aed; text-decoration: none; font-size: 12px; }
  </style>
</head>
<body>
  <div class="container">
    <div class="badge">SELLER &bull; APPLICATION UNDER REVIEW</div>
    <div class="title">We've received your seller application</div>
    <p>Hi <span class="highlight">${sellerName}</span>,</p>
    <p>Got it &mdash; your seller onboarding application and verification documents have safely landed with our onboarding compliance team.</p>
    
    <div class="card">
      <p>&#9203; Standard Review SLA: 3 to 4 business hours</p>
    </div>

    <p>Our merchant operations team is currently verifying your GSTIN, PAN, and banking credentials. If any document needs clarification, we will notify you directly here in your inbox.</p>
    <p>No further action is required from you right now. You can track your real-time status anytime in the seller portal.</p>
    
    <div class="footer">
      Cheers,<br>
      <span class="brand">Team Cikka</span><br>
      <a href="mailto:support@business.club" class="support-link">support@business.club</a>
    </div>
  </div>
</body>
</html>
  `.trim();

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

  const html = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${subject}</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; background-color: #f8fafc; color: #0f172a; margin: 0; padding: 40px 16px; }
    .container { max-width: 580px; margin: 0 auto; background: #ffffff; border-radius: 16px; border: 1px solid #e2e8f0; padding: 36px 32px; box-shadow: 0 4px 20px rgba(0,0,0,0.04); }
    .badge { display: inline-block; font-size: 11px; font-weight: 700; letter-spacing: 1px; color: #059669; background: #ecfdf5; border: 1px solid #a7f3d0; border-radius: 999px; padding: 4px 12px; text-transform: uppercase; margin-bottom: 20px; }
    .title { font-size: 20px; font-weight: 700; color: #0f172a; margin-bottom: 20px; border-bottom: 1px solid #f1f5f9; padding-bottom: 16px; }
    p { font-size: 14px; line-height: 1.6; color: #334155; margin: 16px 0; }
    ol { font-size: 14px; line-height: 1.8; color: #334155; padding-left: 20px; margin: 16px 0; }
    li { margin-bottom: 8px; }
    .highlight { font-weight: 600; color: #0f172a; }
    .btn { display: inline-block; background: #7c3aed; color: #ffffff !important; font-weight: 700; font-size: 14px; text-decoration: none; padding: 12px 24px; border-radius: 10px; margin: 16px 0; }
    .footer { margin-top: 32px; padding-top: 20px; border-top: 1px solid #f1f5f9; font-size: 13px; color: #475569; line-height: 1.6; }
    .brand { color: #0f172a; font-weight: 700; font-size: 14px; }
    .support-link { color: #7c3aed; text-decoration: none; font-size: 12px; }
  </style>
</head>
<body>
  <div class="container">
    <div class="badge">SELLER &bull; ACCOUNT ACTIVATED &bull; LIVE</div>
    <div class="title">Welcome to Cikka, ${sellerName} — you're officially live</div>
    <p>Hi <span class="highlight">${sellerName}</span>,</p>
    <p>Congratulations! Your <strong>Cikka</strong> merchant store is fully verified and officially live.</p>
    
    <p>Here is what we recommend doing next:</p>
    <ol>
      <li><strong>Add Your Products:</strong> Create your product catalog or sync your existing inventory.</li>
      <li><strong>Confirm Logistics:</strong> Review pickup address &amp; courier SLAs for automatic label generation.</li>
      <li><strong>Track Orders &amp; Settlements:</strong> Monitor live orders and automatic bank settlements.</li>
    </ol>

    <div style="text-align: center; margin: 24px 0;">
      <a href="http://localhost:5173/dashboard" class="btn">Launch Seller Dashboard &rarr;</a>
    </div>

    <p>If you get stuck anywhere, our team is one email away at <a href="mailto:support@business.club" style="color: #7c3aed; text-decoration: none;">support@business.club</a>.</p>
    <p>Excited to have you with us,</p>

    <div class="footer">
      Cheers,<br>
      <span class="brand">Team Cikka</span><br>
      <a href="mailto:support@cikka.club" class="support-link">support@business.club</a>
    </div>
  </div>
</body>
</html>
  `.trim();

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
  const uploadLink = payload.uploadLink || "http://localhost:5173/onboarding";
  const subject = "Action Required: Update your Cikka seller verification details";

  const html = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${subject}</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; background-color: #f8fafc; color: #0f172a; margin: 0; padding: 40px 16px; }
    .container { max-width: 580px; margin: 0 auto; background: #ffffff; border-radius: 16px; border: 1px solid #e2e8f0; padding: 36px 32px; box-shadow: 0 4px 20px rgba(0,0,0,0.04); }
    .badge { display: inline-block; font-size: 11px; font-weight: 700; letter-spacing: 1px; color: #dc2626; background: #fef2f2; border: 1px solid #fecaca; border-radius: 999px; padding: 4px 12px; text-transform: uppercase; margin-bottom: 20px; }
    .title { font-size: 20px; font-weight: 700; color: #0f172a; margin-bottom: 20px; border-bottom: 1px solid #f1f5f9; padding-bottom: 16px; }
    p { font-size: 14px; line-height: 1.6; color: #334155; margin: 16px 0; }
    .alert-box { background: #fef2f2; border: 1px solid #fecaca; border-radius: 12px; padding: 16px; margin: 20px 0; }
    .alert-box p { margin: 0; color: #991b1b; font-size: 13px; line-height: 1.5; }
    .btn { display: inline-block; background: #7c3aed; color: #ffffff !important; font-weight: 700; font-size: 14px; text-decoration: none; padding: 12px 24px; border-radius: 10px; margin: 16px 0; }
    .footer { margin-top: 32px; padding-top: 20px; border-top: 1px solid #f1f5f9; font-size: 13px; color: #475569; line-height: 1.6; }
    .brand { color: #0f172a; font-weight: 700; font-size: 14px; }
    .support-link { color: #7c3aed; text-decoration: none; font-size: 12px; }
  </style>
</head>
<body>
  <div class="container">
    <div class="badge">SELLER &bull; ACTION REQUIRED</div>
    <div class="title">Verification Update Needed</div>
    <p>Hi <span style="font-weight: 600; color: #0f172a;">${sellerName}</span>,</p>
    <p>During our review of your seller application, our verification team noticed an item that needs your attention:</p>
    
    <div class="alert-box">
      <p><strong>Reason:</strong> ${reason}</p>
    </div>

    <p>Please update or re-upload the requested information to resume verification:</p>
    <div style="text-align: center; margin: 24px 0;">
      <a href="${uploadLink}" class="btn">Update Documents &rarr;</a>
    </div>

    <p>Once updated, our team will immediately pick your application back up. If something isn't clear, simply reply to this email or contact us at <a href="mailto:support@business.club" style="color: #7c3aed; text-decoration: none;">support@business.club</a>.</p>

    <div class="footer">
      Cheers,<br>
      <span class="brand">Team Cikka</span><br>
      <a href="mailto:support@business.club" class="support-link">support@business.club</a>
    </div>
  </div>
</body>
</html>
  `.trim();

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
  const uploadLink = payload.uploadLink || "http://localhost:5173/onboarding";
  const subject = `Action Required: Document Issue (${payload.documentTitle})`;

  const html = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${subject}</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; background-color: #f8fafc; color: #0f172a; margin: 0; padding: 40px 16px; }
    .container { max-width: 580px; margin: 0 auto; background: #ffffff; border-radius: 16px; border: 1px solid #e2e8f0; padding: 36px 32px; box-shadow: 0 4px 20px rgba(0,0,0,0.04); }
    .badge { display: inline-block; font-size: 11px; font-weight: 700; letter-spacing: 1px; color: #d97706; background: #fffbeb; border: 1px solid #fde68a; border-radius: 999px; padding: 4px 12px; text-transform: uppercase; margin-bottom: 20px; }
    .title { font-size: 20px; font-weight: 700; color: #0f172a; margin-bottom: 20px; border-bottom: 1px solid #f1f5f9; padding-bottom: 16px; }
    p { font-size: 14px; line-height: 1.6; color: #334155; margin: 16px 0; }
    .doc-box { background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 12px; padding: 16px; margin: 20px 0; }
    .doc-box p { margin: 6px 0; font-size: 13px; color: #334155; }
    .btn { display: inline-block; background: #7c3aed; color: #ffffff !important; font-weight: 700; font-size: 14px; text-decoration: none; padding: 12px 24px; border-radius: 10px; margin: 16px 0; }
    .footer { margin-top: 32px; padding-top: 20px; border-top: 1px solid #f1f5f9; font-size: 13px; color: #475569; line-height: 1.6; }
    .brand { color: #0f172a; font-weight: 700; font-size: 14px; }
    .support-link { color: #7c3aed; text-decoration: none; font-size: 12px; }
  </style>
</head>
<body>
  <div class="container">
    <div class="badge">DOCUMENT RE-SUBMISSION &bull; ${payload.documentTitle.toUpperCase()}</div>
    <div class="title">Document Update Needed: ${payload.documentTitle}</div>
    <p>Hi <span style="font-weight: 600; color: #0f172a;">${sellerName}</span>,</p>
    <p>Our verification team reviewed your submitted documents and noticed an issue with your <strong>${payload.documentTitle}</strong>:</p>
    
    <div class="doc-box">
      <p><strong style="color: #7c3aed;">Document:</strong> ${payload.documentTitle}</p>
      <p><strong style="color: #dc2626;">Reason:</strong> ${payload.reason}</p>
    </div>

    <p>Please re-upload a clear and valid copy of your ${payload.documentTitle} so we can complete your verification without delay:</p>
    <div style="text-align: center; margin: 24px 0;">
      <a href="${uploadLink}" class="btn">Re-upload ${payload.documentTitle} &rarr;</a>
    </div>

    <div class="footer">
      Cheers,<br>
      <span class="brand">Team Cikka</span><br>
      <a href="mailto:support@business.club" class="support-link">support@business.club</a>
    </div>
  </div>
</body>
</html>
  `.trim();

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
 * Crisp White & Purple clean aesthetic
 */
export async function sendOtpEmail(payload: SendOtpPayload) {
  const code = payload.code;
  const purpose = payload.purpose || "account verification";
  const subject = `Your Cikka Verification Code: ${code}`;

  const html = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${subject}</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; background-color: #f8fafc; color: #0f172a; margin: 0; padding: 40px 16px; }
    .container { max-width: 480px; margin: 0 auto; background: #ffffff; border-radius: 16px; border: 1px solid #e2e8f0; padding: 36px 32px; box-shadow: 0 4px 20px rgba(0,0,0,0.04); text-align: center; }
    .badge { display: inline-block; font-size: 11px; font-weight: 700; letter-spacing: 1.5px; color: #7c3aed; background: #f5f3ff; border: 1px solid #ddd6fe; border-radius: 999px; padding: 4px 14px; text-transform: uppercase; margin-bottom: 20px; }
    .title { font-size: 22px; font-weight: 800; color: #0f172a; margin-bottom: 10px; letter-spacing: -0.5px; }
    p { font-size: 14px; line-height: 1.5; color: #475569; margin: 8px 0; }
    .otp-box { background: #f5f3ff; border: 2px solid #7c3aed; border-radius: 14px; padding: 18px 24px; margin: 24px 0; letter-spacing: 8px; font-size: 32px; font-weight: 800; color: #6d28d9; text-align: center; font-family: ui-monospace, Menlo, Monaco, 'Courier New', monospace; }
    .expiry { font-size: 12px; color: #64748b; margin-top: 16px; }
    .footer { margin-top: 32px; padding-top: 20px; border-top: 1px solid #f1f5f9; font-size: 13px; color: #475569; line-height: 1.6; text-align: center; }
    .brand { color: #0f172a; font-weight: 700; font-size: 14px; }
    .support-link { color: #7c3aed; text-decoration: none; font-size: 12px; }
  </style>
</head>
<body>
  <div class="container">
    <div class="badge">CIKKA SECURITY</div>
    <div class="title">Verify Your Email Address</div>
    <p>Enter the 6-digit verification code below to complete your ${purpose}:</p>
    
    <div class="otp-box">${code}</div>

    <p class="expiry">This verification code expires in <strong>10 minutes</strong>.<br>If you did not request this code, you can safely ignore this email.</p>

    <div class="footer">
      Cheers,<br>
      <span class="brand">Team Cikka</span><br>
      <a href="mailto:support@business.club" class="support-link">support@business.club</a>
    </div>
  </div>
</body>
</html>
  `.trim();

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
  const loginUrl = payload.loginUrl || "http://localhost:5173/login";
  const subject = `You've been invited to join ${payload.businessName} on Cikka`;

  const html = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${subject}</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; background-color: #f8fafc; color: #0f172a; margin: 0; padding: 40px 16px; }
    .container { max-width: 580px; margin: 0 auto; background: #ffffff; border-radius: 16px; border: 1px solid #e2e8f0; padding: 36px 32px; box-shadow: 0 4px 20px rgba(0,0,0,0.04); }
    .badge { display: inline-block; font-size: 11px; font-weight: 700; letter-spacing: 1px; color: #0284c7; background: #f0f9ff; border: 1px solid #bae6fd; border-radius: 999px; padding: 4px 12px; text-transform: uppercase; margin-bottom: 20px; }
    .title { font-size: 20px; font-weight: 700; color: #0f172a; margin-bottom: 20px; border-bottom: 1px solid #f1f5f9; padding-bottom: 16px; }
    p { font-size: 14px; line-height: 1.6; color: #334155; margin: 16px 0; }
    .invite-box { background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 12px; padding: 16px; margin: 20px 0; }
    .invite-box p { margin: 6px 0; font-size: 13px; color: #334155; }
    .btn { display: inline-block; background: #7c3aed; color: #ffffff !important; font-weight: 700; font-size: 14px; text-decoration: none; padding: 12px 24px; border-radius: 10px; margin: 16px 0; }
    .footer { margin-top: 32px; padding-top: 20px; border-top: 1px solid #f1f5f9; font-size: 13px; color: #475569; line-height: 1.6; }
    .brand { color: #0f172a; font-weight: 700; font-size: 14px; }
    .support-link { color: #7c3aed; text-decoration: none; font-size: 12px; }
  </style>
</head>
<body>
  <div class="container">
    <div class="badge">TEAM INVITATION &bull; ${payload.role}</div>
    <div class="title">Join ${payload.businessName} on Cikka</div>
    <p>Hi <span style="font-weight: 600; color: #0f172a;">${payload.inviteeName}</span>,</p>
    <p>You have been invited to join the seller team at <strong>${payload.businessName}</strong> on Cikka.</p>
    
    <div class="invite-box">
      <p><strong>Store:</strong> ${payload.businessName}</p>
      <p><strong>Assigned Role:</strong> <span style="color: #0284c7; font-weight: 700;">${payload.role}</span></p>
      <p><strong>Verification Code:</strong> <span style="color: #7c3aed; font-weight: 800; font-family: monospace; font-size: 16px;">${payload.otpCode}</span></p>
    </div>

    <p>Sign in using your mobile number and the verification code above to access your team dashboard:</p>
    <div style="text-align: center; margin: 24px 0;">
      <a href="${loginUrl}" class="btn">Sign In to Dashboard &rarr;</a>
    </div>

    <div class="footer">
      Cheers,<br>
      <span class="brand">Team Cikka</span><br>
      <a href="mailto:support@business.club" class="support-link">support@business.club</a>
    </div>
  </div>
</body>
</html>
  `.trim();

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
        html: `
<div style="font-family: -apple-system, sans-serif; background: #ffffff; color: #0f172a; padding: 28px 24px; border-radius: 16px; border: 1px solid #e2e8f0; max-width: 520px; margin: 0 auto;">
  <span style="font-size: 11px; font-weight: 700; color: #7c3aed; background: #f5f3ff; border: 1px solid #ddd6fe; border-radius: 999px; padding: 3px 10px; text-transform: uppercase;">SELLER &bull; APPLICATION UNDER REVIEW</span>
  <h2 style="color: #0f172a; margin: 16px 0 8px 0; font-size: 18px; font-weight: 700;">We've received your seller application</h2>
  <p style="color: #334155; font-size: 13px; line-height: 1.5;">Hi <strong>Vintvate Fashion</strong>, your documents have safely landed with our team.</p>
  <div style="background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 10px; padding: 12px; margin: 16px 0; color: #6d28d9; font-size: 12px; font-weight: 600;">
    &#9203; Standard Review SLA: 3 to 4 business hours
  </div>
  <p style="color: #64748b; font-size: 12px;">No further action needed right now. We will follow up the moment there's a decision.</p>
  <div style="margin-top: 24px; padding-top: 16px; border-top: 1px solid #f1f5f9; font-size: 12px; color: #475569; line-height: 1.6;">
    Cheers,<br>
    <strong style="color: #0f172a;">Team Cikka</strong><br>
    <span style="color: #7c3aed;">support@business.club</span>
  </div>
</div>
        `.trim(),
      };

    case "seller_welcome":
      return {
        subject: "Welcome to Cikka, Vintvate — you're officially live",
        html: `
<div style="font-family: -apple-system, sans-serif; background: #ffffff; color: #0f172a; padding: 28px 24px; border-radius: 16px; border: 1px solid #e2e8f0; max-width: 520px; margin: 0 auto;">
  <span style="font-size: 11px; font-weight: 700; color: #059669; background: #ecfdf5; border: 1px solid #a7f3d0; border-radius: 999px; padding: 3px 10px; text-transform: uppercase;">SELLER &bull; WELCOME &bull; LIVE</span>
  <h2 style="color: #0f172a; margin: 16px 0 8px 0; font-size: 18px; font-weight: 700;">Welcome to Cikka, Vintvate — you're officially live</h2>
  <p style="color: #334155; font-size: 13px; line-height: 1.5;">Your merchant store is approved and ready for business.</p>
  <div style="text-align: center; margin: 20px 0;">
    <span style="background: #7c3aed; color: #fff; padding: 10px 20px; border-radius: 8px; font-size: 13px; font-weight: 700;">Launch Seller Dashboard &rarr;</span>
  </div>
  <div style="margin-top: 24px; padding-top: 16px; border-top: 1px solid #f1f5f9; font-size: 12px; color: #475569; line-height: 1.6;">
    Cheers,<br>
    <strong style="color: #0f172a;">Team Cikka</strong><br>
    <span style="color: #7c3aed;">support@business.club</span>
  </div>
</div>
        `.trim(),
      };

    case "seller_rejection":
      return {
        subject: "Action Required: Update your Cikka seller verification details",
        html: `
<div style="font-family: -apple-system, sans-serif; background: #ffffff; color: #0f172a; padding: 28px 24px; border-radius: 16px; border: 1px solid #e2e8f0; max-width: 520px; margin: 0 auto;">
  <span style="font-size: 11px; font-weight: 700; color: #dc2626; background: #fef2f2; border: 1px solid #fecaca; border-radius: 999px; padding: 3px 10px; text-transform: uppercase;">SELLER &bull; ACTION REQUIRED</span>
  <h2 style="color: #0f172a; margin: 16px 0 8px 0; font-size: 18px; font-weight: 700;">Verification Update Needed</h2>
  <p style="color: #334155; font-size: 13px; line-height: 1.5;">Reason: Certificate of Incorporation scan was illegible.</p>
  <div style="text-align: center; margin: 20px 0;">
    <span style="background: #7c3aed; color: #fff; padding: 10px 20px; border-radius: 8px; font-size: 13px; font-weight: 700;">Update Documents &rarr;</span>
  </div>
  <div style="margin-top: 24px; padding-top: 16px; border-top: 1px solid #f1f5f9; font-size: 12px; color: #475569; line-height: 1.6;">
    Cheers,<br>
    <strong style="color: #0f172a;">Team Cikka</strong><br>
    <span style="color: #7c3aed;">support@business.club</span>
  </div>
</div>
        `.trim(),
      };

    case "otp_verification":
      return {
        subject: "Your Cikka Verification Code: 451836",
        html: `
<div style="font-family: -apple-system, sans-serif; background: #ffffff; color: #0f172a; padding: 28px 24px; border-radius: 16px; border: 1px solid #e2e8f0; text-align: center; max-width: 440px; margin: 0 auto;">
  <span style="font-size: 11px; font-weight: 700; color: #7c3aed; background: #f5f3ff; border: 1px solid #ddd6fe; border-radius: 999px; padding: 3px 12px; text-transform: uppercase;">CIKKA SECURITY</span>
  <h2 style="color: #0f172a; margin: 12px 0 6px 0; font-size: 20px; font-weight: 800;">Verify Your Email Address</h2>
  <p style="color: #475569; font-size: 13px; margin: 0 0 16px 0;">Enter the 6-digit verification code below to complete your verification:</p>
  <div style="background: #f5f3ff; border: 2px solid #7c3aed; border-radius: 12px; padding: 16px 20px; margin: 16px 0; letter-spacing: 8px; font-size: 28px; font-weight: 800; color: #6d28d9; font-family: monospace;">
    451836
  </div>
  <p style="color: #64748b; font-size: 11px; margin-top: 12px;">This code expires in 10 minutes.</p>
  <div style="margin-top: 24px; padding-top: 16px; border-top: 1px solid #f1f5f9; font-size: 12px; color: #475569; line-height: 1.6;">
    Cheers,<br>
    <strong style="color: #0f172a;">Team Cikka</strong><br>
    <span style="color: #7c3aed;">support@business.club</span>
  </div>
</div>
        `.trim(),
      };

    case "team_invite":
      return {
        subject: "You've been invited to join Vintvate on Cikka",
        html: `
<div style="font-family: -apple-system, sans-serif; background: #ffffff; color: #0f172a; padding: 28px 24px; border-radius: 16px; border: 1px solid #e2e8f0; max-width: 520px; margin: 0 auto;">
  <span style="font-size: 11px; font-weight: 700; color: #0284c7; background: #f0f9ff; border: 1px solid #bae6fd; border-radius: 999px; padding: 3px 10px; text-transform: uppercase;">TEAM INVITATION &bull; EXECUTIVE</span>
  <h2 style="color: #0f172a; margin: 16px 0 8px 0; font-size: 18px; font-weight: 700;">Join Vintvate on Cikka</h2>
  <p style="color: #334155; font-size: 13px; line-height: 1.5;">Role: <strong>Executive</strong> &bull; Code: <span style="color: #7c3aed; font-weight: 800; font-family: monospace;">381920</span></p>
  <div style="margin-top: 24px; padding-top: 16px; border-top: 1px solid #f1f5f9; font-size: 12px; color: #475569; line-height: 1.6;">
    Cheers,<br>
    <strong style="color: #0f172a;">Team Cikka</strong><br>
    <span style="color: #7c3aed;">support@business.club</span>
  </div>
</div>
        `.trim(),
      };

    default:
      return {
        subject: "Cikka Notification",
        html: `<p>Sample Cikka notification email content.</p>`,
      };
  }
}
