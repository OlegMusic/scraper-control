/**
 * GSC (Google Search Console) API client — read-only для собственных доменов.
 *
 * Phase 0 skeleton с graceful fallback. Feature parity с BBITE's gscClient
 * (одна и та же Service Account JSON может использоваться).
 *
 * Setup в .env:
 *   GOOGLE_SA_KEY_PATH=./.secrets/google-sa.json
 *   GSC_DEFAULT_SITE=sc-domain:bbite.de
 *
 * Service Account должен быть добавлен как Restricted user в GSC site permissions.
 */
import fs from 'fs';
import path from 'path';
import axios from 'axios';

interface GscRow {
  keys: string[];                       // [query, page] если запросили эти dims
  clicks: number;
  impressions: number;
  ctr: number;
  position: number;
}

export interface GscQueryParams {
  siteUrl?: string;                     // default из env
  startDate: string;                    // YYYY-MM-DD
  endDate: string;
  dimensions?: Array<'query' | 'page' | 'country' | 'device'>;
  rowLimit?: number;                    // default 5000, max 25000
}

let cachedToken: { token: string; expiresAt: number } | null = null;

function getServiceAccountPath(): string | null {
  const p = process.env.GOOGLE_SA_KEY_PATH;
  if (!p) return null;
  const abs = path.resolve(p);
  if (!fs.existsSync(abs)) return null;
  return abs;
}

export function isConfigured(): boolean {
  return getServiceAccountPath() !== null;
}

async function getAccessToken(): Promise<string | null> {
  if (cachedToken && cachedToken.expiresAt > Date.now() + 30_000) return cachedToken.token;
  const saPath = getServiceAccountPath();
  if (!saPath) return null;

  let google: any;
  try {
    // @ts-ignore — пакет googleapis опционален (Phase 0)
    google = await import('googleapis');
  } catch {
    console.warn('googleapis package not installed — run `npm install googleapis`');
    return null;
  }

  try {
    const auth = new google.google.auth.JWT({
      keyFile: saPath,
      scopes: ['https://www.googleapis.com/auth/webmasters.readonly'],
    });
    const credentials = await auth.authorize();
    cachedToken = {
      token: credentials.access_token!,
      expiresAt: credentials.expiry_date || Date.now() + 3600_000,
    };
    return cachedToken.token;
  } catch (e: any) {
    console.error('GSC auth failed:', e.message);
    return null;
  }
}

export async function querySearchAnalytics(params: GscQueryParams): Promise<GscRow[]> {
  const token = await getAccessToken();
  if (!token) return [];

  const siteUrl = params.siteUrl || process.env.GSC_DEFAULT_SITE || 'sc-domain:bbite.de';
  const url = `https://www.googleapis.com/webmasters/v3/sites/${encodeURIComponent(siteUrl)}/searchAnalytics/query`;

  try {
    const resp = await axios.post(url, {
      startDate: params.startDate,
      endDate: params.endDate,
      dimensions: params.dimensions || ['query'],
      rowLimit: params.rowLimit || 5000,
    }, {
      headers: { Authorization: `Bearer ${token}` },
      timeout: 30000,
    });
    return (resp.data?.rows || []) as GscRow[];
  } catch (e: any) {
    console.error('GSC query failed:', e.response?.data?.error?.message || e.message);
    return [];
  }
}

/**
 * Helper: получить топ-N запросов за последние N дней.
 */
export async function getTopQueries(daysBack: number = 28, limit: number = 1000) {
  const end = new Date();
  const start = new Date(end.getTime() - daysBack * 86400000);
  const fmt = (d: Date) => d.toISOString().slice(0, 10);
  return querySearchAnalytics({
    startDate: fmt(start),
    endDate: fmt(end),
    dimensions: ['query'],
    rowLimit: limit,
  });
}
