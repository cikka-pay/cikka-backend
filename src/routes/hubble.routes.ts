import { Router } from 'express';
import { HubbleController } from '../controllers/hubble.controller';

const router = Router();

// Public Customer / App route to retrieve Hubble SSO token
router.post('/sso-token', HubbleController.getSSOToken);
router.get('/sso-token', HubbleController.getSSOToken);

// Portal alias: Hubble Portal appends /sso automatically to Integration Base URL
router.post('/sso', HubbleController.getSSOToken);
router.get('/sso', HubbleController.getSSOToken);

// Hubble Partner Coins Integration APIs
router.get('/balance', HubbleController.getBalance);
router.post('/debit', HubbleController.debitCoins);
router.post('/reverse', HubbleController.reverseDebit);

// Direct root route if base URL ends with /sso
router.post('/', HubbleController.getSSOToken);
router.get('/', HubbleController.getSSOToken);

export default router;
