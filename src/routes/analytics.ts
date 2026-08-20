import { Router } from 'express';
import { google } from 'googleapis';
import { requireAuth, requireAdminRole } from '../middleware/auth';
import { asyncHandler, HttpError } from '../middleware/error-handler';

export const analyticsRouter = Router();

function daysAgoISO(n: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - n);
  return d.toISOString().slice(0, 10);
}

function getAuth() {
  const email = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
  const rawKey = process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY;
  if (!email || !rawKey) return null;
  const key = rawKey.replace(/\\n/g, '\n');
  return new google.auth.JWT({
    email,
    key,
    scopes: ['https://www.googleapis.com/auth/analytics.readonly', 'https://www.googleapis.com/auth/webmasters.readonly'],
  });
}

type Ga4Row = { dimensionValues?: { value?: string | null }[]; metricValues?: { value?: string | null }[] };

async function fetchGa4(auth: InstanceType<typeof google.auth.JWT>) {
  const propertyId = process.env.GA4_PROPERTY_ID;
  if (!propertyId) throw new HttpError(503, 'GA4_PROPERTY_ID is not configured.');

  const analyticsData = google.analyticsdata({ version: 'v1beta', auth });
  const property = `properties/${propertyId}`;

  const [last7, last30, topPages] = await Promise.all([
    analyticsData.properties.runReport({
      property,
      requestBody: {
        dateRanges: [{ startDate: '7daysAgo', endDate: 'today' }],
        metrics: [{ name: 'sessions' }, { name: 'activeUsers' }, { name: 'screenPageViews' }],
      },
    }),
    analyticsData.properties.runReport({
      property,
      requestBody: {
        dateRanges: [{ startDate: '30daysAgo', endDate: 'today' }],
        metrics: [{ name: 'sessions' }, { name: 'activeUsers' }, { name: 'screenPageViews' }],
      },
    }),
    analyticsData.properties.runReport({
      property,
      requestBody: {
        dateRanges: [{ startDate: '7daysAgo', endDate: 'today' }],
        dimensions: [{ name: 'pagePath' }],
        metrics: [{ name: 'screenPageViews' }],
        orderBys: [{ metric: { metricName: 'screenPageViews' }, desc: true }],
        limit: '5',
      },
    }),
  ]);

  const summary = (rows: Ga4Row[] | undefined | null) => {
    const r = rows?.[0]?.metricValues;
    return {
      sessions: Number(r?.[0]?.value ?? 0),
      activeUsers: Number(r?.[1]?.value ?? 0),
      pageviews: Number(r?.[2]?.value ?? 0),
    };
  };

  return {
    last7Days: summary(last7.data.rows as Ga4Row[]),
    last30Days: summary(last30.data.rows as Ga4Row[]),
    topPages: ((topPages.data.rows as Ga4Row[]) || []).map((row) => ({
      path: row.dimensionValues?.[0]?.value ?? '',
      pageviews: Number(row.metricValues?.[0]?.value ?? 0),
    })),
  };
}

async function fetchSearchConsole(auth: InstanceType<typeof google.auth.JWT>) {
  const siteUrl = process.env.SEARCH_CONSOLE_SITE_URL;
  if (!siteUrl) throw new HttpError(503, 'SEARCH_CONSOLE_SITE_URL is not configured.');

  const searchconsole = google.searchconsole({ version: 'v1', auth });
  // Search Console data typically lags 2-3 days behind real time, so end
  // ranges a few days back rather than "today" to avoid an artificially
  // low, still-incomplete final day skewing the numbers.
  const end = daysAgoISO(3);

  const [last7, last28, topQueries] = await Promise.all([
    searchconsole.searchanalytics.query({
      siteUrl,
      requestBody: { startDate: daysAgoISO(10), endDate: end },
    }),
    searchconsole.searchanalytics.query({
      siteUrl,
      requestBody: { startDate: daysAgoISO(31), endDate: end },
    }),
    searchconsole.searchanalytics.query({
      siteUrl,
      requestBody: { startDate: daysAgoISO(31), endDate: end, dimensions: ['query'], rowLimit: 5 },
    }),
  ]);

  const summary = (rows: typeof last7.data.rows) => {
    const r = rows?.[0];
    return {
      clicks: r?.clicks ?? 0,
      impressions: r?.impressions ?? 0,
      ctr: r?.ctr ?? 0,
      position: r?.position ?? 0,
    };
  };

  return {
    last7Days: summary(last7.data.rows),
    last28Days: summary(last28.data.rows),
    topQueries: (topQueries.data.rows || []).map((row) => ({
      query: row.keys?.[0] ?? '',
      clicks: row.clicks ?? 0,
      impressions: row.impressions ?? 0,
      ctr: row.ctr ?? 0,
      position: row.position ?? 0,
    })),
  };
}

// GET /api/analytics/overview -- full-admin only. Pulls live GA4 + Search
// Console stats for the Dashboard tab via a service account (no OAuth flow
// needed since this is a single-site, single-owner setup).
analyticsRouter.get(
  '/overview',
  requireAuth,
  requireAdminRole,
  asyncHandler(async (_req, res) => {
    const auth = getAuth();
    if (!auth) {
      res.status(503).json({ error: 'Analytics is not configured on this server.' });
      return;
    }

    const [analyticsResult, searchConsoleResult] = await Promise.allSettled([fetchGa4(auth), fetchSearchConsole(auth)]);

    res.json({
      analytics: analyticsResult.status === 'fulfilled' ? analyticsResult.value : null,
      analyticsError: analyticsResult.status === 'rejected' ? String(analyticsResult.reason?.message || analyticsResult.reason) : null,
      searchConsole: searchConsoleResult.status === 'fulfilled' ? searchConsoleResult.value : null,
      searchConsoleError:
        searchConsoleResult.status === 'rejected' ? String(searchConsoleResult.reason?.message || searchConsoleResult.reason) : null,
    });
  })
);
