// src/controllers/orders.bySite.controller.js
import mongoose from 'mongoose';
import Site from '../models/Site.js';
import Order from '../models/Order.js'; // shared orders model (strict:false)

/**
 * Build start-of-day (midnight) in a given IANA timezone, returned as a UTC Date.
 * No external libs: use a midday probe to avoid DST edge-cases, then formatToParts.
 */
function startOfDayUtcFor(dateYmd, tz = 'UTC') {
  // Use a midday probe to avoid the local-time pitfalls & DST shifts
  const probe = new Date(`${dateYmd}T12:00:00Z`);
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).formatToParts(probe);
  const y = parts.find(p => p.type === 'year')?.value;
  const m = parts.find(p => p.type === 'month')?.value;
  const d = parts.find(p => p.type === 'day')?.value;
  // Construct the midnight moment in that TZ, expressed as UTC
  return new Date(`${y}-${m}-${d}T00:00:00.000Z`);
}

const ONE_DAY_MS = 24 * 60 * 60 * 1000;

/**
 * GET /api/order/by-site/day?site=<slug>&date=YYYY-MM-DD[&tz=Area/City]
 *
 * - site: site.slug (text) [required]
 * - date: calendar day (YYYY-MM-DD) [required]
 * - tz: IANA timezone (optional). If provided, calculates midnight→midnight in that tz; otherwise UTC.
 *
 * Returns: { ok, site:{_id,slug,name}, date, tz, window:{start,end}, count, orders[] }
 */
export const getOrdersBySiteDay = async (req, res) => {
  try {
    const { site: siteSlug, date, tz } = req.query || {};

    if (!siteSlug || typeof siteSlug !== 'string') {
      return res.status(400).json({ error: '`site` (slug) is required' });
    }
    if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return res.status(400).json({ error: '`date` must be YYYY-MM-DD' });
    }

    // 1) find site by slug
    const siteDoc = await Site.findOne({ slug: siteSlug }).lean();
    if (!siteDoc) return res.status(404).json({ error: 'Site not found' });

    // 2) compute day window safely
    const zone = (typeof tz === 'string' && tz.length) ? tz : 'UTC';
    let start, end;
    try {
      start = startOfDayUtcFor(date, zone);
    } catch (e) {
      // If invalid tz, fall back to UTC
      start = new Date(`${date}T00:00:00.000Z`);
    }
    end = new Date(start.getTime() + ONE_DAY_MS);

    // Optional: quick debug log (toggle with env)
    if (process.env.DEBUG_DAY_WINDOW === '1') {
      console.log('[by-site/day] tz:', zone, 'start:', start.toISOString(), 'end:', end.toISOString());
    }

    // 3) query — NO pagination/skip
    const query = {
      site: new mongoose.Types.ObjectId(siteDoc._id),
      createdAt: { $gte: start, $lt: end }
    };

    const orders = await Order.find(query)
      .sort({ createdAt: -1 })
      .lean()
      .exec();

    return res.json({
      ok: true,
      site: { _id: siteDoc._id, slug: siteDoc.slug, name: siteDoc.name || siteDoc.slug },
      date,
      tz: zone,
      window: { start, end },
      count: orders.length,
      orders
    });
  } catch (err) {
    console.error('getOrdersBySiteDay error:', err?.stack || err?.message || err);
    return res.status(500).json({ ok: false, error: 'Failed to fetch orders' });
  }
};