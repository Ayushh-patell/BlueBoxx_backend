// src/controllers/orders.print.controller.js
import mongoose from 'mongoose';
import Site from '../models/Site.js';
import Order from '../models/Order.js'; // shared orders model (strict:false)

// -----------------------------
// helpers (same spirit as your by-site controller)
// -----------------------------
const pickDisplayName = (item) =>
  item?.customerName ||
  item?.guestName ||
  item?.userName ||
  item?.name ||
  item?.customer ||
  '';

const pickDisplayPhone = (item) =>
  item?.customerNumber ||
  item?.guestNumber ||
  item?.customerPhone ||
  item?.userPhone ||
  item?.userNumber ||
  item?.userContact ||
  item?.phone ||
  item?.mobile ||
  '';

const pickDisplayEmail = (item) =>
  item?.userEmail ||
  item?.customerEmail ||
  item?.guestEmail ||
  item?.email ||
  '';

const setIfPathExists = (obj, path, value) => {
  let cur = obj;
  for (let i = 0; i < path.length - 1; i++) {
    if (!cur || typeof cur !== 'object') return obj;
    cur = cur[path[i]];
  }
  if (cur && typeof cur === 'object') cur[path[path.length - 1]] = value;
  return obj;
};

const moneyFromCents = (cents) => {
  const n = Number(cents);
  if (!Number.isFinite(n)) return '$0.00';
  return `$${(n / 100).toFixed(2)}`;
};

const normalizeFulfillmentType = (order) => {
  const ft = (order?.fulfillmentType || '').toLowerCase();
  if (ft === 'pickup' || ft === 'delivery') return ft;
  // fallback guess if missing
  const hasDropoff =
    Array.isArray(order?.dropoff?.address?.streetAddress) &&
    order.dropoff.address.streetAddress.length > 0;
  return hasDropoff ? 'delivery' : 'pickup';
};

const normalizePaymentMethod = (order) => {
  const pm = order?.meta?.paymentMethod || order?.paymentMethod || '';
  // keep raw value but also provide a normalized label for printing/UI
  const v = String(pm || '').toLowerCase();
  if (v === 'pay_at_store') return 'pay_at_store';
  if (v) return v; // e.g. "online"
  return '';
};

const normalizeOrderForPrint = (orderDoc, siteDoc) => {
  const displayName = pickDisplayName(orderDoc);
  const displayPhone = pickDisplayPhone(orderDoc);
  const displayEmail = pickDisplayEmail(orderDoc);

  const out = { ...orderDoc };

  // align with your UI props / what you said you need
  out.customerName = displayName || out.customerName || '';
  out.phone = displayPhone || '';
  out.email = displayEmail || '';

  // normalize note + payment + fulfillment
  out.note = (out.notes || out.note || '').trim();
  out.paymentMethod = normalizePaymentMethod(out);
  out.fulfillmentType = normalizeFulfillmentType(out);

  // status tweak you already do
  if ((out.status || '').toLowerCase() === 'confirmed') out.status = 'paid';

  // make pickup/dropoff names/phones consistent if paths exist
  setIfPathExists(out, ['pickup', 'location', 'name'], displayName || out?.pickup?.location?.name || '');
  setIfPathExists(out, ['pickup', 'location', 'phone'], displayPhone || out?.pickup?.location?.phone || '');
  setIfPathExists(out, ['dropoff', 'location', 'name'], displayName || out?.dropoff?.location?.name || '');
  setIfPathExists(out, ['dropoff', 'location', 'phone'], displayPhone || out?.dropoff?.location?.phone || '');

  // totals (add formatted strings so printer code doesn’t repeat it)
  out.totalAmount = moneyFromCents(out.totalCents ?? 0);
  out.taxAmount = moneyFromCents(out.taxCents ?? 0);
  out.tipAmount = moneyFromCents(out.tipCents ?? 0);
  out.deliveryFeeAmount = moneyFromCents(out.deliveryFeeCents ?? 0);

  // include site summary (handy for printing headers)
  out.site = siteDoc
    ? { _id: siteDoc._id, slug: siteDoc.slug, name: siteDoc.name || siteDoc.slug }
    : null;

  // ensure items always an array
  out.items = Array.isArray(out.items) ? out.items : [];

  // normalize item quantities (keep originals too)
  out.items = out.items.map((it) => ({
    ...it,
    quantity: it?.quantity ?? it?.qty ?? 1,
    selectedOptions: Array.isArray(it?.selectedOptions) ? it.selectedOptions : [],
    comboUnits: Array.isArray(it?.comboUnits) ? it.comboUnits : [],
  }));

  return out;
};

/**
 * GET /api/order/:orderId/print
 * - orderId can be Mongo ObjectId (_id) OR an orderNumber like "BB-1146"
 *
 * Returns:
 * { ok: true, order: { ...normalizedOrder } }
 */
export const getOrderForPrint = async (req, res) => {
  try {
    const { orderId } = req.params || {};
    if (!orderId) return res.status(400).json({ ok: false, error: '`orderId` is required' });

    const query = mongoose.isValidObjectId(orderId)
      ? { _id: new mongoose.Types.ObjectId(orderId) }
      : { orderNumber: String(orderId) };

    const orderDoc = await Order.findOne(query).lean();
    if (!orderDoc) return res.status(404).json({ ok: false, error: 'Order not found' });

    const siteDoc = orderDoc?.site ? await Site.findById(orderDoc.site).lean() : null;

    const order = normalizeOrderForPrint(orderDoc, siteDoc);
    return res.json({ ok: true, order });
  } catch (err) {
    console.error('getOrderForPrint error:', err?.stack || err?.message || err);
    return res.status(500).json({ ok: false, error: 'Failed to fetch order for print' });
  }
};
