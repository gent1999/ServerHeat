// Vercel serverless entry point. Vercel invokes this file's default
// export as a plain (req, res) handler per request -- it never calls
// app.listen() (that's src/index.ts, used for local dev only). Express
// apps satisfy that handler signature directly, so re-exporting `app`
// is all that's needed; vercel.json rewrites every path here so
// Express's own routing (app.use('/api/articles', ...) etc.) still
// works unchanged.
import { app } from '../src/app';

export default app;
