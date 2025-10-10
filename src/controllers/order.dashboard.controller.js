// src/controllers/orders.dashboard.controller.js
import mongoose from 'mongoose';
import Site from '../models/Site.js';
import Order from '../models/Order.js'; // shared orders model (strict:false)

function isValidObjectIdString(s) {
  if (typeof s !== 'string' || s.length !== 24) return false;
  if (!mongoose.Types.ObjectId.isValid(s)) return false;
  return new mongoose.Types.ObjectId(s).toString() === s.toLowerCase();
}
function startOfTodayUtcInTz(tz = 'UTC') {
  const now = new Date();
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit'
  }).formatToParts(now);
  const y = parts.find(p => p.type === 'year')?.value;
  const m = parts.find(p => p.type === 'month')?.value;
  const d = parts.find(p => p.type === 'day')?.value;
  return new Date(`${y}-${m}-${d}T00:00:00.000Z`);
}
function addDays(d, n) { return new Date(d.getTime() + n * 24 * 60 * 60 * 1000); }
function fmtDayLabel(date, tz) { return new Intl.DateTimeFormat('en-US', { timeZone: tz, weekday: 'short' }).format(date); }
function fmtDayLabelShort(date, tz) { return new Intl.DateTimeFormat('en-US', { timeZone: tz, month: 'short', day: '2-digit' }).format(date); }
function buildDayBuckets(startUtc, endUtc, tz, forWeek) {
  const out = [];
  for (let t = new Date(startUtc); t < endUtc; t = addDays(t, 1)) {
    const key = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year:'numeric', month:'2-digit', day:'2-digit' }).format(t);
    const label = forWeek ? fmtDayLabel(t, tz) : fmtDayLabelShort(t, tz);
    out.push({ key, label, date: new Date(t) });
  }
  return out;
}
function customerIdExpr() {
  // prefer dropoff.phone, else userEmail
  return { $ifNull: [ { $getField: { field: 'phone', input: '$dropoff' } }, '$userEmail' ] };
}

/**
 * GET /api/order/dashboard?site=<slugOrId>&mode=week|month|custom[&tz=Area/City][&start=YYYY-MM-DD][&end=YYYY-MM-DD]
 * NOTE: Orders with status "awaiting_payment" are excluded.
 * Returns:
 * {
 *   ok, site, mode, tz, window:{start,end},
 *   labels[], orders[], revenue[], customers[],
 *   totals: {
 *     orders: number,
 *     revenue: number,             // dollars
 *     customersUnique: number,     // unique by phone/email across the whole window
 *     menuUnique: number           // unique items across the whole window (by items.name)
 *   }
 * }
 */
export const getDashboardSeries = async (req, res) => {
  try {
    const { site: siteParam, mode, tz } = req.query || {};
    let { start: startStr, end: endStr } = req.query || {};
    const zone = typeof tz === 'string' && tz.length ? tz : 'UTC';

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
    } else {
      siteDoc = await Site.findOne({ slug: siteParam }).lean();
      if (!siteDoc) return res.status(404).json({ error: 'Site not found for provided slug' });
      siteId = siteDoc._id;
    }

    // Window (INCLUDES today)
    const todayStartUtc = startOfTodayUtcInTz(zone);
    let startUtc, endUtc, forWeekLabels = false;
    if (mode === 'week') {
      startUtc = addDays(todayStartUtc, -6);
      endUtc = addDays(todayStartUtc, 1);
      forWeekLabels = true;
    } else if (mode === 'month') {
      startUtc = addDays(todayStartUtc, -29);
      endUtc = addDays(todayStartUtc, 1);
    } else {
      if (!startStr || !/^\d{4}-\d{2}-\d{2}$/.test(startStr) || !endStr || !/^\d{4}-\d{2}-\d{2}$/.test(endStr)) {
        return res.status(400).json({ error: '`start` and `end` (YYYY-MM-DD) are required for custom mode' });
      }
      // build local SOD for both, convert to [start, end+1d)
      const mkSod = (dStr) => {
        const probe = new Date(`${dStr}T12:00:00Z`);
        const p = new Intl.DateTimeFormat('en-CA', { timeZone: zone, year:'numeric', month:'2-digit', day:'2-digit' }).formatToParts(probe);
        const y = p.find(x => x.type === 'year')?.value;
        const m = p.find(x => x.type === 'month')?.value;
        const d = p.find(x => x.type === 'day')?.value;
        return new Date(`${y}-${m}-${d}T00:00:00.000Z`);
      };
      startUtc = mkSod(startStr);
      endUtc = addDays(mkSod(endStr), 1);
      // clamp to 62 days
      const maxMs = 62 * 86400000;
      if (endUtc.getTime() - startUtc.getTime() > maxMs) {
        endUtc = new Date(startUtc.getTime() + maxMs);
      }
    }

    // Day buckets & keys
    const buckets = buildDayBuckets(startUtc, endUtc, zone, forWeekLabels);
    const labels = buckets.map(b => b.label);
    const dayKeys = buckets.map(b => b.key);

    // Aggregation: per-day series + overall totals (unique customers & unique items)
    const pipeline = [
      // basic window + site match
      { $match: { site: siteId, createdAt: { $gte: startUtc, $lt: endUtc } } },

      // compute dayKey / customerId / statusLower (for filtering)
      {
        $addFields: {
          dayKey: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt', timezone: zone } },
          customerId: customerIdExpr(),
          statusLower: { $toLower: { $ifNull: ['$status', ''] } }
        }
      },

      // EXCLUDE awaiting_payment
      { $match: { statusLower: { $ne: 'awaiting_payment' } } },

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
                // unique menu items across window — use items.name (fallback safe)
                itemsAll: {
                  $addToSet: {
                    $cond: [
                      { $gt: [{ $size: { $ifNull: ['$items', []] } }, 0] },
                      { $map: { input: '$items', as: 'it', in: { $ifNull: ['$$it.name', ''] } } },
                      [] // empty
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
                // itemsAll is an array-of-arrays — flatten and unique
                menuUnique: {
                  $size: {
                    $setUnion: [{
                      $reduce: {
                        input: '$itemsAll',
                        initialValue: [],
                        in: { $concatArrays: ['$$value', '$$this'] }
                      }
                    }, []]
                  }
                }
              }
            }
          ]
        }
      }
    ];

    const [agg] = await Order.aggregate(pipeline).allowDiskUse(true).exec();
    const perDay = agg?.perDay ?? [];
    const totalsRow = (agg?.totals && agg.totals[0]) || { orders: 0, revenueCents: 0, customersUnique: 0, menuUnique: 0 };

    // Map per-day to aligned arrays
    const byKey = new Map(perDay.map(r => [r.dayKey, r]));
    const orders = [];
    const revenue = [];
    const customers = [];
    for (const k of dayKeys) {
      const r = byKey.get(k);
      orders.push(r ? r.orders : 0);
      revenue.push(r ? Math.round((r.revenueCents / 100) * 100) / 100 : 0);
      customers.push(r ? r.customers : 0);
    }

    return res.json({
      ok: true,
      site: siteDoc
        ? { _id: siteDoc._id, slug: siteDoc.slug, name: siteDoc.name || siteDoc.slug }
        : { _id: siteId, slug: null, name: null },
      mode,
      tz: zone,
      window: { start: startUtc, end: endUtc },
      labels,
      orders,
      revenue,
      customers,
      totals: {
        orders: totalsRow.orders || 0,
        revenue: Math.round((totalsRow.revenueCents || 0) / 100 * 100) / 100,
        customersUnique: totalsRow.customersUnique || 0,
        menuUnique: totalsRow.menuUnique || 0
      }
    });
  } catch (err) {
    console.error('getDashboardSeries error:', err?.stack || err?.message || err);
    return res.status(500).json({ ok: false, error: 'Failed to build dashboard series' });
  }
};
