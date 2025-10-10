// src/routes/util.js
import { Router } from 'express';
import { testEmail } from '../controllers/util.controller.js';

const router = Router();

// POST /api/util/test-email
router.post('/test-email', testEmail);

export default router;
