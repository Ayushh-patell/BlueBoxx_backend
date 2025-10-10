// src/middleware/auth.js
import jwt from 'jsonwebtoken';

const { JWT_SECRET } = process.env;
const ISSUER = 'blue-boxx';

export function requireAuth(req, res, next) {
  try {
    const auth = req.headers.authorization || '';
    const token = auth.startsWith('Bearer ') ? auth.slice(7) : null;
    if (!token) return res.status(401).json({ ok: false, message: 'Missing token' });

    const payload = jwt.verify(token, JWT_SECRET, { issuer: ISSUER });
    req.user = payload; // { sub, userId, username, site, ... }
    next();
  } catch (err) {
    return res.status(401).json({ ok: false, message: 'Invalid token' });
  }
}
