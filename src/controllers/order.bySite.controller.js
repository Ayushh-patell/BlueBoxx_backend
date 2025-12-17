// src/controllers/orders.bySite.controller.js
import mongoose from 'mongoose';
import Site from '../models/Site.js';
import Order from '../models/Order.js'; // shared orders model (strict:false)
import { UserDefinedMessageSubscriptionListInstance } from 'twilio/lib/rest/api/v2010/account/call/userDefinedMessageSubscription.js';

// ─────────────────────────────────────────────────────────────────────────────
// CONFIG
// ─────────────────────────────────────────────────────────────────────────────
// Default tz for backward-compatibility (Edmonton).
const DEFAULT_TZ = 'America/Edmonton';
// Max allowed extra days to avoid accidental huge scans.
const MAX_EXTRA_DAYS = 14;
// Default extra future days (your current failsafe).
const DEFAULT_EXTRA_DAYS = 7;

const ONE_DAY_MS = 24 * 60 * 60 * 1000;

// Validate IANA timezone string using Intl (no extra libs)
const isValidIana = (tz) => {
  try {
    if (typeof tz !== 'string' || !tz.includes('/')) return false;
    // Will throw if invalid IANA ID
    new Intl.DateTimeFormat('en-US', { timeZone: tz }).format(new Date(0));
    return true;
  } catch {
    return false;
  }
};

// Clamp integer safely
const clampInt = (val, min, max, fallback) => {
  const n = Number.parseInt(val, 10);
  if (Number.isNaN(n)) return fallback;
  return Math.min(Math.max(n, min), max);
};

// ─────────────────────────────────────────────────────────────────────────────
// HELPERS (backward compatible fallbacks)
// ─────────────────────────────────────────────────────────────────────────────
const pickDisplayName = (item) => {
  // New desired precedence:
  // 1) customerName
  // 2) guestName
  // Backward-compatible fallbacks (if they ever existed in older data):
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
  // Backward-compatible fallbacks (your existing list + common legacy fields)
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
  // Keep userEmail (as you mentioned), plus backward-compatible fallbacks
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
  // path like: ['pickup','location','name']
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
 * GET /api/order/by-site/day?site=<slug>&date=YYYY-MM-DD&tz=<IANA>&extraDays=<int>
 *
 * - site: site.slug (text) [required]
 * - date: calendar day (YYYY-MM-DD) [required]
 * - tz:   IANA time zone (e.g., "America/Edmonton", "Asia/Kolkata") [optional → defaults to DEFAULT_TZ]
 * - extraDays: extend window by N future days (failsafe; 0..14) [optional → defaults to 7]
 *
 * Behavior:
 * - Builds start/end for the requested DATE at local midnight in the provided IANA TZ (DST-safe).
 * - Matches orders in [start, start + (1 + extraDays) days) — so current day + N future days.
 * - Response.window shows ONLY the single-day window for compatibility (unchanged contract).
 * - Returns the tz actually used (validated/fallback).
 *
 * Returns: { ok, site:{_id,slug,name}, date, tz, window:{start,end}, count, orders[] }
 *
 * Index hint (recommended):
 *   db.orders.createIndex({ site: 1, createdAt: -1 })
 */
export const getOrdersBySiteDay = async (req, res) => {
  try {
    const { site: siteSlug, date, tz, extraDays } = req.query || {};

    // 0) Validate basic params
    if (!siteSlug || typeof siteSlug !== 'string') {
      return res.status(400).json({ ok: false, error: '`site` (slug) is required' });
    }
    if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return res.status(400).json({ ok: false, error: '`date` must be YYYY-MM-DD' });
    }

    // 1) Resolve the site (kept same as your code)
    const siteDoc = await Site.findOne({ slug: siteSlug }).lean();
    if (!siteDoc) return res.status(404).json({ ok: false, error: 'Site not found' });

    // 2) Pick the timezone to use:
    //    - prefer client tz if valid IANA
    //    - else fallback to DEFAULT_TZ (Edmonton) for backward compatibility
    const usedTz = isValidIana(tz) ? tz : DEFAULT_TZ;

    // 3) Determine extra future days failsafe (0..14; default 7)
    const FUTURE_DAYS = clampInt(extraDays, 0, MAX_EXTRA_DAYS, DEFAULT_EXTRA_DAYS);

    // 4) Build timezone-aware start/end expressions (DST-safe via Mongo's timezone support)
    const [y, m, d] = date.split('-').map(Number);

    // Midnight at <usedTz> for the given calendar date, as a UTC instant
    const startExpr = {
      $dateFromParts: {
        year: y,
        month: m,
        day: d,
        hour: 0,
        minute: 0,
        second: 0,
        millisecond: 0,
        timezone: usedTz,
      },
    };

    // Single-day end (for response.window only)
    const endDayExpr = {
      $dateAdd: { startDate: startExpr, unit: 'day', amount: 1, timezone: usedTz },
    };

    // Extended end: include the next N days after the requested day
    const endExtendedExpr = {
      $dateAdd: { startDate: startExpr, unit: 'day', amount: 1 + FUTURE_DAYS, timezone: usedTz },
    };

    // 5) Aggregation pipeline (match EXTENDED window; newest first)
    const pipeline = [
      { $match: { site: new mongoose.Types.ObjectId(siteDoc._id) } },
      {
        $match: {
          $expr: {
            $and: [
              { $gte: ['$createdAt', startExpr] },
              { $lt:  ['$createdAt', endExtendedExpr] },
            ],
          },
        },
      },
      { $sort: { createdAt: -1 } },
    ];

    let orders;
    try {
      orders = await Order.aggregate(pipeline).exec();
    } catch (aggErr) {
      console.error('Aggregation timezone support error:', aggErr?.message || aggErr);
      return res.status(500).json({
        ok: false,
        error:
          'Timezone-aware date expressions require MongoDB 5.0+ with `timezone` option on $dateFromParts/$dateAdd.',
      });
    }

    // 6) Materialize the (single-day) window we expose in the response (cheap projection)
    const windowDoc = await Order.aggregate([
      { $limit: 1 },
      { $project: { _id: 0, start: startExpr, end: endDayExpr } },
    ]).exec();

    const resolvedStart = windowDoc?.[0]?.start ?? new Date(`${date}T00:00:00.000Z`);
    const resolvedEnd =
      windowDoc?.[0]?.end ?? new Date(resolvedStart.getTime() + ONE_DAY_MS);

    // 7) Respond (keep original contract, but ensure correct name/phone/email everywhere)
    return res.json({
      ok: true,
      site: { _id: siteDoc._id, slug: siteDoc.slug, name: siteDoc.name || siteDoc.slug },
      date,
      tz: usedTz, // echo the tz actually used (validated or fallback)
      window: { start: resolvedStart, end: resolvedEnd }, // single-day window for UI compatibility
      count: orders.length,
      orders: orders.map((item) => {
        // Work on a shallow clone so we don't mutate aggregation result objects unexpectedly
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
    console.error('getOrdersBySiteDay error:', err?.stack || err?.message || err);
    return res.status(500).json({ ok: false, error: 'Failed to fetch orders' });
  }
};
