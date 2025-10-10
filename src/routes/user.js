import { Router } from 'express';
import * as userController from '../controllers/user.controller.js';
import { createUser } from '../controllers/user.controller.js';
import { login } from '../controllers/auth.controller.js';
import { accountSetup } from '../controllers/account.controller.js';
import { addToken } from '../controllers/fcm.controller.js';
import { resetPasswordAfterRecovery, sendRecoveryCode, verifyRecoveryCode } from '../controllers/recovery.controller.js';
import { logoutController } from '../controllers/logout.controller.js';

const router = Router();

router.get('/', (req, res) => res.json({ message: 'User API root' }));
router.post('/create', createUser);
router.post('/login', login);
router.post('/addToken', addToken)
router.post('/logout', logoutController);

router.post('/account/setup', accountSetup);
router.post('/account/recovery/send-code', sendRecoveryCode);
router.post('/account/recovery/verify', verifyRecoveryCode);
router.post('/account/recovery/reset', resetPasswordAfterRecovery);



export default router;