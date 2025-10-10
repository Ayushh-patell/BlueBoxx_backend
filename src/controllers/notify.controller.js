import admin from '../config/firebase.js';
import User from '../models/User.js';

// POST /api/order/notify
// body: the new order payload (from your other Express backend)
export const notifyOrder = async (req, res) => {
  try {
    const order = req.body || {};
    const {
      site,
      status,
      fulfillmentType, // 'pickup' | 'delivery' | etc.
      totalCents,
      _id: orderId
    } = order;

    if (!site) {
      return res.status(400).json({ error: 'Missing "site" in payload' });
    }

    // find the user by site
    const user = await User.findOne({ site });
    if (!user) {
      return res.status(404).json({ error: 'User not found for this site' });
    }

    // normalize FCM tokens (array / legacy stringified JSON / object map)
    let fcmTokens = user.fcm_tokens || [];
    if (typeof fcmTokens === 'string') {
      try {
        const parsed = JSON.parse(fcmTokens);
        fcmTokens = Array.isArray(parsed) ? parsed : Object.values(parsed || {});
      } catch {
        fcmTokens = [];
      }
    } else if (!Array.isArray(fcmTokens) && typeof fcmTokens === 'object') {
      fcmTokens = Object.values(fcmTokens || {});
    }
    fcmTokens = (fcmTokens || []).filter((t) => typeof t === 'string' && t.trim());
    if (fcmTokens.length === 0) {
      return res.status(404).json({ error: 'No valid FCM tokens found' });
    }

    // build simple notification content
    const totalDollars =
      typeof totalCents === 'number' ? (totalCents / 100).toFixed(2) : '0.00';
    const orderType = fulfillmentType || 'order';
    const title = '🛒 New Order';
    const body = `${orderType === 'pickup' ? 'Pickup' : orderType} • $${totalDollars}`;

    // >>> sound requirement (for now always "order")
    const soundName = 'order';

    // multicast FCM (data-only, high priority); preserves your previous flow
    const message = {
      tokens: fcmTokens,
      data: {
        title,
        body,
        orderId: String(orderId || ''),
        fulfillmentType: String(orderType),
        totalDollars: String(totalDollars),
        status: String(status || ''),
        sound: soundName // <-- included as requested
      },
      android: { priority: 'high' },
      apns: { headers: { 'apns-priority': '10' } },
      content_available: true,
      priority: 'high'
    };

    const response = await admin.messaging().sendEachForMulticast(message);

    const failed = response.responses
      .map((r, i) => (!r.success ? { token: fcmTokens[i], error: r.error?.message } : null))
      .filter(Boolean);

    return res.status(200).json({
      message: `Notifications sent to ${response.successCount} devices.`,
      failedTokens: failed,
      outgoing: {
        title,
        body,
        fulfillmentType: orderType,
        totalDollars,
        sound: soundName
      }
    });
  } catch (err) {
    console.error('❌ notify error:', err?.message || err);
    return res.status(500).json({ error: 'Internal Server Error', details: err?.message || String(err) });
  }
};
