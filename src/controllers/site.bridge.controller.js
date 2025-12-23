const SITE_PLATFORM_URL = process.env.SITE_PLATFORM_URL;
const SITE_PLATFORM_ADMIN_TOKEN = process.env.SITE_PLATFORM_ADMIN_TOKEN;

const requireSitePlatformUrl = () => {
  if (!SITE_PLATFORM_URL) {
    const err = new Error('SITE_PLATFORM_URL is not set');
    err.status = 500;
    throw err;
  }
};

const getClientIp = (req) => {
  const fwd = req.headers['x-forwarded-for'];
  if (typeof fwd === 'string' && fwd.length) return fwd.split(',')[0].trim();
  return req.ip || req.connection?.remoteAddress || '';
};

const pickAuthHeaderForUpstream = (req) => {
  // Prefer service token if present, else forward caller Authorization header.
  if (SITE_PLATFORM_ADMIN_TOKEN && SITE_PLATFORM_ADMIN_TOKEN.trim()) {
    return `Bearer ${SITE_PLATFORM_ADMIN_TOKEN.trim()}`;
  }
  return req.headers.authorization || '';
};

const upstreamGetSiteBySlug = async (slug) => {
  requireSitePlatformUrl();

  const url = `${SITE_PLATFORM_URL}/api/shop/${encodeURIComponent(slug)}/site`;
  const res = await fetch(url, {
    method: 'GET',
    headers: { Accept: 'application/json' },
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    const err = new Error(text || `Upstream GET failed (${res.status})`);
    err.status = res.status;
    throw err;
  }

  return res.json();
};

const upstreamPatchSiteById = async (req, siteId, patchBody) => {
  requireSitePlatformUrl();

  const url = `${SITE_PLATFORM_URL}/api/admin/sites/${encodeURIComponent(siteId)}/close-override`;
  const authHeader = pickAuthHeaderForUpstream(req);

  const headers = {
    Accept: 'application/json',
    'Content-Type': 'application/json',
  };
  // if (authHeader) headers.Authorization = authHeader;

  const res = await fetch(url, {
    method: 'PATCH',
    headers,
    body: JSON.stringify(patchBody),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    const err = new Error(text || `Upstream PATCH failed (${res.status})`);
    err.status = res.status;
    throw err;
  }

  return res.json();
};

/**
 * GET /api/site/:slug
 * Bridges to other backend: GET /api/shop/:slug/site
 */
export const getSiteBySlugBridge = async (req, res) => {
  try {
    const { slug } = req.params || {};
    if (!slug || typeof slug !== 'string') {
      return res.status(400).json({ ok: false, error: '`slug` is required' });
    }

    const site = await upstreamGetSiteBySlug(slug);
    return res.json({ ok: true, site });
  } catch (err) {
    console.error('getSiteBySlugBridge error:', err?.message || err);
    return res.status(err?.status || 500).json({
      ok: false,
      error: err?.message || 'Failed to fetch site',
    });
  }
};

/**
 * PATCH /api/site/:slug/store-closed-override
 * Body: { storeClosedOverride: boolean }
 *
 * Flow:
 * 1) GET /api/shop/:slug/site (to resolve siteId + previous value)
 * 2) PATCH /api/admin/sites/:siteId (update storeClosedOverride)
 * 3) console.log basics here
 */
export const patchStoreClosedOverrideBridge = async (req, res) => {
  try {
    const { slug } = req.params || {};
    const { storeClosedOverride } = req.body || {};

    if (!slug || typeof slug !== 'string') {
      return res.status(400).json({ ok: false, error: '`slug` is required' });
    }
    if (typeof storeClosedOverride !== 'boolean') {
      return res.status(400).json({ ok: false, error: '`storeClosedOverride` must be boolean' });
    }

    // 1) Resolve siteId + previous value from upstream
    const upstreamSite = await upstreamGetSiteBySlug(slug);
    const siteId = upstreamSite?.siteId;

    if (!siteId) {
      return res.status(502).json({ ok: false, error: 'Upstream siteId missing' });
    }

    const prev = !!upstreamSite?.storeClosedOverride;
    const next = storeClosedOverride;

    // 2) Patch upstream by siteId
    const patched = await upstreamPatchSiteById(req, siteId, { storeClosedOverride: next, ADMIN_SECRET:"admin-secret-key" });

    // 3) Log basics in console (no DB)
    const action = next ? 'MANUAL_CLOSE' : 'MANUAL_OPEN';
    const ip = getClientIp(req);
    const ua = req.get('user-agent') || '';

    // If your auth middleware sets any of these, great; otherwise they'll be "-"
    const actorId =
      req.user?._id?.toString?.() ||
      req.user?.id?.toString?.() ||
      req.userId?.toString?.() ||
      '-';
    const actorEmail = req.user?.email || req.user?.userEmail || '-';

    console.log(
      `[STORE_OVERRIDE] ${action} slug=${slug} siteId=${siteId} prev=${prev} next=${next} actorId=${actorId} actorEmail=${actorEmail} ip=${ip} ua="${ua}"`
    );

    return res.json({ ok: true, site: patched });
  } catch (err) {
    console.error('patchStoreClosedOverrideBridge error:', err?.message || err);
    return res.status(err?.status || 500).json({
      ok: false,
      error: err?.message || 'Failed to update storeClosedOverride',
    });
  }
};
