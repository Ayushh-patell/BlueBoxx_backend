// src/controllers/user.controller.js
import crypto from 'crypto';
import User from '../models/User.js';

// --- Config ---
const USER_SECRET = process.env.CREATE_USER_SECRET || ''; // set in your env

function ensureSecretPresent() {
  if (!USER_SECRET) {
    // Fail fast if you forgot to configure it
    throw new Error('Missing env USER_SECRET');
  }
}

/** constant-time comparison to avoid timing leaks */
function secretsMatch(a, b) {
  try {
    const abuf = Buffer.from(String(a || ''), 'utf8');
    const bbuf = Buffer.from(String(b || ''), 'utf8');
    return (
      abuf.length === bbuf.length &&
      crypto.timingSafeEqual(abuf, bbuf)
    );
  } catch {
    return false;
  }
}

// Helper to send consistent JSON responses
function send(res, data, status = 200) {
  res.status(status).json(data);
}

// POST /api/user/create
// body: { username, temp_Password, name, site, secret }
export const createUser = async (req, res) => {
  try {
    ensureSecretPresent();

    const { username, temp_Password, name, site, secret } = req.body || {};

    // Secret required
    if (typeof secret !== 'string' || secret.length === 0) {
      return send(res, { error: 'secret is required' }, 400);
    }
    if (!secretsMatch(secret, USER_SECRET)) {
      // Don't reveal which side is wrong
      return send(res, { error: 'invalid credentials' }, 403);
    }

    // Validate input
    if (typeof username !== 'string' || username.trim().length === 0) {
      return send(res, { error: 'username is required' }, 400);
    }

    // Check if username exists (case-sensitive)
    const existing = await User.findOne({ username });
    if (existing) {
      return send(res, { error: 'Username already exists' }, 409);
    }

    // Create user (password = null)
    const user = await User.create({
      username,
      site,
      name,
      password: null,
      temp_password: temp_Password || 'BlueBoxxNewUser',
      premium: false
    });

    return send(
      res,
      {
        message: 'User created',
        userId: user._id,
        username,
        tempPassword: false
      },
      201
    );
  } catch (err) {
    console.error('create user error:', err?.stack || err?.message || err);
    return send(res, { error: 'Something went wrong' }, 500);
  }
};
