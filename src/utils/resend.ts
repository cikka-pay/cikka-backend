import dotenv from "dotenv";
dotenv.config();

export interface SendEmailPayload {
  to: string;
  sellerName?: string;
}

const RESEND_API_KEY = process.env.RESEND_API_KEY || "";
const FROM_EMAIL = process.env.RESEND_FROM_EMAIL || "onboarding@resend.dev";

/**
 * Core function to send emails via Resend REST API (https://api.resend.com/emails)
 */
async function sendResendMail(options: {
  to: string;
  subject: string;
  html: string;
}): Promise<{ success: boolean; id?: string; error?: string }> {
  try {
    const apiKey = process.env.RESEND_API_KEY || RESEND_API_KEY;
    const fromEmail = process.env.RESEND_FROM_EMAIL || FROM_EMAIL || "onboarding@resend.dev";

    if (!apiKey || apiKey === "re_123456789" || apiKey.trim() === "") {
      console.log(`[Resend Mock Mode] Email would be sent to: ${options.to}`);
      console.log(`[Resend Mock Mode] Subject: ${options.subject}`);
      return { success: true, id: `mock_${Date.now()}` };
    }

    const ownerEmail = process.env.RESEND_TEST_RECIPIENT || "vedantvyas79@gmail.com";
    let targetTo = options.to;

    // Resend test domain (onboarding@resend.dev) restricts delivery to the account owner email.
    if (fromEmail.includes("resend.dev") && targetTo.toLowerCase() !== ownerEmail.toLowerCase()) {
      console.log(`[Resend Test Mode] Redirecting recipient ${targetTo} -> ${ownerEmail} (Resend test domain requirement)`);
      targetTo = ownerEmail;
    }

    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: `Cikka Team <${fromEmail}>`,
        to: [targetTo],
        subject: options.subject,
        html: options.html,
      }),
    });

    const data = (await response.json()) as any;

    if (!response.ok) {
      console.error("[Resend API Error]", data);
      return { success: false, error: data.message || "Failed to send email via Resend" };
    }

    console.log(`[Resend API Success] Email sent to ${targetTo} (requested: ${options.to}), ID: ${data.id}`);
    return { success: true, id: data.id };
  } catch (error: any) {
    console.error("[Resend Exception]", error);
    return { success: false, error: error?.message || "Internal email transport error" };
  }
}

/**
 * Flow #1: Email sent when seller completes onboarding form / waitlist signup
 * Trigger: Seller clicks "Save & Continue to Review ->" on Onboarding page
 */
export async function sendSellerWaitlistEmail(payload: SendEmailPayload) {
  const sellerName = payload.sellerName?.trim() || "Partner";
  const subject = "We've received your seller application";

  const html = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; background-color: #f9f9fb; color: #1e1e24; margin: 0; padding: 40px 20px; }
    .container { max-width: 580px; margin: 0 auto; background: #ffffff; border-radius: 16px; border: 1px solid #eaeaef; padding: 36px; box-shadow: 0 4px 20px rgba(0,0,0,0.03); }
    .tag { font-size: 11px; font-weight: 700; letter-spacing: 1px; color: #7c3aed; text-transform: uppercase; margin-bottom: 24px; }
    .title { font-size: 15px; font-weight: 700; color: #09090b; margin-bottom: 20px; border-bottom: 1px solid #f0f0f5; padding-bottom: 14px; }
    p { font-size: 14px; line-height: 1.6; color: #3f3f46; margin: 16px 0; }
    .highlight { font-weight: 600; color: #18181b; }
    .footer { margin-top: 32px; padding-top: 20px; border-top: 1px solid #f0f0f5; font-size: 14px; color: #18181b; font-weight: 600; }
    .brand { color: #7c3aed; font-weight: 700; }
  </style>
</head>
<body>
  <div class="container">
    <div class="tag">SELLER &bull; APPLICATION UNDER REVIEW</div>
    <div class="title">Subject: We've received your seller application</div>
    <p>Hi <span class="highlight">${sellerName}</span>,</p>
    <p>Got it &mdash; your seller application and documents have landed with our onboarding team.</p>
    <p>We typically review and verify everything within 3-4 business hours. If we need any clarification or an additional document, we'll email you directly, so keep an eye on your inbox (and spam folder, just in case).</p>
    <p>No action needed from you right now. We'll follow up the moment there's a decision.</p>
    <div class="footer">
      Cheers,<br>
      <span class="brand">Team Cikka</span>
    </div>
  </div>
</body>
</html>
  `.trim();

  return sendResendMail({
    to: payload.to,
    subject,
    html,
  });
}


/**
 * Flow #2: Email sent when Admin approves seller in Admin Seller Dashboard
 * Trigger: Admin clicks "Approve & Verify Seller" green button
 */
export async function sendSellerWelcomeEmail(payload: SendEmailPayload) {
  const sellerName = payload.sellerName?.trim() || "Partner";
  const subject = `Welcome to Cikka, ${sellerName} — you're officially live`;

  const html = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; background-color: #f9f9fb; color: #1e1e24; margin: 0; padding: 40px 20px; }
    .container { max-width: 580px; margin: 0 auto; background: #ffffff; border-radius: 16px; border: 1px solid #eaeaef; padding: 36px; box-shadow: 0 4px 20px rgba(0,0,0,0.03); }
    .tag { font-size: 11px; font-weight: 700; letter-spacing: 1px; color: #7c3aed; text-transform: uppercase; margin-bottom: 24px; }
    .title { font-size: 15px; font-weight: 700; color: #09090b; margin-bottom: 20px; border-bottom: 1px solid #f0f0f5; padding-bottom: 14px; }
    p { font-size: 14px; line-height: 1.6; color: #3f3f46; margin: 16px 0; }
    ol { font-size: 14px; line-height: 1.8; color: #3f3f46; padding-left: 20px; margin: 16px 0; }
    li { margin-bottom: 8px; }
    .highlight { font-weight: 600; color: #18181b; }
    .footer { margin-top: 32px; padding-top: 20px; border-top: 1px solid #f0f0f5; font-size: 14px; color: #18181b; font-weight: 600; }
    .brand { color: #7c3aed; font-weight: 700; }
    a { color: #7c3aed; text-decoration: none; }
  </style>
</head>
<body>
  <div class="container">
    <div class="tag">SELLER &bull; WELCOME</div>
    <div class="title">Subject: Welcome to Cikka, ${sellerName} — you're officially live</div>
    <p>Hi <span class="highlight">${sellerName}</span>,</p>
    <p>Your <strong>Cikka</strong> seller account is live. Welcome — glad to have you on board.</p>
    <p>Here's what we'd suggest doing first:</p>
    <ol>
      <li>Log in to your seller dashboard and complete your store profile.</li>
      <li>Upload your first catalog or sync it from your existing store.</li>
      <li>Set your payout and settlement details.</li>
    </ol>
    <p>We've attached your Welcome Kit with everything about how selling on Cikka works — settlements, CI Points redemption, and how buyers discover your brand through Cikka Mall.</p>
    <p>If you get stuck anywhere, our team is one email away at <a href="mailto:support@cikka.club">support@cikka.club</a>.</p>
    <p>Excited to have you with us,</p>
    <div class="footer">
      Cheers,<br>
      <span class="brand">Team Cikka</span>
    </div>
  </div>
</body>
</html>
  `.trim();

  return sendResendMail({
    to: payload.to,
    subject,
    html,
  });
}

export interface SendRejectionEmailPayload {
  to: string;
  sellerName?: string;
  reason?: string;
  uploadLink?: string;
}

/**
 * Flow #3: Email sent when seller verification fails or rejection button is clicked by admin
 * Trigger: Admin clicks "Reject Application" button in Admin Verification Dashboard
 */
export async function sendSellerRejectionEmail(payload: SendRejectionEmailPayload) {
  const sellerName = payload.sellerName?.trim() || "Partner";
  const reason = payload.reason?.trim() || "Document verification requirements hit a small snag";
  const uploadLink = payload.uploadLink || "http://localhost:5173/onboarding";
  const subject = "One thing standing between you and a live Cikka store";

  const html = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; background-color: #f9f9fb; color: #1e1e24; margin: 0; padding: 40px 20px; }
    .container { max-width: 580px; margin: 0 auto; background: #ffffff; border-radius: 16px; border: 1px solid #eaeaef; padding: 36px; box-shadow: 0 4px 20px rgba(0,0,0,0.03); }
    .tag { font-size: 11px; font-weight: 700; letter-spacing: 1px; color: #dc2626; text-transform: uppercase; margin-bottom: 24px; }
    .title { font-size: 15px; font-weight: 700; color: #09090b; margin-bottom: 20px; border-bottom: 1px solid #f0f0f5; padding-bottom: 14px; }
    p { font-size: 14px; line-height: 1.6; color: #3f3f46; margin: 16px 0; }
    .highlight { font-weight: 600; color: #18181b; }
    .link { color: #7c3aed; font-weight: 600; text-decoration: underline; }
    .footer { margin-top: 32px; padding-top: 20px; border-top: 1px solid #f0f0f5; font-size: 14px; color: #18181b; font-weight: 600; }
    .brand { color: #7c3aed; font-weight: 700; }
  </style>
</head>
<body>
  <div class="container">
    <div class="tag">SELLER &bull; ACTION REQUIRED (VERIFICATION FAILED / DOCUMENTS)</div>
    <div class="title">Subject: One thing standing between you and a live Cikka store</div>
    <p>Hi <span class="highlight">${sellerName}</span>,</p>
    <p>We went through your seller verification and hit a small snag: <span class="highlight">${reason}</span>.</p>
    <p>Could you upload the corrected document here: <a href="${uploadLink}" class="link">${uploadLink}</a>? Once it's in, we'll pick your review back up &mdash; usually within a day of receiving it.</p>
    <p>If something about this isn't clear, just reply to this email or write to <a href="mailto:support@cikka.club" class="link">support@cikka.club</a> and we'll sort it out together.</p>
    <div class="footer">
      Cheers,<br>
      <span class="brand">Team Cikka</span>
    </div>
  </div>
</body>
</html>
  `.trim();

  return sendResendMail({
    to: payload.to,
    subject,
    html,
  });
}

