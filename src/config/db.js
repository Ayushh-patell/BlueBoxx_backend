// src/config/db.js
import mongoose from 'mongoose';
import dotenv from 'dotenv';
dotenv.config();

const uri = process.env.MONGO_URI;
const HARD_FAIL = String(process.env.DB_HARD_FAIL || '').toLowerCase() === 'true';

export async function connectDB() {
  if (!uri) {
    const msg = 'MONGO_URI not set';
    if (HARD_FAIL) throw new Error(msg);
    console.warn('[DB] ' + msg + ' — continuing without DB');
    return;
  }

  try {
    await mongoose.connect(uri, { serverSelectionTimeoutMS: 8000, socketTimeoutMS: 20000 });
    console.log('✅ MongoDB connected');
  } catch (err) {
    console.error('❌ MongoDB connection error:', err?.message || err);
    if (HARD_FAIL) throw err;
    console.warn('[DB] continuing without DB (temporary failure)');
  }
}

export function isDBConnected() {
  return mongoose.connection.readyState === 1;
}

export default mongoose;
