/**
 * Google Ads API client — pull search volume + historical metrics for keywords.
 *
 * Wrapper над google-ads-api npm package. Использует developer token + OAuth refresh.
 *
 * Phase 0: skeleton с graceful fallback. Если креды не заданы — возвращает stub data
 * для разработки UI без живых API.
 *
 * Setup credentials в .env (server/.env или parser-firecrawl/.env):
 *   GOOGLE_ADS_DEVELOPER_TOKEN
 *   GOOGLE_ADS_CLIENT_ID, GOOGLE_ADS_CLIENT_SECRET, GOOGLE_ADS_REFRESH_TOKEN
 *   GOOGLE_ADS_LOGIN_CUSTOMER_ID  (MCC ID, без дефисов)
 *
 * Заявка на developer token: https://ads.google.com/aw/apicenter (1-7 дней)
 * Без active spending — volumes возвращаются в диапазонах (1k-10k), не точные.
 */

export interface KeywordMetrics {
  keyword: string;
  avgMonthlySearches: number;
  searchesByMonth: Array<{ month: string; count: number }>;
  competitionIndex: number;        // 0-100
  competitionLevel: 'LOW' | 'MEDIUM' | 'HIGH' | 'UNSPECIFIED' | 'UNKNOWN';
  bidLowMicros: number;            // top of page bid в micros (0.01 EUR = 10000 micros)
  bidHighMicros: number;
}

export interface GoogleAdsConfig {
  developerToken?: string;
  clientId?: string;
  clientSecret?: string;
  refreshToken?: string;
  loginCustomerId?: string;
}

export function getConfig(): GoogleAdsConfig {
  return {
    developerToken: process.env.GOOGLE_ADS_DEVELOPER_TOKEN,
    clientId: process.env.GOOGLE_ADS_CLIENT_ID,
    clientSecret: process.env.GOOGLE_ADS_CLIENT_SECRET,
    refreshToken: process.env.GOOGLE_ADS_REFRESH_TOKEN,
    loginCustomerId: process.env.GOOGLE_ADS_LOGIN_CUSTOMER_ID,
  };
}

export function isConfigured(): boolean {
  const c = getConfig();
  return !!(c.developerToken && c.clientId && c.clientSecret && c.refreshToken && c.loginCustomerId);
}

/**
 * Тянет historical metrics для batch keywords. Geo: Germany (2276), Lang: German (1001).
 * Если креды не заданы — возвращает stub (нули + случайный random для UI demo).
 */
export async function getKeywordMetrics(keywords: string[]): Promise<KeywordMetrics[]> {
  if (!isConfigured()) {
    // Stub mode — для разработки UI до получения tokens
    return keywords.map(k => ({
      keyword: k,
      avgMonthlySearches: 0,
      searchesByMonth: [],
      competitionIndex: 0,
      competitionLevel: 'UNKNOWN',
      bidLowMicros: 0,
      bidHighMicros: 0,
    }));
  }

  // ── Real API call (Phase 1, when tokens received) ──
  // Импорт делается лениво чтобы не падать на require если пакет не установлен
  let GoogleAdsApi: any;
  try {
    // @ts-ignore — пакет ещё не установлен (Phase 0 skeleton)
    const mod = await import('google-ads-api');
    GoogleAdsApi = mod.GoogleAdsApi;
  } catch {
    console.warn('google-ads-api package not installed — run `npm install google-ads-api`');
    return getKeywordMetrics(keywords); // recurse → stub mode
  }

  const cfg = getConfig();
  const client = new GoogleAdsApi({
    client_id: cfg.clientId!,
    client_secret: cfg.clientSecret!,
    developer_token: cfg.developerToken!,
  });

  const customer = client.Customer({
    customer_id: cfg.loginCustomerId!,
    refresh_token: cfg.refreshToken!,
  });

  // KeywordPlanIdeaService.GenerateKeywordHistoricalMetrics
  // Geo: 2276 = Germany, Language: 1001 = German
  try {
    const response = await customer.keywordPlanIdeas.generateKeywordHistoricalMetrics({
      customer_id: cfg.loginCustomerId!,
      keywords,
      geo_target_constants: ['geoTargetConstants/2276'],
      language: 'languageConstants/1001',
      keyword_plan_network: 'GOOGLE_SEARCH',
      historical_metrics_options: {
        year_month_range: {
          start: { year: new Date().getFullYear() - 1, month: 'JANUARY' },
          end: { year: new Date().getFullYear(), month: getCurrentMonth() },
        },
      },
    });

    return response.results?.map((r: any) => ({
      keyword: r.text,
      avgMonthlySearches: Number(r.keyword_metrics?.avg_monthly_searches || 0),
      searchesByMonth: (r.keyword_metrics?.monthly_search_volumes || []).map((m: any) => ({
        month: `${m.year}-${String(monthToNum(m.month)).padStart(2, '0')}`,
        count: Number(m.monthly_searches || 0),
      })),
      competitionIndex: Number(r.keyword_metrics?.competition_index || 0),
      competitionLevel: r.keyword_metrics?.competition || 'UNKNOWN',
      bidLowMicros: Number(r.keyword_metrics?.low_top_of_page_bid_micros || 0),
      bidHighMicros: Number(r.keyword_metrics?.high_top_of_page_bid_micros || 0),
    })) || [];
  } catch (e: any) {
    console.error('Google Ads API error:', e.message);
    return [];
  }
}

function getCurrentMonth(): string {
  const months = ['JANUARY', 'FEBRUARY', 'MARCH', 'APRIL', 'MAY', 'JUNE',
    'JULY', 'AUGUST', 'SEPTEMBER', 'OCTOBER', 'NOVEMBER', 'DECEMBER'];
  return months[new Date().getMonth()];
}

function monthToNum(month: string): number {
  const map: Record<string, number> = {
    JANUARY: 1, FEBRUARY: 2, MARCH: 3, APRIL: 4, MAY: 5, JUNE: 6,
    JULY: 7, AUGUST: 8, SEPTEMBER: 9, OCTOBER: 10, NOVEMBER: 11, DECEMBER: 12,
  };
  return map[month] || 1;
}
