// src/controllers/email.controller.js
import nodemailer from 'nodemailer';

function ensureEnv(keys) {
  const missing = keys.filter((k) => !process.env[k]);
  if (missing.length) throw new Error(`Missing required env: ${missing.join(', ')}`);
}

function maskEmail(email) {
  try {
    const [local, domain] = String(email).split('@');
    if (!local || !domain) return '***@***';
    if (local.length <= 2) return `${local[0] || '*'}***@${domain}`;
    return `${local[0]}***${local[local.length - 1]}@${domain}`;
  } catch {
    return '***@***';
  }
}

function escapeHtml(s) {
  if (typeof s !== 'string') return '';
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function isEmail(s) {
  return typeof s === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s);
}

/**
 * POST /api/order/accepted-email
 * body: {
 *   email: string (customer email)  [required]
 *   restaurantName: string          [required]
 *   customerName?: string           [optional]
 *   orderId?: string                [optional]
 * }
 */
export const sendOrderAcceptedEmail = async (req, res) => {
  try {
    ensureEnv(['SMTP_HOST', 'SMTP_PORT', 'SMTP_USER', 'SMTP_PASS', 'SMTP_FROM']);

    const { email, restaurantName, customerName, orderId } = req.body || {};

    if (!isEmail(email)) {
      return res.status(400).json({ error: 'Valid customer email is required (email)' });
    }
    if (typeof restaurantName !== 'string' || restaurantName.trim().length === 0) {
      return res.status(400).json({ error: 'restaurantName is required' });
    }

    const safeRestaurant = escapeHtml(restaurantName.trim());
    const safeCustomer = escapeHtml((customerName || '').trim());
    const safeOrderId = escapeHtml((orderId || '').trim());

    const transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: Number(process.env.SMTP_PORT),
      secure: Number(process.env.SMTP_PORT) === 465,
      auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }
    });

    const subject = `Your order has been accepted by ${restaurantName}`;

    const textLines = [
      safeCustomer ? `Hi ${customerName},` : 'Hi,',
      '',
      `Good news! ${restaurantName} has accepted your order.`,
      safeOrderId ? `Order ID: ${orderId}` : '',
      '',
      'We’ll let you know once it’s on its way!',
      '',
      `— ${restaurantName}`
    ].filter(Boolean);
    const text = textLines.join('\n');

    const html = `
<!doctype html>
<html>
<head>
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <meta http-equiv="Content-Type" content="text/html; charset=UTF-8" />
  <title>Order Accepted</title>
</head>
<body style="margin:0;padding:24px;background:#f6f7f9;font-family:system-ui,-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial,sans-serif;color:#111;">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:640px;margin:0 auto;background:#fff;border:1px solid #e5e7eb;border-radius:14px;overflow:hidden;">
    <tr>
      <td style="padding:0;">
        <div style="background:linear-gradient(135deg,#111827,#1f2937);padding:20px 24px;color:#fff;">
          <h1 style="margin:0;font-size:20px;line-height:1.3;">Order accepted</h1>
          <p style="margin:6px 0 0;font-size:13px;opacity:.9;">${safeRestaurant}</p>
        </div>
        <div style="padding:24px;">
          <p style="margin:0 0 12px;font-size:16px;">
            ${safeCustomer ? `Hi <strong>${safeCustomer}</strong>,` : 'Hi,'}
          </p>
          <p style="margin:0 0 16px;color:#374151;font-size:15px;line-height:1.6;">
            Good news! <strong>${safeRestaurant}</strong> has <strong>accepted</strong> your order.
          </p>
          ${
            safeOrderId
              ? `<div style="margin:18px 0;padding:14px 16px;border:1px solid #e5e7eb;border-radius:12px;background:#fafafa;">
                   <div style="font-size:12px;color:#6b7280;margin-bottom:6px;">Order ID</div>
                   <div style="font-size:16px;font-weight:600;letter-spacing:.3px;">${safeOrderId}</div>
                 </div>`
              : ''
          }
          <p style="margin:16px 0 0;color:#4b5563;font-size:14px;line-height:1.6;">
            We’ll notify you once your order is on its way.
          </p>
          <p style="margin:22px 0 0;color:#6b7280;font-size:13px;">— ${safeRestaurant}</p>
        </div>
        <div style="padding:14px 24px;border-top:1px solid #e5e7eb;background:#fcfcfd;color:#6b7280;font-size:12px;">
          You’re receiving this because you recently placed an order with ${safeRestaurant}.
        </div>
      </td>
    </tr>
  </table>
</body>
</html>
`.trim();

    const info = await transporter.sendMail({
      from: process.env.SMTP_FROM || process.env.SMTP_USER,
      to: email,
      subject,
      text,
      html
    });

    return res.json({
      message: 'Order-accepted email sent',
      to: maskEmail(email),
      messageId: info?.messageId || null,
      accepted: info?.accepted || [],
      rejected: info?.rejected || []
    });
  } catch (err) {
    console.error('order accepted email error:', err?.stack || err?.message || err);
    return res.status(500).json({ error: 'Something went wrong sending the email' });
  }
};





/**
 * POST /api/order/prepared-email
 * body: {
 *   email: string (customer email)  [required]
 *   restaurantName: string          [required]
 *   customerName?: string           [optional]
 *   orderId?: string                [optional]
 * }
 */
export const sendOrderPreparedEmail = async (req, res) => {
  try {
    ensureEnv(['SMTP_HOST', 'SMTP_PORT', 'SMTP_USER', 'SMTP_PASS', 'SMTP_FROM']);

    const { email, restaurantName, customerName, orderId } = req.body || {};

    if (!isEmail(email)) {
      return res.status(400).json({ error: 'Valid customer email is required (email)' });
    }
    if (typeof restaurantName !== 'string' || restaurantName.trim().length === 0) {
      return res.status(400).json({ error: 'restaurantName is required' });
    }

    const safeRestaurant = escapeHtml(restaurantName.trim());
    const safeCustomer = escapeHtml((customerName || '').trim());
    const safeOrderId = escapeHtml((orderId || '').trim());

    const transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: Number(process.env.SMTP_PORT),
      secure: Number(process.env.SMTP_PORT) === 465,
      auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }
    });

    const subject = `Your order has been prepared by ${restaurantName}`;

    const textLines = [
      safeCustomer ? `Hi ${customerName},` : 'Hi,',
      '',
      `Good news! ${restaurantName} has prepared your order.`,
      safeOrderId ? `Order ID: ${orderId}` : '',
      '',
      'We’ll let you know once it’s on its way!',
      '',
      `— ${restaurantName}`
    ].filter(Boolean);
    const text = textLines.join('\n');

    const html = `
<!doctype html>
<html>
<head>
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <meta http-equiv="Content-Type" content="text/html; charset=UTF-8" />
  <title>Order Prepared</title>
</head>
<body style="margin:0;padding:24px;background:#f6f7f9;font-family:system-ui,-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial,sans-serif;color:#111;">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:640px;margin:0 auto;background:#fff;border:1px solid #e5e7eb;border-radius:14px;overflow:hidden;">
    <tr>
      <td style="padding:0;">
        <div style="background:linear-gradient(135deg,#111827,#1f2937);padding:20px 24px;color:#fff;">
          <h1 style="margin:0;font-size:20px;line-height:1.3;">Order prepared</h1>
          <p style="margin:6px 0 0;font-size:13px;opacity:.9;">${safeRestaurant}</p>
        </div>
        <div style="padding:24px;">
          <p style="margin:0 0 12px;font-size:16px;">
            ${safeCustomer ? `Hi <strong>${safeCustomer}</strong>,` : 'Hi,'}
          </p>
          <p style="margin:0 0 16px;color:#374151;font-size:15px;line-height:1.6;">
            Good news! <strong>${safeRestaurant}</strong> has <strong>prepared</strong> your order.
          </p>
          ${
            safeOrderId
              ? `<div style="margin:18px 0;padding:14px 16px;border:1px solid #e5e7eb;border-radius:12px;background:#fafafa;">
                   <div style="font-size:12px;color:#6b7280;margin-bottom:6px;">Order ID</div>
                   <div style="font-size:16px;font-weight:600;letter-spacing:.3px;">${safeOrderId}</div>
                 </div>`
              : ''
          }
          <p style="margin:16px 0 0;color:#4b5563;font-size:14px;line-height:1.6;">
            We’ll notify you once it’s on its way.
          </p>
          <p style="margin:22px 0 0;color:#6b7280;font-size:13px;">— ${safeRestaurant}</p>
        </div>
        <div style="padding:14px 24px;border-top:1px solid #e5e7eb;background:#fcfcfd;color:#6b7280;font-size:12px;">
          You’re receiving this because you recently placed an order with ${safeRestaurant}.
        </div>
      </td>
    </tr>
  </table>
</body>
</html>
`.trim();

    const info = await transporter.sendMail({
      from: process.env.SMTP_FROM || process.env.SMTP_USER,
      to: email,
      subject,
      text,
      html
    });

    return res.json({
      message: 'Order-prepared email sent',
      to: maskEmail(email),
      messageId: info?.messageId || null,
      accepted: info?.accepted || [],
      rejected: info?.rejected || []
    });
  } catch (err) {
    console.error('order prepared email error:', err?.stack || err?.message || err);
    return res.status(500).json({ error: 'Something went wrong sending the email' });
  }
};