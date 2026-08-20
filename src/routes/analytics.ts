import { Router } from 'express';
import { google } from 'googleapis';
import { prisma } from '../lib/prisma';
import { requireAuth, requireAdminRole } from '../middleware/auth';
import { asyncHandler, HttpError } from '../middleware/error-handler';

export const analyticsRouter = Router();

const SEO_STATS_CACHE_HOURS = 24;

// Moz's free API tier is capped at 50 rows/month, so this is cached in the
// database and only re-fetched once the cache is stale -- never on every
// dashboard load. Falls back to a stale cache entry (flagged as such)
// rather than erroring if a fresh Moz call fails.
async function fetchSeoStats() {
  const domain = process.env.SEO_STATS_DOMAIN;
  const token = process.env.MOZ_API_TOKEN;
  if (!domain || !token) return null;

  const cached = await prisma.seoStatsCache.findUnique({ where: { domain } });
  const cacheAgeHours = cached ? (Date.now() - cached.fetchedAt.getTime()) / (1000 * 60 * 60) : Infinity;

  if (cached && cacheAgeHours < SEO_STATS_CACHE_HOURS) {
    return { ...cached, stale: false };
  }

  try {
    const res = await fetch('https://lsapi.seomoz.com/v2/url_metrics', {
      method: 'POST',
      headers: { Authorization: `Basic ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ targets: [`https://${domain}/`] }),
    });
    if (!res.ok) throw new Error(`Moz API responded with ${res.status}`);
    const data = (await res.json()) as { results?: Record<string, number>[] };
    const result = data.results?.[0];
    if (!result) throw new Error('Moz API returned no results');

    const fresh = await prisma.seoStatsCache.upsert({
      where: { domain },
      create: {
        domain,
        domainAuthority: result.domain_authority ?? null,
        pageAuthority: result.page_authority ?? null,
        spamScore: result.spam_score ?? null,
        linkingRootDomains: result.root_domains_to_root_domain ?? null,
        externalBacklinks: result.external_pages_to_root_domain ?? null,
        fetchedAt: new Date(),
      },
      update: {
        domainAuthority: result.domain_authority ?? null,
        pageAuthority: result.page_authority ?? null,
        spamScore: result.spam_score ?? null,
        linkingRootDomains: result.root_domains_to_root_domain ?? null,
        externalBacklinks: result.external_pages_to_root_domain ?? null,
        fetchedAt: new Date(),
      },
    });
    return { ...fresh, stale: false };
  } catch (err) {
    // A stale cached value beats no value at all -- Moz's quota is scarce
    // enough that a transient failure shouldn't blank out the widget.
    if (cached) return { ...cached, stale: true };
    throw err;
  }
}

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

// Start-of-month date N months back -- GA4's dateRanges only accept
// explicit YYYY-MM-DD, "NdaysAgo", "yesterday", or "today" (no "NmonthsAgo").
function monthsAgoStartISO(n: number): string {
  const now = new Date();
  const targetMonthIndex = now.getUTCMonth() - n;
  const yearOffset = Math.floor(targetMonthIndex / 12);
  const normalizedMonth = ((targetMonthIndex % 12) + 12) % 12;
  return `${now.getUTCFullYear() + yearOffset}-${pad(normalizedMonth + 1)}-01`;
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

  const [last7, last30, thisMonth, lastMonth, topPages, monthly] = await Promise.all([
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
    // Month-by-month trend for the Traffic Overview chart -- yearMonth
    // gives one row per calendar month directly, no need for 12 separate
    // date-range calls.
    analyticsData.properties.runReport({
      property,
      requestBody: {
        dateRanges: [{ startDate: monthsAgoStartISO(11), endDate: 'today' }],
        dimensions: [{ name: 'yearMonth' }],
        metrics: [{ name: 'sessions' }],
        orderBys: [{ dimension: { dimensionName: 'yearMonth' } }],
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

  const MONTH_LABELS = [
    'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
  ];

  return {
    last7Days: summary(last7.data.rows as Ga4Row[]),
    last30Days: summary(last30.data.rows as Ga4Row[]),
    thisMonth: summary(thisMonth.data.rows as Ga4Row[]),
    lastMonth: summary(lastMonth.data.rows as Ga4Row[]),
    topPages: ((topPages.data.rows as Ga4Row[]) || []).map((row) => ({
      path: row.dimensionValues?.[0]?.value ?? '',
      pageviews: Number(row.metricValues?.[0]?.value ?? 0),
    })),
    monthlyTrend: ((monthly.data.rows as Ga4Row[]) || []).map((row) => {
      const yearMonth = row.dimensionValues?.[0]?.value ?? '';
      const year = yearMonth.slice(0, 4);
      const monthIndex = Number(yearMonth.slice(4, 6)) - 1;
      return {
        month: year && yearMonth.length === 6 ? `${year}-${yearMonth.slice(4, 6)}` : yearMonth,
        label: monthIndex >= 0 && monthIndex < 12 ? `${MONTH_LABELS[monthIndex]} ${year.slice(2)}` : yearMonth,
        sessions: Number(row.metricValues?.[0]?.value ?? 0),
      };
    }),
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

  const [last7, last28, thisMonthRes, lastMonthRes, topQueries, topPages] = await Promise.all([
    query(daysAgoISO(10), lagEnd),
    query(daysAgoISO(31), lagEnd),
    query(thisMonthStart, thisMonthEnd),
    query(lastMonthStart, lastMonthEnd),
    searchconsole.searchanalytics.query({
      siteUrl,
      requestBody: { startDate: daysAgoISO(31), endDate: lagEnd, dimensions: ['query'], rowLimit: 5 },
    }),
    searchconsole.searchanalytics.query({
      siteUrl,
      requestBody: { startDate: daysAgoISO(31), endDate: lagEnd, dimensions: ['page'], rowLimit: 5 },
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
    topPages: (topPages.data.rows || []).map((row) => ({
      page: row.keys?.[0] ?? '',
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

    const [analyticsResult, searchConsoleResult, seoStatsResult] = await Promise.allSettled([
      fetchGa4(auth),
      fetchSearchConsole(auth),
      fetchSeoStats(),
    ]);

    res.json({
      analytics: analyticsResult.status === 'fulfilled' ? analyticsResult.value : null,
      analyticsError: analyticsResult.status === 'rejected' ? String(analyticsResult.reason?.message || analyticsResult.reason) : null,
      searchConsole: searchConsoleResult.status === 'fulfilled' ? searchConsoleResult.value : null,
      searchConsoleError:
        searchConsoleResult.status === 'rejected' ? String(searchConsoleResult.reason?.message || searchConsoleResult.reason) : null,
      seoStats: seoStatsResult.status === 'fulfilled' ? seoStatsResult.value : null,
      seoStatsError: seoStatsResult.status === 'rejected' ? String(seoStatsResult.reason?.message || seoStatsResult.reason) : null,
    });
  })
);
