// src/api/stripeWebhook.js
import Stripe from 'stripe';
import Order from '../models/Order.js';
import { sendOrderNotification } from '../controllers/notify.controller.js';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, {
  apiVersion: '2020-08-27'
});

/**
 * POST /api/stripe/webhook
 * This route MUST use express.raw({ type: 'application/json' }) in app.jsx
 */
export const stripeWebhook = async (req, res) => {
  const sig = req.headers['stripe-signature'];
  const endpointSecret = process.env.STRIPE_WEBHOOK_SECRET;

  let event;

  try {
    // req.body is a Buffer because we use express.raw() for this route
    event = stripe.webhooks.constructEvent(req.body, sig, endpointSecret);
  } catch (err) {
    console.error('❌ Stripe webhook signature verification failed:', err?.message || err);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  try {
    if (event.type === 'checkout.session.completed') {
      const session = event.data.object;

      const metadata = session.metadata || {};
      const paymentStatus = session.payment_status; // e.g. "paid"
      const orderId = metadata.orderId;

      if (!orderId) {
        console.error('❌ Missing orderId in checkout.session.metadata');
        return res.status(400).json({ error: 'Missing orderId in session.metadata' });
      }

      console.log(
        `✅ checkout.session.completed for order ${orderId}, payment_status=${paymentStatus}`
      );

      // Update Order.status with payment_status
      const update = {
        status: paymentStatus,
        // 'meta.paymentStatus': paymentStatus,
        // 'meta.stripe': {
        //   ...(metadata || {}),
        //   checkoutSessionId: session.id,
        //   paymentStatus,
        //   eventId: event.id,
        //   eventType: event.type
        // }
      };

      const updatedOrder = await Order.findByIdAndUpdate(orderId, update, {
        new: true
      });

      if (!updatedOrder) {
        console.error(`❌ Order not found for id=${orderId}`);
        return res.status(404).json({ error: 'Order not found' });
      }

      console.log('✅ Order updated from Stripe webhook:', {
        id: updatedOrder._id,
        status: updatedOrder.status,
        paymentStatus: updatedOrder.meta?.paymentStatus
      });

      // 🔔 ALSO send FCM notification using the same logic as /api/order/notify
      try {
        const notifyResult = await sendOrderNotification(updatedOrder);
        console.log('✅ FCM notify result from webhook:', notifyResult);
      } catch (notifyErr) {
        // Don’t fail the Stripe webhook if notification fails; just log it.
        console.error('❌ Failed to send FCM notification from webhook:', notifyErr);
      }
    } else {
      console.log(`ℹ️ Received unhandled Stripe event type: ${event.type}`);
    }

    // Always return 2xx if the event itself was processed, so Stripe doesn't keep retrying.
    return res.status(200).json({ received: true });
  } catch (err) {
    console.error('❌ Error handling Stripe webhook:', err?.message || err);
    return res.status(500).json({
      error: 'Internal Server Error while handling Stripe webhook',
      details: err?.message || String(err)
    });
  }
};
