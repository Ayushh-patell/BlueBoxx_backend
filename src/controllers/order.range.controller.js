// src/controllers/orders.range.controller.js
import mongoose from 'mongoose';
import Site from '../models/Site.js';
import Order from '../models/Order.js'; // shared orders model, strict:false

// --- helpers (no external deps) ---

/** get start-of-day (00:00) for a calendar date in a specific tz, as a UTC instant */
function sodUtcForDate(dateYYYYMMDD, tz = 'UTC') {
  // Use Intl to format a known instant as that tz date, then build a UTC time at local midnight.
  // This avoids pulling in luxon/date-fns-tz while staying deterministic enough for day windows.
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false
  }).formatToParts(new Date(`${dateYYYYMMDD}T12:00:00Z`)); // midday as a stable probe
  const get = (t) => parts.find(p => p.type === t)?.value;
  const y = get('year'), m = get('month'), d = get('day');
  // Build a "local midnight" string and interpret it as UTC to yield a stable instant.
  return new Date(`${y}-${m}-${d}T00:00:00.000Z`);
}

/** get start-of-today (00:00) in tz, as a UTC instant */
function startOfTodayUtcInTz(tz = 'UTC') {
  const now = new Date();
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz,
    year: 'numeric', month: '2-digit', day: '2-digit'
  }).formatToParts(now);
  const y = parts.find(p => p.type === 'year')?.value;
  const m = parts.find(p => p.type === 'month')?.value;
  const d = parts.find(p => p.type === 'day')?.value;
  return new Date(`${y}-${m}-${d}T00:00:00.000Z`);
}

/** add N days (in ms) to a Date (treating day as 24h chunk in UTC) */
function addDays(utcDate, n) {
  return new Date(utcDate.getTime() + n * 24 * 60 * 60 * 1000);
}

/**
 * GET /api/order/by-site/range?site=<slug>&mode=week|month|custom[&tz=Area/City][&start=YYYY-MM-DD][&end=YYYY-MM-DD]
 *
 * week:  7 full days ending yesterday (in tz)
 * month: 30 full days ending yesterday (in tz)
 * custom: start..end inclusive (midnight-to-midnight in tz), clamped to max 2 months (~62 days)
 *
 * NOTE: Orders with status "awaiting_payment" are excluded (case-insensitive).
 *
 * Returns: { ok, site, mode, tz, window:{ start, end }, count, orders[] }
 */
export const getOrdersBySiteRange = async (req, res) => {
  try {
    const { site: siteSlug, mode, tz } = req.query || {};
    let { start: startStr, end: endStr } = req.query || {};

    if (!siteSlug || typeof siteSlug !== 'string') {
      return res.status(400).json({ error: '`site` (slug) is required' });
    }
    if (!mode || !['week', 'month', 'custom'].includes(mode)) {
      return res.status(400).json({ error: '`mode` must be one of: week, month, custom' });
    }

    // 1) Find site by slug
    const siteDoc = await Site.findOne({ slug: siteSlug });
    if (!siteDoc) return res.status(404).json({ error: 'Site not found' });

    // 2) Compute time window in UTC based on tz
    const zone = typeof tz === 'string' && tz.length ? tz : 'UTC';
    const todayStartUtc = startOfTodayUtcInTz(zone); // 00:00 today (in tz), as UTC instant
    const endExclusiveYesterday = todayStartUtc;     // end of window for week/month (yesterday+1 at 00:00)
    let startUtc;
    let endUtc;

    if (mode === 'week') {
      // last 7 full days ending yesterday -> [todayStart-7d, todayStart)
      endUtc = endExclusiveYesterday;
      startUtc = addDays(endUtc, -7);
    } else if (mode === 'month') {
      // last 30 full days ending yesterday -> [todayStart-30d, todayStart)
      endUtc = endExclusiveYesterday;
      startUtc = addDays(endUtc, -30);
    } else {
      // custom
      if (!startStr || !/^\d{4}-\d{2}-\d{2}$/.test(startStr) ||
          !endStr   || !/^\d{4}-\d{2}-\d{2}$/.test(endStr)) {
        return res.status(400).json({ error: '`start` and `end` (YYYY-MM-DD) are required for custom mode' });
      }
      // inclusive both sides in local tz -> [sod(start), sod(end)+1day)
      startUtc = sodUtcForDate(startStr, zone);
      endUtc   = addDays(sodUtcForDate(endStr, zone), 1);

      // clamp to max ~2 months (62 days)
      const maxDays = 62;
      const maxMs = maxDays * 24 * 60 * 60 * 1000;
      if (endUtc.getTime() - startUtc.getTime() > maxMs) {
        endUtc = new Date(startUtc.getTime() + maxMs);
      }
    }

    // 3) Query orders by site + createdAt range — exclude awaiting_payment
    const query = {
      site: new mongoose.Types.ObjectId(siteDoc._id),
      createdAt: { $gte: startUtc, $lt: endUtc },
      // Exclude status "awaiting_payment" (case-insensitive), but still include docs without a status
      $expr: {
        $ne: [
          { $toLower: { $ifNull: ['$status', ''] } },
          'awaiting_payment'
        ]
      }
      // If you prefer a simpler (non-$expr) version, you can use:
      // status: { $not: /^awaiting_payment$/i }
    };

    const orders = await Order.find(query)
      .sort({ createdAt: -1 })
      .lean()
      .exec();

    return res.json({
      ok: true,
      site: { _id: siteDoc._id, slug: siteDoc.slug, name: siteDoc.name || siteDoc.slug },
      mode,
      tz: zone,
      window: { start: startUtc, end: endUtc }, // UTC instants
      count: orders.length,
      orders
    });
  } catch (err) {
    // invalid time zone names will throw from Intl.*
    console.error('getOrdersBySiteRange error:', err?.stack || err?.message || err);
    return res.status(500).json({ ok: false, error: 'Failed to fetch orders' });
  }
};
