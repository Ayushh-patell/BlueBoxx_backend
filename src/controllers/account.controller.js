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

    // Find user
    const user = await User.findOne({ username });
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    // password already set?
    if (user.password !== null && typeof user.password === 'string' && user.password.length > 0) {
      return res.status(409).json({
        error: 'Password already set; cannot change via setup endpoint'
      });
    }

    // Hash new password
    const hash = await bcrypt.hash(password, SALT_ROUNDS);

    // Update user atomically
    const result = await User.updateOne(
      { username, password: null },
      {
        $set: {
          password: hash,
          temp_password: null, // Clear temp password flag
          recovery_email: normalizedRecovery
        }
      }
    );

    if (result.modifiedCount === 0) {
      // password may have been set between find and update
      return res.status(409).json({
        error: 'Password already set; cannot change via setup endpoint'
      });
    }

    return res.json({
      message: 'Account setup complete',
      username,
      tempPassword: false
    });
  } catch (err) {
    console.error('account setup error:', err?.message || err);
    return res.status(500).json({ error: 'Something went wrong' });
  }
};
