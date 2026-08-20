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

function pad(n: number): string {
  return String(n).padStart(2, '0');
}

function thisMonthStartISO(): string {
  const now = new Date();
  return `${now.getUTCFullYear()}-${pad(now.getUTCMonth() + 1)}-01`;
}

function lastMonthStartISO(): string {
  const now = new Date();
  const isJan = now.getUTCMonth() === 0;
  const year = isJan ? now.getUTCFullYear() - 1 : now.getUTCFullYear();
  const month = isJan ? 12 : now.getUTCMonth();
  return `${year}-${pad(month)}-01`;
}

function lastMonthEndISO(): string {
  const now = new Date();
  // Day 0 of the current month is the last day of the previous month.
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 0));
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
type Ga4Summary = { sessions: number; activeUsers: number; pageviews: number };

async function fetchGa4(auth: InstanceType<typeof google.auth.JWT>) {
  const propertyId = process.env.GA4_PROPERTY_ID;
  if (!propertyId) throw new HttpError(503, 'GA4_PROPERTY_ID is not configured.');

  const analyticsData = google.analyticsdata({ version: 'v1beta', auth });
  const property = `properties/${propertyId}`;
  const metrics = [{ name: 'sessions' }, { name: 'activeUsers' }, { name: 'screenPageViews' }];

  const runSummary = (startDate: string, endDate: string) =>
    analyticsData.properties.runReport({ property, requestBody: { dateRanges: [{ startDate, endDate }], metrics } });

  const [last7, last30, thisMonth, lastMonth, topPages] = await Promise.all([
    runSummary('7daysAgo', 'today'),
    runSummary('30daysAgo', 'today'),
    runSummary(thisMonthStartISO(), 'today'),
    runSummary(lastMonthStartISO(), lastMonthEndISO()),
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

  const summary = (rows: Ga4Row[] | undefined | null): Ga4Summary => {
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
    thisMonth: summary(thisMonth.data.rows as Ga4Row[]),
    lastMonth: summary(lastMonth.data.rows as Ga4Row[]),
    topPages: ((topPages.data.rows as Ga4Row[]) || []).map((row) => ({
      path: row.dimensionValues?.[0]?.value ?? '',
      pageviews: Number(row.metricValues?.[0]?.value ?? 0),
    })),
  };
}

type ScSummary = { clicks: number; impressions: number; ctr: number; position: number };
const ZERO_SC_SUMMARY: ScSummary = { clicks: 0, impressions: 0, ctr: 0, position: 0 };

async function fetchSearchConsole(auth: InstanceType<typeof google.auth.JWT>) {
  const siteUrl = process.env.SEARCH_CONSOLE_SITE_URL;
  if (!siteUrl) throw new HttpError(503, 'SEARCH_CONSOLE_SITE_URL is not configured.');

  const searchconsole = google.searchconsole({ version: 'v1', auth });
  // Search Console data typically lags 2-3 days behind real time, so end
  // ranges a few days back rather than "today" to avoid an artificially
  // low, still-incomplete final day skewing the numbers.
  const lagEnd = daysAgoISO(3);

  const summary = (
    rows: { clicks?: number | null; impressions?: number | null; ctr?: number | null; position?: number | null }[] | undefined
  ): ScSummary => {
    const r = rows?.[0];
    return { clicks: r?.clicks ?? 0, impressions: r?.impressions ?? 0, ctr: r?.ctr ?? 0, position: r?.position ?? 0 };
  };

  const query = (startDate: string, endDate: string) =>
    startDate > endDate
      ? Promise.resolve(null)
      : searchconsole.searchanalytics.query({ siteUrl, requestBody: { startDate, endDate } });

  const thisMonthStart = thisMonthStartISO();
  const lastMonthStart = lastMonthStartISO();
  // Cap month-end dates at the lag cutoff -- relevant in the first few days
  // of a new month, when even "last month" might not be fully processed yet.
  const lastMonthEnd = lastMonthEndISO() < lagEnd ? lastMonthEndISO() : lagEnd;
  const thisMonthEnd = lagEnd;

  const [last7, last28, thisMonthRes, lastMonthRes, topQueries] = await Promise.all([
    query(daysAgoISO(10), lagEnd),
    query(daysAgoISO(31), lagEnd),
    query(thisMonthStart, thisMonthEnd),
    query(lastMonthStart, lastMonthEnd),
    searchconsole.searchanalytics.query({
      siteUrl,
      requestBody: { startDate: daysAgoISO(31), endDate: lagEnd, dimensions: ['query'], rowLimit: 5 },
    }),
  ]);

  return {
    last7Days: last7 ? summary(last7.data.rows) : ZERO_SC_SUMMARY,
    last28Days: last28 ? summary(last28.data.rows) : ZERO_SC_SUMMARY,
    thisMonth: thisMonthRes ? summary(thisMonthRes.data.rows) : ZERO_SC_SUMMARY,
    lastMonth: lastMonthRes ? summary(lastMonthRes.data.rows) : ZERO_SC_SUMMARY,
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
