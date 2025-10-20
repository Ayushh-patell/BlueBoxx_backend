// src/controllers/orders.dashboard.controller.js
import mongoose from 'mongoose';
import Site from '../models/Site.js';
import Order from '../models/Order.js'; // shared orders model (strict:false)

const CANADA_TZ = 'America/Edmonton';
const MAX_CUSTOM_DAYS = 62; // ~2 months

function isValidObjectIdString(s) {
  if (typeof s !== 'string' || s.length !== 24) return false;
  if (!mongoose.Types.ObjectId.isValid(s)) return false;
  return new mongoose.Types.ObjectId(s).toString() === s.toLowerCase();
}

// --- DST-safe bucket helpers (no fixed 24h stepping) ---
const keyFmt = new Intl.DateTimeFormat('en-CA', {
  timeZone: CANADA_TZ,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit'
});
const weekdayFmt = new Intl.DateTimeFormat('en-US', { timeZone: CANADA_TZ, weekday: 'short' });
const monthDayFmt = new Intl.DateTimeFormat('en-US', { timeZone: CANADA_TZ, month: 'short', day: '2-digit' });

function parseKey(key) {
  // key is "YYYY-MM-DD"
  const [y, m, d] = key.split('-').map(Number);
  return { y, m, d };
}
function keyToUTCNoonDate({ y, m, d }) {
  // Use UTC noon to avoid any TZ edge cases when formatting labels
  return new Date(Date.UTC(y, m - 1, d, 12, 0, 0));
}
function nextKey({ y, m, d }) {
  // Increment calendar date using UTC (DST-agnostic)
  const dt = new Date(Date.UTC(y, m - 1, d) + 86400000);
  return { y: dt.getUTCFullYear(), m: dt.getUTCMonth() + 1, d: dt.getUTCDate() };
}
function cmpKeys(a, b) {
  if (a.y !== b.y) return a.y - b.y;
  if (a.m !== b.m) return a.m - b.m;
  return a.d - b.d;
}
function keyString({ y, m, d }) {
  const mm = String(m).padStart(2, '0');
  const dd = String(d).padStart(2, '0');
  return `${y}-${mm}-${dd}`;
}
function buildDayBucketsDSTSafe(startUtc, endUtc, tz, forWeek) {
  if (!startUtc || !endUtc) return [];
  // Determine first/last included local days using Edmonton time
  const startKeyStr = keyFmt.format(startUtc);                  // local date for start boundary
  const endKeyStr = keyFmt.format(new Date(endUtc.getTime() - 1)); // local date for last included instant

  let cur = parseKey(startKeyStr);
  const end = parseKey(endKeyStr);
  const out = [];

  while (cmpKeys(cur, end) <= 0) {
    const label = forWeek
      ? weekdayFmt.format(keyToUTCNoonDate(cur))
      : monthDayFmt.format(keyToUTCNoonDate(cur));
    out.push({ key: keyString(cur), label });
    cur = nextKey(cur);
  }
  return out;
}

function customerIdExpr() {
  // prefer dropoff.phone, else userEmail
  return { $ifNull: [{ $getField: { field: 'phone', input: '$dropoff' } }, '$userEmail'] };
}

/**
 * GET /api/order/dashboard?site=<slugOrId>&mode=week|month|custom[&start=YYYY-MM-DD][&end=YYYY-MM-DD]
 * NOTE:
 * - Timezone is FIXED to America/Edmonton (DST-aware).
 * - Orders with status "awaiting_payment" are excluded (case-insensitive).
 * - Series window INCLUDES today (i.e., up to tomorrow@00:00 Edmonton).
 *
 * Returns:
 * {
 *   ok, site, mode, tz, window:{start,end},
 *   labels[], orders[], revenue[], customers[],
 *   totals: { orders, revenue, customersUnique, menuUnique }
 * }
 */
export const getDashboardSeries = async (req, res) => {
  try {
    const { site: siteParam, mode } = req.query || {};
    let { start: startStr, end: endStr } = req.query || {};

    if (!siteParam || typeof siteParam !== 'string') {
      return res.status(400).json({ error: '`site` is required (slug or ObjectId)' });
    }
    if (!mode || !['week', 'month', 'custom'].includes(mode)) {
      return res.status(400).json({ error: '`mode` must be one of: week, month, custom' });
    }

    // Resolve site
    let siteDoc = null;
    let siteId = null;
    if (isValidObjectIdString(siteParam)) {
      siteId = new mongoose.Types.ObjectId(siteParam);
      siteDoc = await Site.findById(siteId).lean();
      if (!siteDoc) return res.status(404).json({ error: 'Site not found for provided ObjectId' });
    } else {
      siteDoc = await Site.findOne({ slug: siteParam }).lean();
      if (!siteDoc) return res.status(404).json({ error: 'Site not found for provided slug' });
      siteId = siteDoc._id;
    }

    // ---- Build timezone-aware start/end as MongoDB expressions (DST-safe) ----
    // Includes today: [start, end) where end = tomorrow@00:00 Edmonton.
    let startExpr, endExpr, forWeekLabels = false;

    if (mode === 'week' || mode === 'month') {
      const todayStartInEdmonton = {
        $dateTrunc: { date: '$$NOW', unit: 'day', timezone: CANADA_TZ }
      };
      const tomorrowStartInEdmonton = {
        // IMPORTANT: timezone param so +1 day respects DST boundaries
        $dateAdd: { startDate: todayStartInEdmonton, unit: 'day', amount: 1, timezone: CANADA_TZ }
      };
      const lookbackDays = mode === 'week' ? 6 : 29; // inclusive of today => 7 or 30 total days

      startExpr = {
        $dateAdd: {
          startDate: todayStartInEdmonton,
          unit: 'day',
          amount: -lookbackDays,
          timezone: CANADA_TZ // <- DST-safe subtraction
        }
      };
      endExpr = tomorrowStartInEdmonton;
      forWeekLabels = (mode === 'week');
    } else {
      // custom
      if (!startStr || !/^\d{4}-\d{2}-\d{2}$/.test(startStr) ||
          !endStr   || !/^\d{4}-\d{2}-\d{2}$/.test(endStr)) {
        return res.status(400).json({ error: '`start` and `end` (YYYY-MM-DD) are required for custom mode' });
      }

      // Clamp to ~2 months (app-side, simple day count)
      const startUtcClamp = new Date(`${startStr}T00:00:00.000Z`);
      const endUtcClamp   = new Date(`${endStr}T00:00:00.000Z`);
      const diffDays = Math.floor((endUtcClamp - startUtcClamp) / 86400000) + 1;
      if (diffDays > MAX_CUSTOM_DAYS) {
        const clampedEnd = new Date(startUtcClamp.getTime() + (MAX_CUSTOM_DAYS - 1) * 86400000);
        endStr = clampedEnd.toISOString().slice(0, 10);
      }

      const [sy, sm, sd] = startStr.split('-').map(Number);
      const [ey, em, ed] = endStr.split('-').map(Number);

      const startBase = {
        $dateFromParts: {
          year: sy, month: sm, day: sd,
          hour: 0, minute: 0, second: 0, millisecond: 0,
          timezone: CANADA_TZ
        }
      };
      const endBase = {
        $dateFromParts: {
          year: ey, month: em, day: ed,
          hour: 0, minute: 0, second: 0, millisecond: 0,
          timezone: CANADA_TZ
        }
      };
      startExpr = startBase;
      endExpr   = {
        $dateAdd: {
          startDate: endBase,
          unit: 'day',
          amount: 1,
          timezone: CANADA_TZ // <- DST-safe addition
        }
      };
    }

    // ---- Aggregation: window match + exclude awaiting_payment; build per-day & totals ----
    const pipeline = [
      { $match: { site: siteId } },
      {
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
      },
      {
        $addFields: {
          dayKey: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt', timezone: CANADA_TZ } },
          customerId: customerIdExpr()
        }
      },
      {
        $facet: {
          perDay: [
            {
              $group: {
                _id: '$dayKey',
                orders: { $sum: 1 },
                revenueCents: { $sum: { $ifNull: ['$totalCents', 0] } },
                customersSet: { $addToSet: '$customerId' }
              }
            },
            {
              $project: {
                _id: 0,
                dayKey: '$_id',
                orders: 1,
                revenueCents: 1,
                customers: { $size: '$customersSet' }
              }
            }
          ],
          totals: [
            {
              $group: {
                _id: null,
                orders: { $sum: 1 },
                revenueCents: { $sum: { $ifNull: ['$totalCents', 0] } },
                customersAll: { $addToSet: '$customerId' },
                itemsAll: {
                  $addToSet: {
                    $cond: [
                      { $gt: [{ $size: { $ifNull: ['$items', []] } }, 0] },
                      { $map: { input: '$items', as: 'it', in: { $ifNull: ['$$it.name', ''] } } },
                      []
                    ]
                  }
                }
              }
            },
            {
              $project: {
                _id: 0,
                orders: 1,
                revenueCents: 1,
                customersUnique: { $size: '$customersAll' },
                menuUnique: {
                  $size: {
                    $setUnion: [{
                      $reduce: { input: '$itemsAll', initialValue: [], in: { $concatArrays: ['$$value', '$$this'] } }
                    }, []]
                  }
                }
              }
            }
          ],
          // Also compute the resolved UTC window once to echo in response (no data scan)
          windowEcho: [
            { $limit: 1 },
            { $project: { _id: 0, start: startExpr, end: endExpr } }
          ]
        }
      }
    ];

    let agg;
    try {
      [agg] = await Order.aggregate(pipeline).allowDiskUse(true).exec();
    } catch (aggErr) {
      console.error('Aggregation timezone support error:', aggErr?.message || aggErr);
      return res.status(500).json({
        ok: false,
        error:
          'This endpoint requires MongoDB date expressions with timezone support ' +
          '($dateTrunc/$dateFromParts/$dateAdd). Please upgrade MongoDB to 5.0+.'
      });
    }

    const perDay = agg?.perDay ?? [];
    const totalsRow = (agg?.totals && agg.totals[0]) || { orders: 0, revenueCents: 0, customersUnique: 0, menuUnique: 0 };
    const windowDoc = (agg?.windowEcho && agg.windowEcho[0]) || { start: null, end: null };
    const startUtc = windowDoc.start;
    const endUtc   = windowDoc.end;

    // Build continuous day buckets by Edmonton calendar days (DST-safe)
    const buckets = buildDayBucketsDSTSafe(startUtc, endUtc, CANADA_TZ, forWeekLabels);
    const labels = buckets.map(b => b.label);
    const dayKeys = buckets.map(b => b.key);

    // Align per-day rows to dayKeys
    const byKey = new Map(perDay.map(r => [r.dayKey, r]));
    const ordersArr = [];
    const revenueArr = [];
    const customersArr = [];
    for (const k of dayKeys) {
      const r = byKey.get(k);
      ordersArr.push(r ? r.orders : 0);
      revenueArr.push(r ? Math.round((r.revenueCents / 100) * 100) / 100 : 0);
      customersArr.push(r ? r.customers : 0);
    }

    return res.json({
      ok: true,
      site: siteDoc
        ? { _id: siteDoc._id, slug: siteDoc.slug, name: siteDoc.name || siteDoc.slug }
        : { _id: siteId, slug: null, name: null },
      mode,
      tz: CANADA_TZ,
      window: { start: startUtc, end: endUtc }, // UTC instants (Edmonton-local boundaries)
      labels,
      orders: ordersArr,
      revenue: revenueArr,
      customers: customersArr,
      totals: {
        orders: totalsRow.orders || 0,
        revenue: Math.round(((totalsRow.revenueCents || 0) / 100) * 100) / 100,
        customersUnique: totalsRow.customersUnique || 0,
        menuUnique: totalsRow.menuUnique || 0
      }
    });
  } catch (err) {
    console.error('getDashboardSeries error:', err?.stack || err?.message || err);
    return res.status(500).json({ ok: false, error: 'Failed to build dashboard series' });
  }
};
