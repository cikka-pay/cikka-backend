import crypto from 'crypto';
import dotenv from 'dotenv';
import jwt from 'jsonwebtoken';
import { getHubbleConfig } from '../config/hubble.config';

let fallbackPrivateKey: string | null = null;

export interface HubbleUserSession {
  userId: string;
  phone: string;
  name?: string;
  email?: string;
}

export interface HubbleSSOResponse {
  success: boolean;
  token: string;
  embedUrl: string;
  clientId: string;
  expiresInSeconds: number;
}

export class HubbleService {
  /**
   * Generate an RS256 JWT Single Sign-On token and React Native Embed URL for Hubble Money SDK
   */
  static generateSSOToken(user: HubbleUserSession): HubbleSSOResponse {
    dotenv.config();
    const config = getHubbleConfig();

    let privateKey = config.privateKey;
    if (!privateKey) {
      if (!fallbackPrivateKey) {
        try {
          const { privateKey: key } = crypto.generateKeyPairSync('rsa', {
            modulusLength: 2048,
            publicKeyEncoding: { type: 'spki', format: 'pem' },
            privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
          });
          fallbackPrivateKey = key;
        } catch (e) {
          console.warn('[HubbleService] Failed to auto-generate dev RSA key');
        }
      }
      privateKey = fallbackPrivateKey || '';
    }

    if (!privateKey) {
      throw new Error('Hubble RSA Private Key is missing and could not be generated.');
    }

    // Format phone to 10 digits
    const cleanPhone = user.phone ? user.phone.replace(/\D/g, '').slice(-10) : '9999999999';

    const now = Math.floor(Date.now() / 1000);
    const iat = now - 300; // Allow 5 mins clock skew for device/server time mismatch
    const expiresInSeconds = 86400; // 24 hours validity

    const userId = user.userId || `cikka_${cleanPhone}`;

    const payload = {
      iss: config.clientId,
      sub: userId,
      userId: userId,
      phone: cleanPhone,
      phoneNumber: cleanPhone,
      mobile: cleanPhone,
      email: user.email || `${userId}@cikka.app`,
      name: user.name || 'Cikka User',
      iat,
      exp: now + expiresInSeconds,
    };

    // Sign JWT with RS256 algorithm
    const token = jwt.sign(payload, privateKey, {
      algorithm: 'RS256',
    });

    const secretKey = process.env.HUBBLE_SECRET || config.appSecret;

    // Build Hubble SDK WebView embed URL for React Native
    const queryParams: Record<string, string> = {
      clientId: config.clientId,
      appSecret: process.env.HUBBLE_APP_SECRET || config.appSecret,
      token: token,
      'wrap-plt': 'rn',
      theme: 'dark',
      coins: 'true',
      coinsEnabled: 'true',
    };

    const embedUrl = `${config.baseUrl}?${new URLSearchParams(queryParams).toString()}`;

    return {
      success: true,
      token,
      embedUrl,
      clientId: config.clientId,
      expiresInSeconds,
    };
  }
}
