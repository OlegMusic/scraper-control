import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { spawn } from 'child_process';
import axios from 'axios';
import { HttpsProxyAgent } from 'https-proxy-agent';
import * as ProxyChain from 'proxy-chain';

/**
 * IPRoyal residential proxy integration.
 *
 * URL формат:
 *   http://USERNAME:PASSWORD_country-XX[_session-AAAAAAAA][_lifetime-10m]@HOST:PORT
 *
 * Sticky session = тот же IP в течение lifetime; rotating = новый IP на каждый запрос.
 *
 * Config в scraper-control/iproyal-config.json (gitignored, plain JSON чтобы юзер
 * мог открыть и вставить ключи без вступления в UI).
 */

export interface IPRoyalConfig {
  enabled: boolean;
  username: string;
  password: string;
  defaultCountry: string;       // ISO-2: de, us, gb...
  stickyByDefault: boolean;
  stickyLifetime: string;       // 1m, 10m, 2h, 24h
  gatewayHost: string;          // geo.iproyal.com (sticky)
  gatewayPort: number;          // 12321
  rotatingHost: string;         // proxy.iproyal.com (rotating)
  rotatingPort: number;
  apiToken?: string;            // для resi-api.iproyal.com (статистика, чек квоты)
}

const CONFIG_PATH = path.resolve(process.cwd(), '..', 'iproyal-config.json');

export function loadProxyConfig(): IPRoyalConfig | null {
  if (!fs.existsSync(CONFIG_PATH)) return null;
  try {
    const raw = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf-8'));
    if (!raw.username || raw.username.startsWith('PASTE_')) return null;
    if (!raw.password || raw.password.startsWith('PASTE_')) return null;
    return {
      enabled: raw.enabled !== false,
      username: raw.username,
      password: raw.password,
      defaultCountry: (raw.defaultCountry || 'de').toLowerCase(),
      stickyByDefault: raw.stickyByDefault !== false,
      stickyLifetime: raw.stickyLifetime || '10m',
      gatewayHost: raw.gatewayHost || 'geo.iproyal.com',
      gatewayPort: raw.gatewayPort || 12321,
      rotatingHost: raw.rotatingHost || 'proxy.iproyal.com',
      rotatingPort: raw.rotatingPort || 12321,
      apiToken: raw.apiToken,
    };
  } catch {
    return null;
  }
}

export function getConfigPath(): string { return CONFIG_PATH; }
export function configExists(): boolean { return fs.existsSync(CONFIG_PATH); }

export interface ProxyOptions {
  country?: string;             // override
  sticky?: boolean;             // override
  lifetime?: string;            // override
  sessionId?: string;           // если не задан — генерируется
}

/**
 * Строит full proxy URL: http://user:pass_country-de_session-xxxx_lifetime-10m@host:port
 */
export function buildProxyUrl(cfg: IPRoyalConfig, opts: ProxyOptions = {}): string {
  const country = (opts.country || cfg.defaultCountry).toLowerCase();
  const sticky = opts.sticky ?? cfg.stickyByDefault;
  const lifetime = opts.lifetime || cfg.stickyLifetime;

  let pwd = cfg.password;
  if (country) pwd += `_country-${country}`;

  if (sticky) {
    const sid = opts.sessionId || crypto.randomBytes(4).toString('hex');
    pwd += `_session-${sid}_lifetime-${lifetime}`;
  }

  const host = sticky ? cfg.gatewayHost : cfg.rotatingHost;
  const port = sticky ? cfg.gatewayPort : cfg.rotatingPort;

  return `http://${encodeURIComponent(cfg.username)}:${encodeURIComponent(pwd)}@${host}:${port}`;
}

/**
 * Тест proxy — фетчит ipv4.icanhazip.com через прокси, возвращает IP + страну.
 */
export async function testProxy(cfg: IPRoyalConfig, opts: ProxyOptions = {}): Promise<{
  ok: boolean; ip?: string; country?: string; latencyMs?: number; error?: string;
}> {
  const proxyUrl = buildProxyUrl(cfg, opts);
  const t0 = Date.now();
  try {
    // axios.proxy для HTTPS-target не работает корректно — используем https-proxy-agent
    const agent = new HttpsProxyAgent(proxyUrl);
    const r = await axios.get('https://ipv4.icanhazip.com', {
      httpsAgent: agent,
      proxy: false, // отключаем встроенный proxy axios
      timeout: 15000,
    });
    const ip = String(r.data).trim();
    let country: string | undefined;
    try {
      const geo = await axios.get(`https://ipinfo.io/${ip}/country`, { timeout: 5000, httpsAgent: agent, proxy: false });
      country = String(geo.data).trim();
    } catch { /* ipinfo rate-limit без токена */ }
    return { ok: true, ip, country, latencyMs: Date.now() - t0 };
  } catch (e: any) {
    return { ok: false, error: e.message?.slice(0, 200) };
  }
}

/**
 * Запускает Chrome с настроенным прокси-сервером. Изолированный профиль чтобы
 * не лезть в существующие пользовательские Chrome-окна.
 */
export interface LaunchBrowserResult {
  ok: boolean;
  pid?: number;
  proxyHost?: string;
  proxyPort?: number;
  country?: string;
  profileDir?: string;
  error?: string;
}

/**
 * Подход: создаём локальный прокси (proxy-chain) на 127.0.0.1:RANDOM_PORT,
 * который сам аутентится upstream в IPRoyal. Chrome подключается к local proxy
 * БЕЗ auth → никакого Basic Auth диалога. Это надёжнее чем MV3 extension hack
 * (Chrome 117+ часто блокирует --load-extension).
 */
export async function launchBrowserWithProxy(
  cfg: IPRoyalConfig,
  opts: ProxyOptions & { browserPath?: string } = {},
): Promise<LaunchBrowserResult> {
  const upstreamUrl = buildProxyUrl(cfg, opts);
  let localProxyUrl: string;
  try {
    localProxyUrl = await ProxyChain.anonymizeProxy(upstreamUrl);
  } catch (e: any) {
    return { ok: false, error: `proxy-chain failed: ${e.message}` };
  }

  const browserPath = opts.browserPath
    || process.env.BROWSER_PATH
    || 'C:/Program Files/Google/Chrome/Application/chrome.exe';

  const profileSuffix = Date.now().toString(36);
  const profileDir = path.resolve(process.cwd(), 'chrome-profiles', `iproyal-${profileSuffix}`);
  fs.mkdirSync(profileDir, { recursive: true });

  const args = [
    `--proxy-server=${localProxyUrl}`,
    `--user-data-dir=${profileDir}`,
    '--no-first-run',
    '--no-default-browser-check',
    '--start-maximized',
    'https://ipinfo.io',
  ];

  try {
    const p = spawn(browserPath, args, { detached: true, stdio: 'ignore' });
    p.unref();
    const upstream = new URL(upstreamUrl);
    return {
      ok: true,
      pid: p.pid,
      proxyHost: upstream.hostname,
      proxyPort: parseInt(upstream.port, 10),
      country: opts.country || cfg.defaultCountry,
      profileDir,
    };
  } catch (e: any) {
    return { ok: false, error: e.message };
  }
}

// Common countries для UI dropdown
export const COMMON_COUNTRIES = [
  { code: 'de', name: 'Germany 🇩🇪' },
  { code: 'us', name: 'United States 🇺🇸' },
  { code: 'gb', name: 'United Kingdom 🇬🇧' },
  { code: 'fr', name: 'France 🇫🇷' },
  { code: 'nl', name: 'Netherlands 🇳🇱' },
  { code: 'at', name: 'Austria 🇦🇹' },
  { code: 'ch', name: 'Switzerland 🇨🇭' },
  { code: 'pl', name: 'Poland 🇵🇱' },
  { code: 'cz', name: 'Czech Rep. 🇨🇿' },
  { code: 'es', name: 'Spain 🇪🇸' },
  { code: 'it', name: 'Italy 🇮🇹' },
  { code: 'be', name: 'Belgium 🇧🇪' },
  { code: 'dk', name: 'Denmark 🇩🇰' },
  { code: 'se', name: 'Sweden 🇸🇪' },
  { code: 'no', name: 'Norway 🇳🇴' },
  { code: 'fi', name: 'Finland 🇫🇮' },
];
