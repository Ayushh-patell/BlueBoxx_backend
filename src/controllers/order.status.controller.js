// src/controllers/orderController.js
import mongoose from 'mongoose';
import Order from '../models/Order.js'; // your existing Order model (strict:false)

// Allowed statuses (union of your buckets + a few synonyms already used elsewhere)
const ALLOWED_STATUSES = new Set([
  'new', 'created', 'awaiting_payment',
  'processing', 'accepted', 'preparing', 'prepared',
  'fulfilled', 'dispatched', 'complete', 'completed',
]);

export async function updateOrderStatus(req, res) {
  try {
    
    const { id } = req.params;
    const { status } = req.body || {};

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ ok: false, message: 'Invalid order id' });
    }
    if (typeof status !== 'string' || !status.trim()) {
      return res.status(400).json({ ok: false, message: 'Missing status' });
    }

    const nextStatus = status.trim().toLowerCase();
    if (!ALLOWED_STATUSES.has(nextStatus)) {
      return res.status(400).json({
        ok: false,
        message: 'Invalid status',
        allowed: Array.from(ALLOWED_STATUSES),
      });
    }

    // Fetch order
    const order = await Order.findById(id);
    if (!order) {
      return res.status(404).json({ ok: false, message: 'Order not found' });
    }

    const prevStatus = (order.status || '').toLowerCase();

    // Optional: append to status history (since strict:false, it's safe)
    const now = new Date();
    const actor = req.user?.username || 'system';
    const entry = { at: now, from: prevStatus || null, to: nextStatus, by: actor };

    // ensure meta.statusHistory exists
    if (!order.meta || typeof order.meta !== 'object') order.meta = {};
    if (!Array.isArray(order.meta.statusHistory)) order.meta.statusHistory = [];
    order.meta.statusHistory.push(entry);

    order.status = nextStatus;
    order.updatedAt = now;

    await order.save();

    return res.json({
      ok: true,
      order,
      previous: prevStatus || null,
      current: nextStatus,
    });
  } catch (err) {
    console.error('updateOrderStatus error:', err);
    return res.status(500).json({ ok: false, message: 'Server error' });
  }
}
