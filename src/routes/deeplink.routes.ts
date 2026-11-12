import { Router, Request, Response } from "express";
import { prisma } from "../config/prisma";

const router = Router();

const PLAY_STORE_URL = "https://play.google.com/store/apps/details?id=com.cikka.app";

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function renderDeepLinkLandingHtml(opts: {
  title: string;
  subtitle: string;
  appUrl: string;
  imageUrl?: string | null;
  badge?: string;
}): string {
  const safeTitle = escapeHtml(opts.title);
  const safeSubtitle = escapeHtml(opts.subtitle);
  const safeAppUrl = escapeHtml(opts.appUrl);
  const safeBadge = escapeHtml(opts.badge || "CIKKACLUB");
  const ogImageTag = opts.imageUrl
    ? `<meta property="og:image" content="${escapeHtml(opts.imageUrl)}" />`
    : "";

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <title>${safeTitle} — Cikka</title>
  <meta property="og:title" content="${safeTitle}" />
  <meta property="og:description" content="${safeSubtitle}" />
  ${ogImageTag}
  <style>
    body { margin: 0; min-height: 100vh; display: flex; align-items: center; justify-content: center; background: #06060A; color: #F8FAFC; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; padding: 24px; }
    .card { width: 100%; max-width: 420px; background: #0D0C14; border: 1px solid rgba(255,255,255,0.1); border-radius: 24px; padding: 28px 24px; text-align: center; box-shadow: 0 24px 64px rgba(0,0,0,0.55); }
    .badge { display: inline-block; font-size: 11px; letter-spacing: 2px; font-weight: 800; color: #C4B5FD; background: rgba(167,139,250,0.14); border: 1px solid rgba(167,139,250,0.28); padding: 6px 12px; border-radius: 999px; margin-bottom: 18px; }
    h1 { margin: 0 0 10px; font-size: 22px; line-height: 1.25; font-weight: 800; }
    p { margin: 0 0 24px; color: #94A3B8; font-size: 14px; line-height: 1.5; }
    .btn { display: block; width: 100%; box-sizing: border-box; text-decoration: none; background: #FFFFFF; color: #06060A; font-weight: 800; font-size: 15px; padding: 14px 18px; border-radius: 14px; margin-bottom: 12px; }
    .btn-secondary { display: block; width: 100%; box-sizing: border-box; text-decoration: none; background: rgba(255,255,255,0.06); color: #E2E8F0; border: 1px solid rgba(255,255,255,0.12); font-weight: 700; font-size: 13px; padding: 12px 18px; border-radius: 14px; }
  </style>
</head>
<body>
  <div class="card">
    <div class="badge">${safeBadge}</div>
    <h1>${safeTitle}</h1>
    <p>${safeSubtitle}</p>
    <a class="btn" href="${safeAppUrl}">Open in Cikka App</a>
    <a class="btn-secondary" href="${PLAY_STORE_URL}">Get Cikka on Google Play</a>
  </div>
  <script>
    setTimeout(function() { window.location.href = ${JSON.stringify(opts.appUrl)}; }, 120);
  </script>
</body>
</html>`;
}

router.get("/.well-known/apple-app-site-association", (_req: Request, res: Response) => {
  const teamId = process.env.APPLE_TEAM_ID || "CIKKATEAM01";
  res.setHeader("Content-Type", "application/json");
  res.json({
    applinks: {
      apps: [],
      details: [
        {
          appID: `${teamId}.com.cikka.app`,
          paths: [
            "/invite/*",
            "/mall/*",
            "/cikkamall/*",
            "/rewards/*",
            "/rewardstore/*",
            "/gift-cards/*",
          ],
        },
      ],
    },
  });
});

router.get("/.well-known/assetlinks.json", (_req: Request, res: Response) => {
  const fingerprintsRaw = process.env.ANDROID_SHA256_CERT_FINGERPRINTS || "";
  const fingerprints = fingerprintsRaw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  res.setHeader("Content-Type", "application/json");
  res.json([
    {
      relation: ["delegate_permission/common.handle_all_urls"],
      target: {
        namespace: "android_app",
        package_name: "com.cikka.app",
        ...(fingerprints.length > 0 ? { sha256_cert_fingerprints: fingerprints } : {}),
      },
    },
  ]);
});

router.get("/invite/:code", (req: Request, res: Response) => {
  const code = String(req.params.code || "").trim();
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.send(
    renderDeepLinkLandingHtml({
      badge: "CIKKA INVITE",
      title: `You're invited with ${code || "Cikka"}`,
      subtitle: "Pay bills via BBPS, shop Cikka Mall, and earn up to 6,000 CI Points.",
      appUrl: `cikkaapp://invite/${encodeURIComponent(code)}`,
    })
  );
});

function getFirstImageUrl(imageUrls: unknown): string | undefined {
  if (Array.isArray(imageUrls) && typeof imageUrls[0] === "string") {
    return imageUrls[0];
  }
  return undefined;
}

async function handleMallLanding(req: Request, res: Response) {
  const id = String(req.params.id || "").trim();
  const product = await prisma.product
    .findUnique({
      where: { id },
      select: { name: true, brandName: true, price: true, imageUrls: true },
    })
    .catch(() => null);

  const title = product?.name || "Cikka Mall Selection";
  const subtitle = product
    ? `${product.brandName ? `${product.brandName} · ` : ""}₹${Number(product.price || 0).toLocaleString("en-IN")} on Cikka Mall`
    : "Explore verified luxury & lifestyle picks inside the Cikka app.";

  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.send(
    renderDeepLinkLandingHtml({
      badge: "CIKKA MALL",
      title,
      subtitle,
      imageUrl: getFirstImageUrl(product?.imageUrls),
      appUrl: `cikkaapp://mall/${encodeURIComponent(id)}`,
    })
  );
}

router.get("/mall/:id", handleMallLanding);
router.get("/cikkamall/:id", handleMallLanding);

async function handleRewardProductLanding(req: Request, res: Response) {
  const id = String(req.params.id || "").trim();
  const product = await prisma.product
    .findUnique({
      where: { id },
      select: { name: true, brandName: true, price: true, loyaltyPoints: true, imageUrls: true },
    })
    .catch(() => null);

  const pts = Number(product?.price || product?.loyaltyPoints || 0);
  const title = product?.name || "Cikka Reward Store Pick";
  const subtitle = product
    ? `${product.brandName ? `${product.brandName} · ` : ""}Redeem for ${Math.round(pts).toLocaleString("en-IN")} CI Points`
    : "Redeem exclusive rewards using CI Points inside Cikka.";

  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.send(
    renderDeepLinkLandingHtml({
      badge: "REWARD STORE",
      title,
      subtitle,
      imageUrl: getFirstImageUrl(product?.imageUrls),
      appUrl: `cikkaapp://rewards/product/${encodeURIComponent(id)}`,
    })
  );
}

router.get("/rewards/product/:id", handleRewardProductLanding);
router.get("/rewardstore/:id", handleRewardProductLanding);

function handleCouponLanding(req: Request, res: Response) {
  const id = String(req.params.id || "").trim();
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.send(
    renderDeepLinkLandingHtml({
      badge: "BRAND COUPON",
      title: "Brand Voucher on Cikka Reward Store",
      subtitle: "Redeem instantly with CI Points. Cikka Reward Store coupons never expire.",
      appUrl: `cikkaapp://rewards/coupon/${encodeURIComponent(id)}`,
    })
  );
}

router.get("/rewards/coupon/:id", handleCouponLanding);
router.get("/gift-cards/:id", handleCouponLanding);

export default router;
