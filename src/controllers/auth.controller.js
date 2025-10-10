import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import User from '../models/User.js';

const INVALID_MSG = 'Invalid credentials';

// POST /api/user/login
export const login = async (req, res) => {
  try {
    if (!process.env.JWT_SECRET) {
      console.error('JWT_SECRET is not set');
      return res.status(500).json({ error: 'Server misconfiguration' });
    }

    const { username, password } = req.body || {};

    // Validate input
    if (
      typeof username !== 'string' ||
      typeof password !== 'string' ||
      username.length === 0 ||
      password.length === 0
    ) {
      return res
        .status(400)
        .json({ error: 'Username and password are required' });
    }

    // Case-sensitive lookup
    const user = await User.findOne({ username });
    if (!user) {
      return res.status(401).json({ error: INVALID_MSG });
    }

    let ok = false;
    let isTempFlow = false;

    // If no permanent password set → temp password check
    if (user.password === null) {
      if (typeof user.temp_password === 'string' && user.temp_password.length > 0) {
        ok = password === user.temp_password;
      }
      isTempFlow = ok;
    } else {
      // Check bcrypt hash first
      try {
        ok = await bcrypt.compare(password, user.password);
      } catch {
        ok = false;
      }

      // Legacy plaintext fallback + migration
      if (!ok && typeof user.password === 'string') {
        ok = password === user.password;
        if (ok) {
          try {
            const newHash = await bcrypt.hash(password, 10);
            user.password = newHash;
            await user.save();
          } catch (e) {
            console.error('Password migration failed for user', user.username, e?.message || e);
          }
        }
      }

      isTempFlow = false;
    }

    if (!ok) {
      return res.status(401).json({ error: INVALID_MSG });
    }

    // Build JWT with extra fields
    const userId = String(user._id);
    const payload = {
      sub: userId,
      userId,                             // explicit for consumers expecting userId
      username: user.username,
      name: user.name || user.username,   // include name; fallback to username if not present
      recovery_email: user.recovery_email || null,
      site: user.site ? String(user.site) : null, // ensure string if ObjectId
      premium: !!user.premium
    };

    const options = {
      algorithm: 'HS256',
      expiresIn: '30d',
      issuer: 'blue-boxx'
    };

    const token = jwt.sign(payload, process.env.JWT_SECRET, options);

    return res.status(200).json({
      message: 'Login successful',
      token,
      premium: !!user.premium,
      tempPassword: isTempFlow
    });
  } catch (error) {
    console.error('login error:', error?.message || error);
    return res.status(500).json({ error: 'Something went wrong' });
  }
};
