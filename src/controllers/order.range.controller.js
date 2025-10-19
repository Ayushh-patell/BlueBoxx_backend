// src/controllers/orders.range.controller.js
import mongoose from 'mongoose';
import Site from '../models/Site.js';
import Order from '../models/Order.js'; // shared orders model, strict:false

const CANADA_TZ = 'America/Edmonton';
const MAX_CUSTOM_DAYS = 62; // ~2 months

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
    //    For week/month we derive from "today@00:00 Edmonton" using $dateTrunc with timezone.
    //    For custom we convert provided YYYY-MM-DD into local-midnight instants with $dateFromParts.
    let startExpr, endExpr;

    if (mode === 'week' || mode === 'month') {
      const todayStartInEdmonton = {
        $dateTrunc: { date: '$$NOW', unit: 'day', timezone: CANADA_TZ }
      };
      const lookbackDays = mode === 'week' ? 7 : 30;

      startExpr = { $dateAdd: { startDate: todayStartInEdmonton, unit: 'day', amount: -lookbackDays } };
      endExpr   = todayStartInEdmonton; // exclusive upper bound (today@00:00 in Edmonton)
    } else {
      // custom: require YYYY-MM-DD for both
      if (!startStr || !/^\d{4}-\d{2}-\d{2}$/.test(startStr) ||
          !endStr   || !/^\d{4}-\d{2}-\d{2}$/.test(endStr)) {
        return res.status(400).json({ error: '`start` and `end` (YYYY-MM-DD) are required for custom mode' });
      }

      // Clamp to ~2 months on the app side (calendar-day diff, not timezone-sensitive)
      const startUtcClamp = new Date(`${startStr}T00:00:00.000Z`);
      const endUtcClamp   = new Date(`${endStr}T00:00:00.000Z`);
      const diffDays = Math.floor((endUtcClamp.getTime() - startUtcClamp.getTime()) / (24 * 60 * 60 * 1000)) + 1;
      if (diffDays > MAX_CUSTOM_DAYS) {
        // Move the end forward to comply
        const clampedEnd = new Date(startUtcClamp.getTime() + (MAX_CUSTOM_DAYS - 1) * 24 * 60 * 60 * 1000);
        endStr = clampedEnd.toISOString().slice(0, 10);
      }

      const [sy, sm, sd] = startStr.split('-').map(Number);
      const [ey, em, ed] = endStr.split('-').map(Number);

      // Start is midnight at Edmonton for start date
      startExpr = {
        $dateFromParts: {
          year: sy, month: sm, day: sd,
          hour: 0, minute: 0, second: 0, millisecond: 0,
          timezone: CANADA_TZ
        }
      };
      // End is midnight at Edmonton for (end date + 1 day)
      const endBase = {
        $dateFromParts: {
          year: ey, month: em, day: ed,
          hour: 0, minute: 0, second: 0, millisecond: 0,
          timezone: CANADA_TZ
        }
      };
      endExpr = { $dateAdd: { startDate: endBase, unit: 'day', amount: 1 } };
    }

    // 3) Aggregation: match by site & window and exclude "awaiting_payment" (case-insensitive)
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
      orders
    });
  } catch (err) {
    console.error('getOrdersBySiteRange error:', err?.stack || err?.message || err);
    return res.status(500).json({ ok: false, error: 'Failed to fetch orders' });
  }
};
