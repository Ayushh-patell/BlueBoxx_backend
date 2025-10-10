import User from '../models/User.js';

// Helper to send consistent JSON responses
function send(res, data, status = 200) {
  res.status(status).json(data);
}

// POST /api/user/create
export const createUser = async (req, res) => {
  try {
    const { username, temp_Password, name, site } = req.body || {};

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
        userId: user._id, // Mongo _id replaces insertId
        username,
        tempPassword: false
      },
      201
    );
  } catch (err) {
    console.error('create user error:', err.message || err);
    return send(res, { error: 'Something went wrong' }, 500);
  }
};
