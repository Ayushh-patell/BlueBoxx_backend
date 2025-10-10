import bcrypt from 'bcryptjs';
import nodemailer from 'nodemailer';
import User from '../models/User.js';
import jwt from 'jsonwebtoken';
import RecoveryCode from '../models/RecoveryCode.js';

const SALT_ROUNDS = 10;

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

function generateNumericCode(length = 6) {
  const min = 10 ** (length - 1);
  const max = 10 ** length - 1;
  return String(Math.floor(Math.random() * (max - min + 1)) + min);
}

function escapeHtml(s) {
  if (typeof s !== 'string') return '';
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// POST /api/user/account/recovery/send-code
export const sendRecoveryCode = async (req, res) => {
  try {
    // ensure required env vars
    ensureEnv([
      'SMTP_HOST',
      'SMTP_PORT',
      'SMTP_USER',
      'SMTP_PASS',
      'SMTP_FROM'
    ]);

    const { username } = req.body || {};
    if (typeof username !== 'string' || username.length === 0) {
      return res.status(400).json({ error: 'username is required' });
    }

    // find user (case-sensitive)
    const user = await User.findOne({ username });
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    const toEmail = user.recovery_email?.trim();
    if (!toEmail) {
      return res
        .status(409)
        .json({ error: 'No recovery email on file for this user' });
    }

    // generate + hash code
    const code = generateNumericCode(6);
    const ttlSeconds = parseInt(process.env.CODE_TTL_SECONDS || '1800', 10);
    const expiresAt = new Date(Date.now() + ttlSeconds * 1000);
    const codeHash = await bcrypt.hash(code, SALT_ROUNDS);

    // upsert (replace existing or insert new)
    await RecoveryCode.findOneAndUpdate(
      { username },
      { code_hash: codeHash, expires_at: expiresAt },
      { upsert: true, new: true }
    );

    // --- SMTP (Hostinger) transport ---
    const transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: Number(process.env.SMTP_PORT),
      secure: Number(process.env.SMTP_PORT) === 465, // true for 465, false for 587
      auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS
      }
    });

    const subject = 'Your recovery code';
    const text = `Hi ${user.username},

Your recovery code is: ${code}

It expires in ${Math.floor(ttlSeconds / 60)} minutes.

If you didn’t request this, ignore this email.`;

    const html = `
<!DOCTYPE html>
<html>
  <body style="font-family: system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif; background:#f6f7f9; padding:24px; color:#111;">
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:600px;margin:0 auto;background:#fff;border-radius:12px;overflow:hidden;border:1px solid #e5e7eb;">
      <tr><td style="padding:24px;">
        <h1 style="margin:0 0 8px;font-size:20px;">Your recovery code</h1>
        <p style="margin:0 0 16px;color:#444;">Hi <strong>${escapeHtml(
          user.username
        )}</strong>, use this code to continue.</p>
        <div style="font-size:32px;letter-spacing:6px;text-align:center;padding:16px 12px;margin:12px 0;border:1px dashed #d1d5db;border-radius:10px;background:#fafafa;">
          <strong>${escapeHtml(code)}</strong>
        </div>
        <p style="margin:16px 0;color:#444;">This code expires in <strong>${Math.floor(
          ttlSeconds / 60
        )} minutes</strong>.</p>
        <p style="margin-top:24px;color:#888;font-size:12px;">If you didn't request this, you can ignore this email.</p>
      </td></tr>
    </table>
  </body>
</html>`.trim();

    const info = await transporter.sendMail({
      from: process.env.SMTP_USER, // (kept as-is)
      to: toEmail,
      subject,
      text,
      html
    });

    return res.json({
      message: 'Recovery code sent',
      username: user.username,
      to: maskEmail(toEmail),
      expiresInSeconds: ttlSeconds,
      messageId: info?.messageId || null,
      accepted: info?.accepted || [],
      rejected: info?.rejected || []
    });
  } catch (err) {
    console.error(
      'recovery send-code error:',
      err?.stack || err?.message || err
    );
    return res.status(500).json({ error: 'Something went wrong' });
  }
};

// POST /api/user/account/recovery/verify
export const verifyRecoveryCode = async (req, res) => {
  try {
    const { username, code } = req.body || {};

    // validation (strict, no trimming/lowercasing)
    if (typeof username !== 'string' || username.length === 0) {
      return res.status(400).json({ error: 'username is required' });
    }
    if (typeof code !== 'string' || code.length === 0) {
      return res.status(400).json({ error: 'code is required' });
    }

    // load active code for username
    const rec = await RecoveryCode.findOne({ username });
    if (!rec) {
      return res.status(400).json({ error: 'No active code for this user' });
    }

    // expiry check
    const exp = new Date(rec.expires_at);
    if (Number.isNaN(exp.getTime()) || new Date() > exp) {
      return res.status(401).json({ error: 'Code expired' });
    }

    // compare submitted code vs stored hash
    let ok = false;
    try {
      ok = await bcrypt.compare(String(code), String(rec.code_hash));
    } catch (e) {
      console.error('bcrypt.compare error:', e?.message || e);
      return res.status(500).json({ error: 'Unable to verify code' });
    }
    if (!ok) {
      return res.status(401).json({ error: 'Incorrect code' });
    }

    // success (do NOT delete row here)
    return res.json({ ok: true, message: 'Code verified' });
  } catch (err) {
    console.error('recovery verify error:', err?.stack || err?.message || err);
    return res.status(500).json({ error: 'Something went wrong' });
  }
};


// POST /api/user/account/recovery/reset
export const resetPasswordAfterRecovery = async (req, res) => {
  try {
    // sanity check
    if (!process.env.JWT_SECRET) {
      console.error('JWT_SECRET is not set');
      return res.status(500).json({ error: 'Server misconfiguration' });
    }

    // parse & validate body
    const { username, code, newPassword } = req.body || {};

    if (typeof username !== 'string' || username.length === 0) {
      return res.status(400).json({ error: 'username is required' });
    }
    if (typeof code !== 'string' || code.length === 0) {
      return res.status(400).json({ error: 'code is required' });
    }
    if (!(typeof newPassword === 'string' && newPassword.length >= 8)) {
      return res
        .status(400)
        .json({ error: 'newPassword must be at least 8 characters' });
    }

    // 1) load user (case-sensitive)
    const user = await User.findOne({ username });
    if (!user) return res.status(404).json({ error: 'User not found' });

    // 2) load recovery code for username
    const rec = await RecoveryCode.findOne({ username });
    if (!rec) return res.status(400).json({ error: 'No active code for this user' });

    // 3) expiry check
    const exp = new Date(rec.expires_at);
    if (Number.isNaN(exp.getTime()) || new Date() > exp) {
      // clean up expired row
      try {
        await RecoveryCode.deleteOne({ _id: rec._id });
      } catch {}
      return res.status(401).json({ error: 'Code expired' });
    }

    // 4) compare code
    let ok = false;
    try {
      ok = await bcrypt.compare(String(code), String(rec.code_hash));
    } catch (e) {
      console.error('bcrypt.compare error:', e?.message || e);
      return res.status(500).json({ error: 'Unable to verify code' });
    }
    if (!ok) {
      return res.status(401).json({ error: 'Incorrect code' });
    }

    // 5) hash new password & update user, clear temp_password
    let newHash;
    try {
      newHash = await bcrypt.hash(newPassword, SALT_ROUNDS);
    } catch (e) {
      console.error('bcrypt hash error:', e?.message || e);
      return res.status(500).json({ error: 'Unable to process password' });
    }

    const upd = await User.updateOne(
      { _id: user._id },
      { $set: { password: newHash, temp_password: null } }
    );
    if (!upd || upd.modifiedCount === 0) {
      return res.status(500).json({ error: 'Failed to update password' });
    }

    // one-time use: delete the recovery code row
    try {
      await RecoveryCode.deleteOne({ _id: rec._id });
    } catch (e) {
      console.error('Failed to delete recovery code row:', e?.message || e);
    }

    // 6) issue JWT (same extra fields as login)
    const userId = String(user._id);
    const jwtPayload = {
      sub: userId,
      userId,
      username: user.username,
      name: user.name || user.username,
      recovery_email: user.recovery_email || null,
      site: user.site ? String(user.site) : null,
      premium: !!user.premium
    };
    const jwtOptions = {
      algorithm: 'HS256',
      expiresIn: '30d',
      issuer: 'blue-boxx'
    };
    const token = jwt.sign(jwtPayload, process.env.JWT_SECRET, jwtOptions);

    return res.json({
      message: 'Password reset successful',
      token,
      premium: !!user.premium
    });
  } catch (error) {
    console.error('password reset error:', error?.message || error);
    return res.status(500).json({ error: 'Something went wrong' });
  }
};
