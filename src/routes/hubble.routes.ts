import { Router } from 'express';
import { HubbleController } from '../controllers/hubble.controller';
import { requireHubbleSecret } from '../middleware/hubble-auth.middleware';

const router = Router();

// Public Customer / App route to retrieve Hubble SSO token
router.post('/sso-token', HubbleController.getSSOToken);
router.get('/sso-token', HubbleController.getSSOToken);

// Portal alias: Hubble Portal appends /sso automatically to Integration Base URL
router.post('/sso', HubbleController.getSSOToken);
router.get('/sso', HubbleController.getSSOToken);

// Hubble Partner Coins Integration APIs
// Called by Hubble's servers — authenticated with the X-Hubble-Secret header.
router.get('/balance', requireHubbleSecret, HubbleController.getBalance);
router.post('/debit', requireHubbleSecret, HubbleController.debitCoins);
router.post('/reverse', requireHubbleSecret, HubbleController.reverseDebit);

// Hubble REST API Endpoints (Brands catalog, Order placement, Wallet)
router.get('/brands', HubbleController.getBrands);
router.get('/products', HubbleController.getBrands);
router.get('/brands/:id', HubbleController.getBrandById);
router.get('/products/:id', HubbleController.getBrandById);
router.post('/orders', HubbleController.createOrder);
router.get('/wallet', HubbleController.getWallet);
router.get('/status', HubbleController.getStatus);
router.get('/logos/:name', HubbleController.getBrandLogo);

// Direct root route if base URL ends with /sso
router.post('/', HubbleController.getSSOToken);
router.get('/', HubbleController.getSSOToken);

export default router;
