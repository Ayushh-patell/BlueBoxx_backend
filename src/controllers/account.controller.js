import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import User from '../models/User.js';

const SALT_ROUNDS = 10;

function isPlausibleEmail(s) {
  if (typeof s !== 'string') return false;
  const v = s.trim();
  if (v.length < 3 || v.length > 254) return false;
  // Simple pattern: <something>@<something>.<tld>
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);
}

// POST /api/user/account/setup
export const accountSetup = async (req, res) => {
  try {
    if (!process.env.JWT_SECRET) {
      console.error('JWT_SECRET is not set');
      return res.status(500).json({ error: 'Server misconfiguration' });
    }

    const { username, password, recoveryEmail } = req.body || {};

    // === validation ===
    if (typeof username !== 'string' || username.length === 0) {
      return res.status(400).json({ error: 'username is required' });
    }
    if (typeof password !== 'string' || password.length < 8) {
      return res
        .status(400)
        .json({ error: 'password must be a string of at least 8 characters' });
    }
    if (!isPlausibleEmail(recoveryEmail)) {
      return res.status(400).json({ error: 'recoveryEmail is invalid' });
    }

    const normalizedRecovery = recoveryEmail.trim().toLowerCase();

    // Find the user (case-sensitive) first to return proper 404 if not found
    const existing = await User.findOne({ username });
    if (!existing) {
      return res.status(404).json({ error: 'User not found' });
    }

    // password already set?
    if (existing.password !== null && typeof existing.password === 'string' && existing.password.length > 0) {
      return res.status(409).json({
        error: 'Password already set; cannot change via setup endpoint'
      });
    }

    // Hash new password
    const hash = await bcrypt.hash(password, SALT_ROUNDS);

    // Atomically set password only if it's still null, clear temp_password, set recovery email
    const updated = await User.findOneAndUpdate(
      { username, password: null },
      {
        $set: {
          password: hash,
          recovery_email: normalizedRecovery
        },
        $unset: {
          temp_password: '' // clear temp password
        }
      },
      { new: true } // return the updated document
    );

    if (!updated) {
      // password may have been set between find and update
      return res.status(409).json({
        error: 'Password already set; cannot change via setup endpoint'
      });
    }

    // === Build JWT like in login ===
    const userId = String(updated._id);
    const payload = {
      sub: userId,
      userId,                                     // explicit for consumers expecting userId
      username: updated.username,
      name: updated.name || updated.username,     // include name; fallback to username if not present
      recovery_email: updated.recovery_email || null,
      site: updated.site ? String(updated.site) : null, // ensure string if ObjectId
      premium: !!updated.premium
    };

    const options = {
      algorithm: 'HS256',
      expiresIn: '30d',
      issuer: 'blue-boxx'
    };

    const token = jwt.sign(payload, process.env.JWT_SECRET, options);

    return res.json({
      message: 'Account setup complete',
      username: updated.username,
      tempPassword: false,
      premium: !!updated.premium,
      token
    });
  } catch (err) {
    console.error('account setup error:', err?.message || err);
    return res.status(500).json({ error: 'Something went wrong' });
  }
};
