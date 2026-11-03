import { Router } from 'express';
import { HubbleController } from '../controllers/hubble.controller';
import { requireUserAuth, optionalUserAuth } from '../middleware/auth.middleware';

const router = Router();

// Customer / App route to retrieve Hubble SSO token (optional auth to capture logged in user)
router.post('/sso-token', optionalUserAuth, HubbleController.getSSOToken);
router.get('/sso-token', optionalUserAuth, HubbleController.getSSOToken);

// Portal alias: Hubble Portal appends /sso automatically to Integration Base URL
router.post('/sso', optionalUserAuth, HubbleController.getSSOToken);
router.get('/sso', optionalUserAuth, HubbleController.getSSOToken);

// Hubble Partner Coins Integration APIs (Callback from Hubble backend)
router.get('/balance', HubbleController.getBalance);
router.post('/debit', HubbleController.debitCoins);
router.post('/reverse', HubbleController.reverseDebit);

// Hubble REST API Endpoints (Brands catalog, Order placement, Wallet)
router.get('/brands', HubbleController.getBrands);
router.get('/products', HubbleController.getBrands);
router.get('/brands/:id', HubbleController.getBrandById);
router.get('/products/:id', HubbleController.getBrandById);

// Order creation MUST be authenticated - debits real CI Points from PostgreSQL wallet
router.post('/orders', requireUserAuth, HubbleController.createOrder);
router.get('/wallet', optionalUserAuth, HubbleController.getWallet);
router.get('/status', HubbleController.getStatus);
router.get('/logos/:name', HubbleController.getBrandLogo);

// Direct root route if base URL ends with /sso
router.post('/', optionalUserAuth, HubbleController.getSSOToken);
router.get('/', optionalUserAuth, HubbleController.getSSOToken);

export default router;
