// src/controllers/orders.bySite.controller.js
import mongoose from 'mongoose';
import Site from '../models/Site.js';
import Order from '../models/Order.js'; // shared orders model (strict:false)

const CANADA_TZ = 'America/Edmonton'; // MST/MDT (DST-aware)
const ONE_DAY_MS = 24 * 60 * 60 * 1000;
const FUTURE_DAYS = 7; // extend by 1 week beyond the requested day (internal only)

/**
 * GET /api/order/by-site/day?site=<slug>&date=YYYY-MM-DD
 *
 * - site: site.slug (text) [required]
 * - date: calendar day (YYYY-MM-DD) [required]
 *
 * Notes:
 * - Timezone is fixed to America/Edmonton (Canada Mountain Time, DST-aware).
 * - The response remains unchanged and shows the original single-day window.
 * - Internally, we extend the query window by +7 days to also fetch future orders.
 *
 * Returns: { ok, site:{_id,slug,name}, date, tz, window:{start,end}, count, orders[] }
 */
export const getOrdersBySiteDay = async (req, res) => {
  try {
    const { site: siteSlug, date } = req.query || {};

    if (!siteSlug || typeof siteSlug !== 'string') {
      return res.status(400).json({ error: '`site` (slug) is required' });
    }
    if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return res.status(400).json({ error: '`date` must be YYYY-MM-DD' });
    }

    // 1) find site by slug
    const siteDoc = await Site.findOne({ slug: siteSlug }).lean();
    if (!siteDoc) return res.status(404).json({ error: 'Site not found' });

    // 2) Build timezone-aware start/end in MongoDB (DST-safe)
    const [y, m, d] = date.split('-').map(Number);

    // Midnight at America/Edmonton for the given calendar date, as a UTC instant
    const startExpr = {
      $dateFromParts: {
        year: y,
        month: m,
        day: d,
        hour: 0,
        minute: 0,
        second: 0,
        millisecond: 0,
        timezone: CANADA_TZ
      }
    };

    // Original single-day end (midnight next day), DST-aware — used for response.window only
    const endDayExpr = {
      $dateAdd: { startDate: startExpr, unit: 'day', amount: 1, timezone: CANADA_TZ }
    };

    // Extended end: include the next 1 week (7 days) after the requested day
    const endExtendedExpr = {
      $dateAdd: { startDate: startExpr, unit: 'day', amount: 1 + FUTURE_DAYS, timezone: CANADA_TZ }
    };

    // 3) aggregation (match EXTENDED window in DB; sort newest first)
    // NOTE: Response.window still shows the SINGLE-DAY window for compatibility.
    const pipeline = [
      { $match: { site: new mongoose.Types.ObjectId(siteDoc._id) } },
      {
        $match: {
          $expr: {
            $and: [
              { $gte: ['$createdAt', startExpr] },
              { $lt:  ['$createdAt', endExtendedExpr] }
            ]
          }
        }
      },
      { $sort: { createdAt: -1 } }
    ];

    let orders;
    try {
      orders = await Order.aggregate(pipeline).exec();
    } catch (aggErr) {
      // If MongoDB cannot evaluate timezone-aware date expressions,
      // stop here to avoid incorrect results around DST boundaries.
      console.error('Aggregation timezone support error:', aggErr?.message || aggErr);
      return res.status(500).json({
        ok: false,
        error:
          'This endpoint requires MongoDB date expressions with timezone support. ' +
          'Ensure your MongoDB version supports $dateFromParts and $dateAdd with the `timezone` option (MongoDB 5.0+).'
      });
    }

    // 4) Materialize the (single-day) window we expose in the response (no data scan)
    const windowDoc = await Order.aggregate([
      { $limit: 1 },
      { $project: { _id: 0, start: startExpr, end: endDayExpr } }
    ]).exec();

    const resolvedStart =
      windowDoc?.[0]?.start ?? new Date(`${date}T00:00:00.000Z`);
    const resolvedEnd =
      windowDoc?.[0]?.end ?? new Date(resolvedStart.getTime() + ONE_DAY_MS);

    return res.json({
      ok: true,
      site: { _id: siteDoc._id, slug: siteDoc.slug, name: siteDoc.name || siteDoc.slug },
      date,
      tz: CANADA_TZ,
      // Keep response window as the original single-day bounds for compatibility:
      window: { start: resolvedStart, end: resolvedEnd },
      count: orders.length,
      orders // includes current-day + next 7 days in the same list
    });
  } catch (err) {
    console.error('getOrdersBySiteDay error:', err?.stack || err?.message || err);
    return res.status(500).json({ ok: false, error: 'Failed to fetch orders' });
  }
};
