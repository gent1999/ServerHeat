import './lib/bigint-json';
import express from 'express';
import cors from 'cors';
import { articlesRouter } from './routes/articles';
import { categoriesRouter } from './routes/categories';
import { tagsRouter } from './routes/tags';
import { authorsRouter } from './routes/authors';
import { redirectsRouter } from './routes/redirects';
import { authRouter } from './routes/auth';
import { homeRouter } from './routes/home';
import { mediaRouter } from './routes/media';
import { analyticsRouter } from './routes/analytics';
import { errorHandler } from './middleware/error-handler';

const allowedOrigins = (process.env.CORS_ORIGINS || '').split(',').map((s) => s.trim()).filter(Boolean);

export const app = express();

app.use(cors({ origin: allowedOrigins.length ? allowedOrigins : true }));
app.use(express.json({ limit: '2mb' }));

app.get('/health', (_req, res) => res.json({ ok: true }));

app.use('/api/articles', articlesRouter);
app.use('/api/categories', categoriesRouter);
app.use('/api/tags', tagsRouter);
app.use('/api/authors', authorsRouter);
app.use('/api/redirects', redirectsRouter);
app.use('/api/auth', authRouter);
app.use('/api/home', homeRouter);
app.use('/api/media', mediaRouter);
app.use('/api/analytics', analyticsRouter);

app.use(errorHandler);
