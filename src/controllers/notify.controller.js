// src/api/notifyOrder.js
import admin from '../config/firebase.js';
import User from '../models/User.js';
import Site from '../models/Site.js'; // <-- added

// Helpers
const normalizeTokens = (raw) => {
  let fcmTokens = raw || [];
  if (typeof fcmTokens === 'string') {
    try {
      const parsed = JSON.parse(fcmTokens);
      fcmTokens = Array.isArray(parsed) ? parsed : Object.values(parsed || {});
    } catch {
      fcmTokens = [];
    }
  } else if (!Array.isArray(fcmTokens) && typeof fcmTokens === 'object' && fcmTokens) {
    fcmTokens = Object.values(fcmTokens);
  }
  return (fcmTokens || [])
    .filter((t) => typeof t === 'string')
    .map((t) => t.trim())
    .filter(Boolean);
};

const uniq = (arr) => Array.from(new Set(arr));

const chunk = (arr, size) => {
  const out = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
};

// quick check for a 24-char hex string (Mongo ObjectId-like)
const isObjectIdLike = (val) => /^[a-fA-F0-9]{24}$/.test(String(val || ''));

// Try to resolve an incoming site value (slug or _id) to a slug
const resolveSiteSlug = async (incoming) => {
  const raw = String(incoming || '').trim();
  if (!raw) return { slug: null, via: 'none' };

  // First, assume it's already the slug
  return { slug: raw, via: 'slug' };
};

// POST /api/order/notify
// body: the new order payload (from your other Express backend)
export const notifyOrder = async (req, res) => {
  try {
    const order = req.body || {};
    const {
      site,
      status,
      fulfillmentType, // 'pickup' | 'delivery' | etc.
      totalCents,
      _id: orderId
    } = order;

    if (!site) {
      return res.status(400).json({ error: 'Missing "site" in payload' });
    }

    // --- Step 1: resolve site input into a slug, and fetch users ---
    let { slug: siteSlug } = await resolveSiteSlug(site);

    // Attempt #1: treat incoming "site" as slug directly
    // If you want case-insensitive match, consider adding a collation on the collection
    // or switch to { site: new RegExp(`^${escapeRegExp(siteSlug)}$`, 'i') }.
    let users = await User.find({ site: siteSlug });

    // Attempt #2: if no users, check if "site" was actually an ObjectId and resolve to slug via Sites collection
    let resolvedFromId = null;
    if (!users || users.length === 0) {
      if (isObjectIdLike(site)) {
        const siteDoc = await Site.findById(site).lean();
        if (!siteDoc || !siteDoc.slug) {
          return res.status(404).json({
            error: 'Site not found by id and no users found by provided slug',
            tried: {
              asSlug: siteSlug,
              asId: String(site)
            }
          });
        }
        siteSlug = String(siteDoc.slug);
        resolvedFromId = String(site);
        users = await User.find({ site: siteSlug });
      }
    }

    if (!users || users.length === 0) {
      return res.status(404).json({
        error: 'No users found for this site',
        siteTried: siteSlug,
        resolvedFromId
      });
    }

    // --- Step 2: Collect and normalize tokens from every user ---
    let allTokens = [];
    const tokenOwners = {}; // optional: map token -> userId for debugging
    for (const u of users) {
      const tokens = normalizeTokens(u.fcm_tokens);
      for (const t of tokens) {
        allTokens.push(t);
        if (!tokenOwners[t]) tokenOwners[t] = [];
        tokenOwners[t].push(String(u._id));
      }
    }

    allTokens = uniq(allTokens);
    if (allTokens.length === 0) {
      return res.status(404).json({ error: 'No valid FCM tokens found for users on this site', site: siteSlug });
    }

    // --- Step 3: Build notification content ---
    const totalDollars =
      typeof totalCents === 'number' ? (totalCents / 100).toFixed(2) : '0.00';
    const orderType = fulfillmentType || 'order';
    const title = '🛒 New Order';
    const body = `${orderType === 'pickup' ? 'Pickup' : orderType} • $${totalDollars}`;

    // >>> sound requirement (for now always "order")
    const soundName = 'order';

    // FCM multicast supports up to 500 tokens per call
    const batches = chunk(allTokens, 500);

    let totalSuccess = 0;
    let totalFailure = 0;
    const failed = [];

    for (const tokens of batches) {
      const message = {
        tokens,
        data: {
          title,
          body,
          orderId: String(orderId || ''),
          fulfillmentType: String(orderType),
          totalDollars: String(totalDollars),
          status: String(status || ''),
          sound: soundName
        },
        android: { priority: 'high' },
        apns: { headers: { 'apns-priority': '10' } },
        content_available: true,
        priority: 'high'
      };

      const response = await admin.messaging().sendEachForMulticast(message);

      totalSuccess += response.successCount || 0;
      totalFailure += response.failureCount || 0;

      // Collect failed tokens and reasons
      response.responses.forEach((r, i) => {
        if (!r.success) {
          failed.push({
            token: tokens[i],
            error: r.error?.message || 'Unknown error',
            owners: tokenOwners[tokens[i]] || []
          });
        }
      });
    }

    return res.status(200).json({
      message: `Notifications sent to ${totalSuccess} devices. ${totalFailure} failures.`,
      siteInput: String(site),
      siteResolvedSlug: siteSlug,
      resolvedFromId,
      userCount: users.length,
      tokenCount: allTokens.length,
      failedTokens: failed,
      outgoing: {
        title,
        body,
        fulfillmentType: orderType,
        totalDollars,
        sound: soundName
      }
    });
  } catch (err) {
    console.error('❌ notify error:', err?.message || err);
    return res.status(500).json({
      error: 'Internal Server Error',
      details: err?.message || String(err)
    });
  }
};
