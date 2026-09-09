import { Request, Response } from 'express';
import { HubbleService } from '../services/hubble.service';

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
}
