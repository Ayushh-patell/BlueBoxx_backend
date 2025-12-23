import express from 'express';
import { getSiteBySlugBridge, patchStoreClosedOverrideBridge } from '../controllers/site.bridge.controller';

const router = express.Router();

router.get('/:slug', getSiteBySlugBridge);

router.patch(
  '/:slug/store-closed-override',
  express.json(),
  patchStoreClosedOverrideBridge
);

export default router;
