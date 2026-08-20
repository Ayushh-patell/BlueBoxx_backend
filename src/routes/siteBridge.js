import express from 'express';
import { getSiteBySlugBridge, patchStoreClosedOverrideBridge } from '../controllers/site.bridge.controller.js';
import Site from '../models/Site.js';

const router = express.Router();

// GET /api/site — list local sites (for admin portal)
router.get('/', async (_req, res) => {
  try {
    const sites = await Site.find({})
      .select({ slug: 1, name: 1 })
      .sort({ slug: 1 })
      .lean();
    return res.json({ ok: true, count: sites.length, sites });
  } catch (err) {
    console.error('list sites error:', err?.message || err);
    return res.status(500).json({ ok: false, error: 'Failed to list sites' });
  }
});

router.get('/:slug', getSiteBySlugBridge);

router.patch(
  '/:slug/store-closed-override',
  express.json(),
  patchStoreClosedOverrideBridge
);

export default router;
