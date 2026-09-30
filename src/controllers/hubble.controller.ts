import { Request, Response } from 'express';
import { HubbleService } from '../services/hubble.service';
import { HubbleRestClient } from '../services/hubble-rest.service';

// In-memory store for user balances and transaction idempotency
const userBalances: Record<string, number> = {
  'cikka_9876543210': 8204.0,
  '9876543210': 8204.0,
  'partner_user_123': 1500.0,
};

const debitTransactions: Record<string, any> = {};
const reverseTransactions: Record<string, any> = {};

export class HubbleController {
  /**
   * Endpoint: POST /api/hubble/sso-token
   * Generates a Hubble RS256 SSO token and embed URL for the mobile app
   */
  static async getSSOToken(req: Request, res: Response): Promise<void> {
    try {
      // Optional portal handshake audit header
      const hubbleSecretHeader = req.headers['x-hubble-secret'];
      if (hubbleSecretHeader && typeof hubbleSecretHeader === 'string') {
        console.log('[HubbleController] Received X-Hubble-Secret header audit signal');
      }


      const { phone, userId, name, email } = req.body || {};

      // User session fallback (can come from req.user if authenticated, or request body)
      const userPhone = phone || (req as any).user?.phone || '9876543210';
      const userIdentifier = userId || (req as any).user?.id || `cikka_${userPhone}`;
      const userName = name || (req as any).user?.name || 'Cikka User';
      const userEmail = email || (req as any).user?.email || 'user@cikka.app';

      const ssoData = HubbleService.generateSSOToken({
        phone: userPhone,
        userId: userIdentifier,
        name: userName,
        email: userEmail,
      });

      res.status(200).json({
        success: true,
        message: 'Hubble SSO token verified successfully',
        userId: userIdentifier,
        phoneNumber: userPhone,
        phone: userPhone,
        name: userName,
        email: userEmail,
        token: req.body?.token || ssoData.token,
        embedUrl: ssoData.embedUrl,
        data: ssoData,
      });
    } catch (error: any) {
      console.error('[HubbleController] Failed to generate SSO token:', error);
      res.status(500).json({
        success: false,
        error: error.message || 'Failed to generate Hubble SSO token',
      });
    }
  }

  /**
   * Endpoint: GET /api/hubble/balance?userId={userId}
   * Hubble calls this to fetch user's CI Points balance
   */
  static async getBalance(req: Request, res: Response): Promise<void> {
    try {
      const userId = (req.query.userId as string) || (req.query.user_id as string) || 'cikka_9876543210';
      
      const balance = userBalances[userId] !== undefined ? userBalances[userId] : 8204.0;
      userBalances[userId] = balance;

      res.status(200).json({
        status: 'SUCCESS',
        userId: userId,
        totalCoins: balance,
        coins: balance,
        balance: balance,
        total_coins: balance,
        consumptionEligibility: {
          allowed: true,
        },
      });
    } catch (error: any) {
      console.error('[HubbleController] Failed to fetch balance:', error);
      res.status(200).json({
        status: 'FAILED',
        failureReason: error.message || 'Internal error fetching coin balance',
      });
    }
  }

  /**
   * Endpoint: POST /api/hubble/debit
   * Hubble calls this to debit CI Points when redeeming a gift card
   */
  static async debitCoins(req: Request, res: Response): Promise<void> {
    try {
      const { userId, coins, referenceId } = req.body || {};

      if (!userId || !referenceId || typeof coins !== 'number') {
        res.status(200).json({
          status: 'FAILED',
          failureReason: 'Missing required parameters: userId, coins, or referenceId',
        });
        return;
      }

      // Idempotency check: duplicate request with same referenceId
      if (debitTransactions[referenceId]) {
        console.log(`[HubbleController] Duplicate debit request for referenceId: ${referenceId}`);
        res.status(200).json(debitTransactions[referenceId]);
        return;
      }

      const currentBalance = userBalances[userId] !== undefined ? userBalances[userId] : 8204.0;

      if (currentBalance < coins) {
        res.status(200).json({
          status: 'FAILED',
          failureReason: 'Insufficient balance',
          balance: currentBalance,
        });
        return;
      }

      const updatedBalance = currentBalance - coins;
      userBalances[userId] = updatedBalance;

      const transactionId = `cikka_txn_${Date.now()}`;
      const responsePayload = {
        status: 'SUCCESS',
        transactionId,
        balance: updatedBalance,
        referenceId,
        coins,
      };

      debitTransactions[referenceId] = responsePayload;
      console.log(`[HubbleController] Successfully debited ${coins} CI Points from ${userId}. Remaining: ${updatedBalance}`);

      res.status(200).json({
        status: 'SUCCESS',
        transactionId,
        balance: updatedBalance,
        totalCoins: updatedBalance,
        coins: updatedBalance,
        total_coins: updatedBalance,
        referenceId,
      });
    } catch (error: any) {
      console.error('[HubbleController] Failed to debit coins:', error);
      res.status(200).json({
        status: 'FAILED',
        failureReason: error.message || 'Internal error processing coin debit',
      });
    }
  }

  /**
   * Endpoint: POST /api/hubble/reverse
   * Hubble calls this to refund CI Points if a gift card transaction fails or is cancelled
   */
  static async reverseDebit(req: Request, res: Response): Promise<void> {
    try {
      const { userId, referenceId } = req.body || {};

      if (!userId || !referenceId) {
        res.status(200).json({
          status: 'FAILED',
          failureReason: 'Missing required parameters: userId or referenceId',
        });
        return;
      }

      // Idempotency check: already reversed
      if (reverseTransactions[referenceId]) {
        console.log(`[HubbleController] Duplicate reverse request for referenceId: ${referenceId}`);
        res.status(200).json({
          status: 'SUCCESS',
          message: 'Already reversed',
          referenceId,
        });
        return;
      }

      const originalDebit = debitTransactions[referenceId];
      const currentBalance = userBalances[userId] !== undefined ? userBalances[userId] : 8204.0;
      
      const coinsToRefund = originalDebit ? (originalDebit.coins || 0) : 0;
      const updatedBalance = currentBalance + coinsToRefund;
      userBalances[userId] = updatedBalance;

      const transactionId = `cikka_txn_rev_${Date.now()}`;
      const responsePayload = {
        status: 'SUCCESS',
        transactionId,
        balance: updatedBalance,
        referenceId,
      };

      reverseTransactions[referenceId] = responsePayload;
      console.log(`[HubbleController] Successfully reversed debit ${referenceId} for ${userId}. New balance: ${updatedBalance}`);

      res.status(200).json(responsePayload);
    } catch (error: any) {
      console.error('[HubbleController] Failed to reverse debit:', error);
      res.status(200).json({
        status: 'FAILED',
        failureReason: error.message || 'Internal error processing coin reversal',
      });
    }
  }

  /**
   * Endpoint: GET /api/hubble/brands
   * Discover available brands, gift cards, and coupons
   */
  static async getBrands(req: Request, res: Response): Promise<void> {
    try {
      const { category, q, pageNo, limit } = req.query;
      const result = await HubbleRestClient.getBrands({
        category: typeof category === 'string' ? category : undefined,
        q: typeof q === 'string' ? q : undefined,
        pageNo: pageNo ? parseInt(String(pageNo), 10) : undefined,
        limit: limit ? parseInt(String(limit), 10) : undefined,
      });

      res.status(200).json({
        success: true,
        data: result.data,
        total: result.total,
        source: result.source,
        isLiveApi: result.isLiveApi,
      });
    } catch (error: any) {
      console.error('[HubbleController] Failed to fetch brands:', error);
      res.status(500).json({
        success: false,
        error: error.message || 'Failed to fetch gift card brands',
      });
    }
  }

  /**
   * Endpoint: GET /api/hubble/brands/:id
   * Get complete details for a specific brand
   */
  static async getBrandById(req: Request, res: Response): Promise<void> {
    try {
      const { id } = req.params;
      const brand = await HubbleRestClient.getBrandById(id);

      if (!brand || !brand.data) {
        res.status(404).json({
          success: false,
          error: 'Brand not found',
        });
        return;
      }

      res.status(200).json({
        success: true,
        data: brand.data,
        source: brand.source,
        isLiveApi: brand.isLiveApi,
      });
    } catch (error: any) {
      console.error('[HubbleController] Failed to fetch brand details:', error);
      res.status(500).json({
        success: false,
        error: error.message || 'Failed to fetch brand details',
      });
    }
  }

  /**
   * Endpoint: POST /api/hubble/orders
   * Place an order to generate gift card vouchers
   */
  static async createOrder(req: Request, res: Response): Promise<void> {
    try {
      const { productId, denomination, quantity = 1, amount, customerDetails } = req.body;

      if (!productId) {
        res.status(400).json({
          success: false,
          error: 'productId is required',
        });
        return;
      }

      const denomNum = Number(denomination || amount);
      const qtyNum = Number(quantity || 1);
      const totalAmount = Number(amount || denomNum * qtyNum);

      if (!denomNum || denomNum <= 0) {
        res.status(400).json({
          success: false,
          error: 'Valid denomination/amount is required',
        });
        return;
      }

      const orderResult = await HubbleRestClient.placeOrder({
        productId,
        amount: totalAmount,
        denominationDetails: [
          {
            denomination: denomNum,
            quantity: qtyNum,
          },
        ],
        customerDetails: customerDetails || {
          name: (req as any).user?.name || 'Cikka Member',
          phoneNumber: (req as any).user?.phone || '9876543210',
          email: (req as any).user?.email || 'member@cikka.app',
        },
      });

      res.status(201).json({
        success: true,
        message: 'Gift card vouchers created successfully',
        data: orderResult,
        source: orderResult.source,
        isLiveApi: orderResult.isLiveApi,
      });
    } catch (error: any) {
      console.error('[HubbleController] Failed to create order:', error);
      res.status(500).json({
        success: false,
        error: error.message || 'Failed to create gift card vouchers',
      });
    }
  }

  /**
   * Endpoint: GET /api/hubble/wallet
   * Get partner wallet balance
   */
  static async getWallet(req: Request, res: Response): Promise<void> {
    try {
      const wallet = await HubbleRestClient.getWallet();
      res.status(200).json({
        success: true,
        data: wallet,
      });
    } catch (error: any) {
      res.status(500).json({
        success: false,
        error: error.message || 'Failed to fetch wallet balance',
      });
    }
  }
  /**
   * Endpoint: GET /api/hubble/status
   * Get integration status
   */
  static async getStatus(req: Request, res: Response): Promise<void> {
    try {
        const hasAppSecret = !!process.env.HUBBLE_APP_SECRET;
        const hasRestClientSecret = !!process.env.HUBBLE_REST_CLIENT_SECRET;
        const mockMode = process.env.HUBBLE_MOCK_MODE === 'true';
        const publicIp = await HubbleRestClient.getPublicIp();

        res.status(200).json({
            success: true,
            status: {
                mockMode,
                sdkConfigured: hasAppSecret,
                restApiConfigured: hasRestClientSecret,
                currentPublicIp: publicIp,
                liveApiConnected: !!HubbleRestClient.cachedToken,
                environment: process.env.HUBBLE_ENV || 'staging',
                targetEndpoint: process.env.HUBBLE_ENV === 'production' ? 'https://api.myhubble.money' : 'https://api.dev.myhubble.money',
                lastAuthError: HubbleRestClient.lastAuthError || null,
            }
        });
    } catch(err: any) {
        res.status(500).json({ success: false, error: err.message });
    }
  }

  /**
   * Endpoint: GET /api/hubble/logos/:name
   * Serve crisp company brand logos for Reward Store display
   */
  static getBrandLogo(req: Request, res: Response): void {
    const rawName = (req.params.name || '').toLowerCase().replace(/\.(svg|png|webp|jpg)$/, '');

    const svgMap: Record<string, string> = {
      makemytrip: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 240 70" width="240" height="70">
        <style>
          .t1 { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; font-size: 30px; font-weight: 800; fill: #FFFFFF; }
          .t2 { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; font-size: 30px; font-weight: 900; fill: #EF4444; }
          .sub { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; font-size: 10px; font-weight: 800; fill: #94A3B8; letter-spacing: 3.5px; }
        </style>
        <text x="120" y="38" text-anchor="middle">
          <tspan class="t1">make</tspan><tspan class="t2">my</tspan><tspan class="t1">trip</tspan>
        </text>
        <text x="120" y="55" text-anchor="middle" class="sub">FLIGHTS &amp; HOTELS</text>
      </svg>`,
      playstation: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 220 70" width="220" height="70">
        <g fill="#0070D1" transform="translate(95, 6) scale(1.1)">
          <path d="M15 2C13.3 2 12 3.3 12 5v19.8l5-2.2V6.2c0-.7.5-1.2 1.2-1.2h2.6c.7 0 1.2.5 1.2 1.2v7.6l5-2.2V5c0-1.7-1.3-3-3-3h-9z" fill="#00439C"/>
          <path d="M4 27.6c-2.4 1-3.9 2.5-3.9 4.1 0 2.8 4.2 4.3 10.9 4.3 4.8 0 9.8-.8 13.9-2.2l-2.4-2.8c-3.5 1-7.5 1.6-11.5 1.6-4.5 0-6.9-.9-6.9-1.9 0-.8 1.4-1.7 4-2.3l-4.2-.8zm24.2-3.1l-4.4 2c4.1.9 6.2 2 6.2 3.2 0 1.1-2.2 2-6.2 2.6l1.8 3c6-.9 9.4-2.6 9.4-5.6 0-2.4-2.4-4.2-6.8-5.2z" fill="#0070D1"/>
        </g>
        <text x="110" y="58" text-anchor="middle" font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif" font-size="12" font-weight="800" fill="#93C5FD" letter-spacing="3.5">PLAYSTATION</text>
      </svg>`,
      apple: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 70" width="200" height="70">
        <g transform="translate(86, 6) scale(1.15)">
          <path d="M15.2 12.9c-.1-2.9 2.4-4.3 2.5-4.4-1.4-2-3.5-2.3-4.2-2.3-1.8-.2-3.5 1.1-4.4 1.1-.9 0-2.3-1-3.8-1-2 0-3.8 1.1-4.8 2.9-2.1 3.6-.5 8.9 1.5 11.8 1 1.4 2.2 3 3.8 2.9 1.5-.1 2.1-1 3.9-1s2.4 1 3.9 1c1.6 0 2.6-1.5 3.6-2.9 1.2-1.7 1.6-3.3 1.7-3.4-.1 0-3.2-1.2-3.3-4.7zM12.4 4.3c.8-1 1.4-2.4 1.2-3.8-1.2.1-2.6.8-3.4 1.8-.7.8-1.3 2.2-1.2 3.6 1.4.1 2.6-.7 3.4-1.6z" fill="#FFFFFF"/>
        </g>
        <text x="100" y="58" text-anchor="middle" font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif" font-size="12" font-weight="800" fill="#FFFFFF" letter-spacing="3.5">APPLE GIFT</text>
      </svg>`,
      swiggy: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 220 70" width="220" height="70">
        <g transform="translate(36, 14)">
          <rect width="36" height="42" rx="10" fill="#FC8019"/>
          <path d="M18 10c-5.5 0-10 4.5-10 10 0 7.5 10 16 10 16s10-8.5 10-16c0-5.5-4.5-10-10-10zm0 13c-1.7 0-3-1.3-3-3s1.3-3 3-3 3 1.3 3 3-1.3 3-3 3z" fill="#FFFFFF"/>
        </g>
        <text x="135" y="44" font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif" font-size="28" font-weight="900" fill="#FC8019" letter-spacing="2">SWIGGY</text>
      </svg>`,
      myntra: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 70" width="200" height="70">
        <g transform="translate(85, 4)">
          <path d="M2 30C2 16 10 6 18 18c4 6 7 12 11 12s7-6 11-12c8-12 16-2 16 12 0 10-4 16-8 16s-6-4-10-10c-4-6-6-8-9-8s-5 2-9 8c-4 6-6 10-10 10s-8-6-8-16z" fill="#FF3F6C"/>
        </g>
        <text x="100" y="60" text-anchor="middle" font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif" font-size="13" font-weight="900" fill="#FFFFFF" letter-spacing="4">MYNTRA</text>
      </svg>`,
      starbucks: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 220 70" width="220" height="70">
        <circle cx="110" cy="24" r="18" fill="#006241"/>
        <circle cx="110" cy="24" r="15" fill="#006241" stroke="#FFFFFF" stroke-width="1.5"/>
        <path d="M104 22c0-2 2-4 6-4s6 2 6 4c0 3-3 6-6 9-3-3-6-6-6-9z" fill="#FFFFFF"/>
        <circle cx="110" cy="18" r="2" fill="#006241"/>
        <text x="110" y="58" text-anchor="middle" font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif" font-size="12" font-weight="900" fill="#10B981" letter-spacing="4">STARBUCKS</text>
      </svg>`,
      amazon: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 70" width="200" height="70">
        <text x="100" y="38" text-anchor="middle" font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif" font-size="28" font-weight="900" fill="#FFFFFF" letter-spacing="1">amazon</text>
        <path d="M68 46c20 8 45 8 64 0" stroke="#FF9900" stroke-width="3.5" stroke-linecap="round" fill="none"/>
        <polygon points="132,44 135,49 129,48" fill="#FF9900"/>
      </svg>`,
      zomato: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 70" width="200" height="70">
        <text x="100" y="44" text-anchor="middle" font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif" font-style="italic" font-size="34" font-weight="900" fill="#E23744" letter-spacing="-1">zomato</text>
      </svg>`,
      uber: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 70" width="200" height="70">
        <text x="100" y="44" text-anchor="middle" font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif" font-size="32" font-weight="800" fill="#FFFFFF" letter-spacing="1">Uber</text>
      </svg>`,
      flipkart: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 220 70" width="220" height="70">
        <g transform="translate(35, 14)">
          <rect width="36" height="40" rx="8" fill="#2874F0"/>
          <path d="M12 12h12v4H16v6h6v4H16v8h-4V12z" fill="#FFEB3B"/>
        </g>
        <text x="135" y="42" font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif" font-style="italic" font-size="26" font-weight="900" fill="#FFFFFF">Flipkart</text>
      </svg>`,
    };

    const matchedKey = Object.keys(svgMap).find(k => rawName.includes(k));
    const svg = (matchedKey && svgMap[matchedKey]) || `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 70" width="200" height="70">
      <rect width="200" height="70" rx="12" fill="#1E1B2E"/>
      <text x="100" y="42" text-anchor="middle" font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif" font-size="16" font-weight="700" fill="#A78BFA">${rawName.toUpperCase()}</text>
    </svg>`;

    res.setHeader('Content-Type', 'image/svg+xml');
    res.setHeader('Cache-Control', 'public, max-age=86400');
    res.send(svg);
  }
}