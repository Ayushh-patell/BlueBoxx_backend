import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import './config/db.js';

import userRoutes from './routes/user.js';
import orderRoutes from './routes/order.js';
import utilRoutes from './routes/utils.js';
import { stripeWebhook } from './api/stripeWebhook.js';

const app = express();

// ESM-safe __dirname / __filename
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Resolve public dir from CWD (project root), not from this file’s folder
const PUBLIC_DIR = path.resolve(process.cwd(), 'public');

// Log what we’re serving (helps debug mismatches)
console.log('Serving static from:', PUBLIC_DIR);
console.log('app-versions.json exists:', fs.existsSync(path.join(PUBLIC_DIR, 'app-versions.json')));


// ⚠️ STRIPE WEBHOOK ROUTE MUST COME BEFORE express.json()
// It needs access to the raw request body for signature verification.
app.post(
  '/api/stripe/webhook',
  express.raw({ type: 'application/json' }),
  stripeWebhook
);

// Middlewares
app.use(helmet());
app.use(cors());
app.use(express.json());
app.use(morgan('dev'));

// Serve /<file> directly, e.g. /app-versions.json
app.use(express.static(PUBLIC_DIR, {
  maxAge: '1h',
  etag: true,
}));

// If you also want it under /public/...
app.use('/public', express.static(PUBLIC_DIR, {
  maxAge: '1h',
  etag: true,
}));


// AWS Path
app.get('/health', (_, res) => res.status(200).send('OK'));

// Routes
app.use('/api/user', userRoutes);
app.use('/api/order', orderRoutes);
app.use('/api/util', utilRoutes);

app.get('/', (req, res) => res.send('API is running'));

// 404
app.use((req, res) => res.status(404).json({ message: 'Not Found' }));

export default app;
