// src/server.js
import dotenv from 'dotenv';
dotenv.config();

import http from 'http';
import app from './app.js';
import { connectDB } from './config/db.js';

// Log unhandled errors instead of dying silently
process.on('unhandledRejection', (err) => {
  console.error('UNHANDLED REJECTION:', err);
});
process.on('uncaughtException', (err) => {
  console.error('UNCAUGHT EXCEPTION:', err);
});

const PORT = process.env.PORT || 4000;
const server = http.createServer(app);

// Try DB connect, but don't block the web server from coming up
(async () => { try { await connectDB(); } catch (e) { console.error(e); } })();

server.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 Server running on http://localhost:${PORT}`);
});
