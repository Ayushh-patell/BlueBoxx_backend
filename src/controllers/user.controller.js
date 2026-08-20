// src/controllers/user.controller.js
import crypto from 'crypto';
import mongoose from 'mongoose';
import User from '../models/User.js';

// --- Config ---
const USER_SECRET = process.env.CREATE_USER_SECRET || ''; // set in your env

function ensureSecretPresent() {
  if (!USER_SECRET) {
    // Fail fast if you forgot to configure it
    throw new Error('Missing env CREATE_USER_SECRET');
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

function getAdminSecret(req) {
  const header = req.headers['x-admin-secret'];
  if (typeof header === 'string' && header.length) return header;
  const bodySecret = req.body?.secret;
  if (typeof bodySecret === 'string' && bodySecret.length) return bodySecret;
  const querySecret = req.query?.secret;
  if (typeof querySecret === 'string' && querySecret.length) return querySecret;
  return '';
}

function requireAdminSecret(req, res) {
  ensureSecretPresent();
  const secret = getAdminSecret(req);
  if (!secret) {
    send(res, { error: 'secret is required' }, 400);
    return false;
  }
  if (!secretsMatch(secret, USER_SECRET)) {
    send(res, { error: 'invalid credentials' }, 403);
    return false;
  }
  return true;
}

function publicUser(user) {
  return {
    _id: user._id,
    username: user.username,
    name: user.name,
    site: user.site,
    premium: !!user.premium,
    recovery_email: user.recovery_email || null,
    hasPassword: typeof user.password === 'string' && user.password.length > 0,
    temp_password: user.password ? null : (user.temp_password || null),
    created_at: user.created_at,
    updated_at: user.updated_at,
  };
}

// Helper to send consistent JSON responses
function send(res, data, status = 200) {
  res.status(status).json(data);
}

// POST /api/user/create
// body: { username, temp_Password, name, site, secret, premium? }
export const createUser = async (req, res) => {
  try {
    if (!requireAdminSecret(req, res)) return;

    const { username, temp_Password, name, site, premium } = req.body || {};

    // Validate input
    if (typeof username !== 'string' || username.trim().length === 0) {
      return send(res, { error: 'username is required' }, 400);
    }
    if (typeof name !== 'string' || name.trim().length === 0) {
      return send(res, { error: 'name is required' }, 400);
    }
    if (typeof site !== 'string' || site.trim().length === 0) {
      return send(res, { error: 'site is required' }, 400);
    }

    // Check if username exists (case-sensitive)
    const existing = await User.findOne({ username });
    if (existing) {
      return send(res, { error: 'Username already exists' }, 409);
    }

    // Create user (password = null)
    const user = await User.create({
      username: username.trim(),
      site: site.trim(),
      name: name.trim(),
      password: null,
      temp_password: temp_Password || 'BlueBoxxNewUser',
      premium: !!premium
    });

    return send(
      res,
      {
        message: 'User created',
        userId: user._id,
        username: user.username,
        user: publicUser(user),
        tempPassword: false
      },
      201
    );
  } catch (err) {
    console.error('create user error:', err?.stack || err?.message || err);
    if (err?.code === 11000) {
      return send(res, { error: 'Username or name already exists' }, 409);
    }
    return send(res, { error: 'Something went wrong' }, 500);
  }
};

// GET /api/user/list
// auth: x-admin-secret header, or ?secret=
export const listUsers = async (req, res) => {
  try {
    if (!requireAdminSecret(req, res)) return;

    const { site, q } = req.query || {};
    const filter = {};
    if (typeof site === 'string' && site.trim()) {
      filter.site = site.trim();
    }
    if (typeof q === 'string' && q.trim()) {
      const term = q.trim();
      filter.$or = [
        { username: { $regex: term, $options: 'i' } },
        { name: { $regex: term, $options: 'i' } },
        { recovery_email: { $regex: term, $options: 'i' } },
      ];
    }

    const users = await User.find(filter)
      .sort({ created_at: -1 })
      .lean();

    return send(res, {
      ok: true,
      count: users.length,
      users: users.map(publicUser),
    });
  } catch (err) {
    console.error('list users error:', err?.stack || err?.message || err);
    return send(res, { error: 'Something went wrong' }, 500);
  }
};

// PATCH /api/user/update
// body: { secret, userId | username, name?, site?, premium?, recovery_email?, temp_password?, resetPassword? }
export const updateUser = async (req, res) => {
  try {
    if (!requireAdminSecret(req, res)) return;

    const {
      userId,
      username,
      name,
      site,
      premium,
      recovery_email,
      temp_password,
      resetPassword,
    } = req.body || {};

    let user = null;
    if (typeof userId === 'string' && mongoose.Types.ObjectId.isValid(userId)) {
      user = await User.findById(userId);
    } else if (typeof username === 'string' && username.trim()) {
      user = await User.findOne({ username: username.trim() });
    } else {
      return send(res, { error: 'userId or username is required' }, 400);
    }

    if (!user) {
      return send(res, { error: 'User not found' }, 404);
    }

    if (typeof name === 'string' && name.trim()) {
      user.name = name.trim();
    }
    if (typeof site === 'string' && site.trim()) {
      user.site = site.trim();
    }
    if (typeof premium === 'boolean') {
      user.premium = premium;
    }
    if (recovery_email === null) {
      user.recovery_email = null;
    } else if (typeof recovery_email === 'string') {
      user.recovery_email = recovery_email.trim().toLowerCase() || null;
    }
    if (typeof temp_password === 'string' && temp_password.length) {
      user.temp_password = temp_password;
    }
    if (resetPassword === true) {
      user.password = null;
      if (!user.temp_password) {
        user.temp_password = 'BlueBoxxNewUser';
      }
    }

    await user.save();

    return send(res, {
      ok: true,
      message: 'User updated',
      user: publicUser(user),
    });
  } catch (err) {
    console.error('update user error:', err?.stack || err?.message || err);
    if (err?.code === 11000) {
      return send(res, { error: 'Username or name already exists' }, 409);
    }
    return send(res, { error: 'Something went wrong' }, 500);
  }
};
