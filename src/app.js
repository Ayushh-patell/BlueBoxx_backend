import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import path from 'path';
import './config/db.js';

import userRoutes from './routes/user.js';
import orderRoutes from './routes/order.js';
import utilRoutes from './routes/utils.js';
import { fileURLToPath } from 'url';

const app = express();

// ── ESM-safe __dirname / __filename ────────────────────────────────────────────
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Middlewares
app.use(helmet());
app.use(cors());
app.use(express.json());
app.use(morgan('dev'));

// ✅ Serve public assets (JSON, images, etc.)
app.use('/public', express.static(path.join(__dirname, 'public'), {
  maxAge: '1h',              // optional cache
  etag: true,
  immutable: false
}));


// Routes
app.use('/api/user', userRoutes);
app.use('/api/order', orderRoutes);
app.use('/api/util', utilRoutes); 

app.get('/', (req, res) => res.send('API is running'));

// Error handling placeholder
app.use((req, res) => res.status(404).json({ message: 'Not Found' }));

export default app;
