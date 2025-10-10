// src/controllers/util.controller.js
import nodemailer from 'nodemailer';
const ensureEnv = (keys) => {
  const missing = keys.filter((k) => !process.env[k]);
  if (missing.length) throw new Error(`Missing env: ${missing.join(', ')}`);
};

export const testEmail = async (req, res) => {
  try {
    // optional quick guard to avoid abuse in prod — set TEST_EMAIL_TOKEN and pass it via header
    if (process.env.TEST_EMAIL_TOKEN) {
      const hdr = req.headers['x-test-email-token'];
      if (hdr !== process.env.TEST_EMAIL_TOKEN) {
        return res.status(401).json({ error: 'Unauthorized (bad test token)' });
      }
    }

    ensureEnv(['SMTP_HOST', 'SMTP_PORT', 'SMTP_USER', 'SMTP_PASS']);

    const { to, subject, text, html } = req.body || {};
    if (!to || typeof to !== 'string') {
      return res.status(400).json({ error: '`to` (email) is required' });
    }

    const transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: Number(process.env.SMTP_PORT),
      secure: Number(process.env.SMTP_PORT) === 465, // true for 465, false for 587
      auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS
      }
    });

    const defaultSubject = 'BlueBoxx SMTP test';
    const defaultText =
`Hello!

This is a test email from BlueBoxx backend.
If you received this, SMTP is working ✅.

– BlueBoxx`;
    const defaultHtml = `
<!doctype html>
<html>
  <body style="font-family: system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif; background:#f6f7f9; padding:24px; color:#111;">
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:600px;margin:0 auto;background:#fff;border-radius:12px;overflow:hidden;border:1px solid #e5e7eb;">
      <tr><td style="padding:24px;">
        <h1 style="margin:0 0 8px;font-size:20px;">BlueBoxx SMTP test</h1>
        <p style="margin:12px 0;color:#444;">If you see this, your Hostinger SMTP is configured correctly 🎉</p>
        <p style="margin:12px 0;color:#444;">Sent via <code>${process.env.SMTP_HOST}:${process.env.SMTP_PORT}</code> as <code>${process.env.SMTP_USER}</code>.</p>
      </td></tr>
    </table>
  </body>
</html>`.trim();

    const info = await transporter.sendMail({
      from: process.env.SMTP_USER, // shows as the visible sender
      to,
      subject: subject || defaultSubject,
      text: text || defaultText,
      html: html || defaultHtml
    });

    return res.json({
      ok: true,
      message: 'Test email sent',
      to,
      messageId: info?.messageId || null,
      accepted: info?.accepted || [],
      rejected: info?.rejected || [],
      envelope: info?.envelope || null,
    });
  } catch (err) {
    console.error('testEmail error:', err?.stack || err?.message || err);
    return res.status(500).json({ ok: false, error: 'Failed to send test email' });
  }
};
