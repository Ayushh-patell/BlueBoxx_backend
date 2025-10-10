// src/controllers/logout.controller.js
import User from '../models/User.js';

/**
 * POST /api/user/logout
 * Body: { username, index }
 *
 * Responses (kept identical to previous API):
 * - 400 { message: "User not found" }
 * - 200 { message: "Invalid token index" }
 * - 200 { message: "Logout Successful" }
 * - 500 { error: "Something went wrong" }
 */
export const logoutController = async (req, res) => {
  try {
    const { username, index } = req.body || {};
    // keep behavior: if user not found -> 400 "User not found"
    const user = await User.findOne({ username });
    console.log(user, username);
    
    if (!user) {
      return res.status(400).json({ message: 'User not found' });
    }

    // read fcm_tokens as-is (array | object | JSON string | null/undefined)
    let fcm_tokens = user.fcm_tokens ?? {};

    // normalize string → parsed JSON
    if (typeof fcm_tokens === 'string') {
      try {
        fcm_tokens = JSON.parse(fcm_tokens);
      } catch {
        // if it's a bad string, treat as empty object to avoid crashes
        fcm_tokens = {};
      }
    }

    // handle Array vs Object the same way the old API did
    let updated = false;

    if (Array.isArray(fcm_tokens)) {
      // array uses numeric index
      const idxNum = Number.parseInt(index, 10);
      if (Number.isFinite(idxNum) && idxNum >= 0 && idxNum < fcm_tokens.length) {
        fcm_tokens[idxNum] = null;
        updated = true;
      }
    } else if (fcm_tokens && typeof fcm_tokens === 'object') {
      // object uses key existence like the old code
      const key = String(index);
      if (Object.prototype.hasOwnProperty.call(fcm_tokens, key)) {
        fcm_tokens[key] = null;
        updated = true;
      }
    } else {
      // unexpected shape → act like "invalid index"
      updated = false;
    }

    if (!updated) {
      // keep previous behavior: 200 + "Invalid token index"
      return res
        .status(200)
        .json({ message: 'Invalid token index' });
    }

    // persist without changing the underlying type
    user.fcm_tokens = fcm_tokens;
    // If fcm_tokens is an object (non-schema), ensure mongoose marks it modified.
    if (!Array.isArray(fcm_tokens)) {
      user.markModified('fcm_tokens');
    }
    await user.save();

    return res
      .status(200)
      .json({ message: 'Logout Successful' });
  } catch (error) {
    console.error('Error during logout:', error?.stack || error?.message || error);
    return res
      .status(500)
      .json({ error: 'Something went wrong' });
  }
};
