import jwt from 'jsonwebtoken';
import { getHubbleConfig } from '../config/hubble.config';

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
    const config = getHubbleConfig();

    if (!config.privateKey) {
      throw new Error('Hubble RSA Private Key is missing. Please set HUBBLE_RSA_PRIVATE_KEY in .env or run key generator.');
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
    const token = jwt.sign(payload, config.privateKey, {
      algorithm: 'RS256',
    });

    // Build Hubble SDK WebView embed URL for React Native (wrap-plt=rn)
    const queryParams = new URLSearchParams({
      clientId: config.clientId,
      appSecret: config.appSecret,
      clientSecret: config.appSecret,
      token,
      'wrap-plt': 'rn',
      theme: 'dark',
      coins: 'true',
      coinsEnabled: 'true',
    });

    const embedUrl = `${config.baseUrl}?${queryParams.toString()}`;

    return {
      success: true,
      token,
      embedUrl,
      clientId: config.clientId,
      expiresInSeconds,
    };
  }
}
