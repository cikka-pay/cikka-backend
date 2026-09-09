import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';

dotenv.config();

/**
 * Hubble Money Configuration Helper
 */
export const getHubbleConfig = () => {
  const env = process.env.HUBBLE_ENV || 'staging';
  const baseUrl = env === 'production' 
    ? 'https://sdk.myhubble.money/' 
    : 'https://sdk.dev.myhubble.money/';

  const clientId = process.env.HUBBLE_CLIENT_ID || 'cikka_staging_client_id';
  const appSecret = process.env.HUBBLE_APP_SECRET || process.env.HUBBLE_SECRET || 'cikka_staging_app_secret';

  // Load RSA private key: from ENV string or fallback to local key file
  let privateKey = process.env.HUBBLE_RSA_PRIVATE_KEY || '';
  if (!privateKey) {
    const defaultKeyPath = path.join(__dirname, '../../../scripts/local/keys/private_key.pem');
    if (fs.existsSync(defaultKeyPath)) {
      privateKey = fs.readFileSync(defaultKeyPath, 'utf8');
    }
  }

  // Handle base64 encoded private key if configured in environment
  if (privateKey.startsWith('base64:')) {
    privateKey = Buffer.from(privateKey.replace('base64:', ''), 'base64').toString('utf8');
  }

  return {
    env,
    baseUrl,
    clientId,
    appSecret,
    privateKey,
  };
};
