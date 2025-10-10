import User from '../models/User.js';

// POST /api/user/addToken
export const addToken = async (req, res) => {
  try {
    const { token, username, index } = req.body || {};
    let keyIndex = index;

    if (!token || !username) {
      return res.status(400).json({ error: 'Token and Username are required' });
    }

    // Fetch user
    const user = await User.findOne({ username });
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    // Convert to object-style map (if you want to keep same client behavior)
    // But we store it as an array in Mongo — simulate map via object keys
    let fcm_tokens = user.fcm_tokens || [];

    // If fcm_tokens accidentally stored as string (legacy migration case)
    if (typeof fcm_tokens === 'string') {
      try {
        fcm_tokens = JSON.parse(fcm_tokens);
      } catch {
        fcm_tokens = [];
      }
    }

    // If the client sends a numeric index, ensure it's int
    if (typeof keyIndex === 'string' && !isNaN(keyIndex)) {
      keyIndex = parseInt(keyIndex, 10);
    }

    // Find a key index to reuse (similar to your old logic)
    if (keyIndex === undefined || keyIndex === null) {
      const existingIndex = fcm_tokens.findIndex((t) => !t);
      keyIndex = existingIndex !== -1 ? existingIndex : fcm_tokens.length;
    }

    // Token already present and unchanged
    if (fcm_tokens[keyIndex] === token) {
      return res.status(200).json({ message: 'Token up-to-date' });
    }

    // Update token
    fcm_tokens[keyIndex] = token;
    user.fcm_tokens = fcm_tokens;
    await user.save();

    return res
      .status(200)
      .json({ message: 'Token updated successfully', key: keyIndex });
  } catch (error) {
    console.error('Error updating FCM token:', error);
    return res.status(500).json({ error: 'Something went wrong' });
  }
};
