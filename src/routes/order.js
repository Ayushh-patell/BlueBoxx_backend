import express from 'express';
import { Router } from 'express';

import * as orderController from '../controllers/order.controller.js';
import { notifyOrder } from '../controllers/notify.controller.js';
import { getOrdersBySiteRange } from '../controllers/order.range.controller.js';
import { getDashboardSeries } from '../controllers/order.dashboard.controller.js';
import { getOrdersBySiteDay } from "../controllers/order.bySite.controller.js";
import { requireAuth } from '../middleware/auth.js';
import { updateOrderStatus } from '../controllers/order.status.controller.js';
import { sendOrderAcceptedEmail } from '../controllers/email.controller.js';

const router = Router();

router.get('/', (req, res) => res.json({ message: 'Order API root' }));

router.get('/dashboard', getDashboardSeries)
router.get('/by-site/range', getOrdersBySiteRange);
router.get('/by-site/day', getOrdersBySiteDay);
router.post('/notify', notifyOrder);
router.post('/accepted-email', sendOrderAcceptedEmail);
router.patch('/:id/status', requireAuth, express.json(), updateOrderStatus);


export default router;
