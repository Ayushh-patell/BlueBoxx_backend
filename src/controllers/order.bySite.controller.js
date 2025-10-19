// src/controllers/orders.bySite.controller.js
import mongoose from 'mongoose';
import Site from '../models/Site.js';
import Order from '../models/Order.js'; // shared orders model (strict:false)

const CANADA_TZ = 'America/Edmonton'; // ← default & only timezone
const ONE_DAY_MS = 24 * 60 * 60 * 1000;

/**
 * GET /api/order/by-site/day?site=<slug>&date=YYYY-MM-DD
 *
 * - site: site.slug (text) [required]
 * - date: calendar day (YYYY-MM-DD) [required]
 *
 * Notes:
 * - Timezone is fixed to America/Edmonton (Canada Mountain Time, DST-aware).
 * - Window is midnight→midnight in America/Edmonton, compared to UTC `createdAt`.
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
    const endExpr = {
      $dateAdd: { startDate: startExpr, unit: 'day', amount: 1 }
    };

    // 3) aggregation (match window in DB; sort newest first)
    const pipeline = [
      { $match: { site: new mongoose.Types.ObjectId(siteDoc._id) } },
      {
        $match: {
          $expr: {
            $and: [
              { $gte: ['$createdAt', startExpr] },
              { $lt:  ['$createdAt', endExpr] }
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
      // If your MongoDB cannot evaluate timezone-aware date expressions,
      // we stop here to avoid incorrect results around DST boundaries.
      console.error('Aggregation timezone support error:', aggErr?.message || aggErr);
      return res.status(500).json({
        ok: false,
        error:
          'This endpoint requires MongoDB date expressions with timezone support. ' +
          'Please ensure your MongoDB version supports $dateFromParts/$dateAdd with the `timezone` option.'
      });
    }

    // 4) Also materialize the resolved UTC start/end to echo in the response (cheap, no data scan)
    const windowDoc = await Order.aggregate([
      { $limit: 1 },
      { $project: { _id: 0, start: startExpr, end: endExpr } }
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
      window: { start: resolvedStart, end: resolvedEnd },
      count: orders.length,
      orders
    });
  } catch (err) {
    console.error('getOrdersBySiteDay error:', err?.stack || err?.message || err);
    return res.status(500).json({ ok: false, error: 'Failed to fetch orders' });
  }
};
