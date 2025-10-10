import mongoose from 'mongoose';

const UserSchema = new mongoose.Schema(
  {
    // same as `id` (MySQL auto increment) — MongoDB uses _id automatically
    username: {
      type: String,
      required: true,
      trim: true,
      unique: true
    },

    name: {
      type: String,
      required: true,
      trim: true,
      unique: true
    },

    password: {
      type: String,
      default: null
    },

    fcm_tokens: {
      type: [String], // stores array of device tokens
      default: []
    },

    premium: {
      type: Boolean,
      default: false
    },

    recovery_email: {
      type: String,
      default: null,
      trim: true
    },

    temp_password: {
      type: String,
      default: 'BlueBoxxNewUser'
    },

    site: { type: String, index: true, trim: true, required: true }
  },
  {
    timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' }
  },
  
);

export default mongoose.model('User', UserSchema, 'app_users');
