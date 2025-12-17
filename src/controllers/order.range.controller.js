// src/controllers/orders.range.controller.js
import mongoose from 'mongoose';
import Site from '../models/Site.js';
import Order from '../models/Order.js'; // shared orders model, strict:false

const CANADA_TZ = 'America/Edmonton';
const MAX_CUSTOM_DAYS = 62; // ~2 months

// ─────────────────────────────────────────────────────────────────────────────
// HELPERS (backward compatible fallbacks)
// ─────────────────────────────────────────────────────────────────────────────
const pickDisplayName = (item) => {
  // New desired precedence:
  // 1) customerName
  // 2) guestName
  // Backward-compatible fallbacks:
  // 3) userName / name
  return (
    item?.customerName ||
    item?.guestName ||
    item?.userName ||
    item?.name ||
    ''
  );
};

const pickDisplayPhone = (item) => {
  // New desired precedence:
  // 1) customerNumber
  // 2) guestNumber
  // Backward-compatible fallbacks (existing + common legacy fields)
  return (
    item?.customerNumber ||
    item?.guestNumber ||
    item?.customerPhone ||
    item?.userPhone ||
    item?.userNumber ||
    item?.userContact ||
    item?.phone ||
    item?.mobile ||
    ''
  );
};

const pickDisplayEmail = (item) => {
  // Keep userEmail first (as requested), plus backward-compatible fallbacks
  return (
    item?.userEmail ||
    item?.customerEmail ||
    item?.guestEmail ||
    item?.email ||
    ''
  );
};

// Safely set nested fields without breaking if the structure is missing
const setIfPathExists = (obj, path, value) => {
  let cur = obj;
  for (let i = 0; i < path.length - 1; i++) {
    if (!cur || typeof cur !== 'object') return obj;
    cur = cur[path[i]];
  }
  if (cur && typeof cur === 'object') {
    cur[path[path.length - 1]] = value;
  }
  return obj;
};

/**
 * GET /api/order/by-site/range?site=<slug>&mode=week|month|custom[&start=YYYY-MM-DD][&end=YYYY-MM-DD]
 *
 * Window semantics (all in America/Edmonton):
 * - week:  last 7 full days ending yesterday -> [today@00:00 - 7d, today@00:00)
 * - month: last 30 full days ending yesterday -> [today@00:00 - 30d, today@00:00)
 * - custom: inclusive calendar days -> [start@00:00, end@00:00 + 1day)
 *
 * Notes:
 * - Timezone is hard-locked to America/Edmonton (DST-aware).
 * - createdAt is assumed to be stored in UTC.
 * - Excludes status "awaiting_payment" (case-insensitive).
 *
 * Returns: { ok, site, mode, tz, window:{ start, end }, count, orders[] }
 */
export const getOrdersBySiteRange = async (req, res) => {
  try {
    const { site: siteSlug, mode } = req.query || {};
    let { start: startStr, end: endStr } = req.query || {};

    if (!siteSlug || typeof siteSlug !== 'string') {
      return res.status(400).json({ error: '`site` (slug) is required' });
    }
    if (!mode || !['week', 'month', 'custom'].includes(mode)) {
      return res.status(400).json({ error: '`mode` must be one of: week, month, custom' });
    }

    // 1) Find site by slug
    const siteDoc = await Site.findOne({ slug: siteSlug }).lean();
    if (!siteDoc) return res.status(404).json({ error: 'Site not found' });

    // 2) Build timezone-aware start/end window EXPRESSIONS (evaluated by MongoDB)
    let startExpr, endExpr;

    if (mode === 'week' || mode === 'month') {
      // today@00:00 in Edmonton
      const todayStartInEdmonton = {
        $dateTrunc: { date: '$$NOW', unit: 'day', timezone: CANADA_TZ }
      };
      const lookbackDays = mode === 'week' ? 7 : 30;

      // IMPORTANT: add `timezone` to $dateAdd so subtracting days is DST-safe
      startExpr = {
        $dateAdd: {
          startDate: todayStartInEdmonton,
          unit: 'day',
          amount: -lookbackDays,
          timezone: CANADA_TZ
        }
      };
      endExpr = todayStartInEdmonton; // exclusive upper bound (today@00:00 Edmonton)
    } else {
      // custom: require YYYY-MM-DD for both
      if (
        !startStr || !/^\d{4}-\d{2}-\d{2}$/.test(startStr) ||
        !endStr   || !/^\d{4}-\d{2}-\d{2}$/.test(endStr)
      ) {
        return res.status(400).json({ error: '`start` and `end` (YYYY-MM-DD) are required for custom mode' });
      }

      // Clamp to ~2 months on app side (calendar-day diff; UTC math is fine here)
      const startUtcClamp = new Date(`${startStr}T00:00:00.000Z`);
      const endUtcClamp   = new Date(`${endStr}T00:00:00.000Z`);
      const diffDays = Math.floor((endUtcClamp.getTime() - startUtcClamp.getTime()) / (24 * 60 * 60 * 1000)) + 1;
      if (diffDays > MAX_CUSTOM_DAYS) {
        const clampedEnd = new Date(startUtcClamp.getTime() + (MAX_CUSTOM_DAYS - 1) * 24 * 60 * 60 * 1000);
        endStr = clampedEnd.toISOString().slice(0, 10);
      }

      const [sy, sm, sd] = startStr.split('-').map(Number);
      const [ey, em, ed] = endStr.split('-').map(Number);

      // Start is local midnight at Edmonton for start date
      startExpr = {
        $dateFromParts: {
          year: sy, month: sm, day: sd,
          hour: 0, minute: 0, second: 0, millisecond: 0,
          timezone: CANADA_TZ
        }
      };

      // End is local midnight at Edmonton for (end date + 1 day) — include `timezone` in $dateAdd
      const endBase = {
        $dateFromParts: {
          year: ey, month: em, day: ed,
          hour: 0, minute: 0, second: 0, millisecond: 0,
          timezone: CANADA_TZ
        }
      };
      endExpr = {
        $dateAdd: {
          startDate: endBase,
          unit: 'day',
          amount: 1,
          timezone: CANADA_TZ
        }
      };
    }

    // 3) Aggregation: match by site & window and exclude "awaiting_payment"
    const matchSite = { $match: { site: new mongoose.Types.ObjectId(siteDoc._id) } };

    const matchWindowAndStatus = {
      $match: {
        $expr: {
          $and: [
            { $gte: ['$createdAt', startExpr] },
            { $lt:  ['$createdAt', endExpr] },
            {
              $ne: [
                { $toLower: { $ifNull: ['$status', ''] } },
                'awaiting_payment'
              ]
            }
          ]
        }
      }
    };

    let orders;
    try {
      orders = await Order.aggregate([
        matchSite,
        matchWindowAndStatus,
        { $sort: { createdAt: -1 } }
      ]).exec();
    } catch (aggErr) {
      console.error('Aggregation timezone support error:', aggErr?.message || aggErr);
      return res.status(500).json({
        ok: false,
        error:
          'This endpoint requires MongoDB date expressions with timezone support ' +
          '($dateTrunc/$dateFromParts/$dateAdd). Please upgrade MongoDB to 5.0+.'
      });
    }

    // 4) Materialize the resolved UTC start/end to echo in the response (cheap; no collection scan)
    const windowDoc = await Order.aggregate([
      { $limit: 1 },
      { $project: { _id: 0, start: startExpr, end: endExpr } }
    ]).exec();

    const resolvedStart = windowDoc?.[0]?.start ?? null;
    const resolvedEnd   = windowDoc?.[0]?.end ?? null;

    return res.json({
      ok: true,
      site: { _id: siteDoc._id, slug: siteDoc.slug, name: siteDoc.name || siteDoc.slug },
      mode,
      tz: CANADA_TZ,
      window: { start: resolvedStart, end: resolvedEnd }, // UTC instants (Edmonton-local midnights)
      count: orders.length,
      orders: orders.map((item) => {
        const out = { ...item };

        const displayName = pickDisplayName(out);
        const displayPhone = pickDisplayPhone(out);
        const displayEmail = pickDisplayEmail(out);

        // Top-level normalized fields (what your UI already uses)
        out.phone = displayPhone || '';
        out.email = displayEmail || '';

        // Populate pickup.location.name and pickup.location.phone (only if structure exists)
        setIfPathExists(out, ['pickup', 'location', 'name'], displayName || out?.pickup?.location?.name || '');
        setIfPathExists(out, ['pickup', 'location', 'phone'], displayPhone || out?.pickup?.location?.phone || '');

        // Populate dropoff.location.name and dropoff.location.phone (only if structure exists)
        setIfPathExists(out, ['dropoff', 'location', 'name'], displayName || out?.dropoff?.location?.name || '');
        setIfPathExists(out, ['dropoff', 'location', 'phone'], displayPhone || out?.dropoff?.location?.phone || '');

        return out;
      }),
    });
  } catch (err) {
    console.error('getOrdersBySiteRange error:', err?.stack || err?.message || err);
    return res.status(500).json({ ok: false, error: 'Failed to fetch orders' });
  }
};
