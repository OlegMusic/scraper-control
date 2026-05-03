import { Router } from 'express';
import {
  loadProxyConfig, configExists, getConfigPath,
  buildProxyUrl, testProxy, launchBrowserWithProxy,
  COMMON_COUNTRIES,
} from '../proxy.js';

const r = Router();

function maskedConfig() {
  const cfg = loadProxyConfig();
  if (!cfg) return null;
  return {
    enabled: cfg.enabled,
    username: cfg.username,
    passwordPreview: cfg.password ? `${cfg.password.slice(0, 2)}…${cfg.password.slice(-2)}` : '',
    defaultCountry: cfg.defaultCountry,
    stickyByDefault: cfg.stickyByDefault,
    stickyLifetime: cfg.stickyLifetime,
    gatewayHost: cfg.gatewayHost,
    gatewayPort: cfg.gatewayPort,
    rotatingHost: cfg.rotatingHost,
    rotatingPort: cfg.rotatingPort,
    apiTokenConfigured: !!cfg.apiToken,
  };
}

r.get('/status', (_req, res) => {
  res.json({
    configFile: getConfigPath(),
    fileExists: configExists(),
    config: maskedConfig(),
    countries: COMMON_COUNTRIES,
  });
});

r.post('/test', async (req, res) => {
  const cfg = loadProxyConfig();
  if (!cfg) return res.status(400).json({ ok: false, error: 'IPRoyal не настроен. Открой iproyal-config.json и впиши username + password.' });
  const result = await testProxy(cfg, {
    country: req.body?.country,
    sticky: req.body?.sticky,
  });
  res.json(result);
});

r.post('/launch-browser', async (req, res) => {
  const cfg = loadProxyConfig();
  if (!cfg) return res.status(400).json({ ok: false, error: 'IPRoyal не настроен.' });
  const result = await launchBrowserWithProxy(cfg, {
    country: req.body?.country,
    sticky: req.body?.sticky ?? true,
    lifetime: req.body?.lifetime || cfg.stickyLifetime,
    sessionId: req.body?.sessionId,
  });
  res.json(result);
});

r.get('/build-url-preview', (req, res) => {
  // Возвращает proxy URL с замаскированным паролем — для UI preview
  const cfg = loadProxyConfig();
  if (!cfg) return res.json({ url: null });
  const url = buildProxyUrl(cfg, {
    country: String(req.query.country || cfg.defaultCountry),
    sticky: req.query.sticky === 'true',
  });
  // Mask password in preview
  const masked = url.replace(/:[^@]+@/, ':****@');
  res.json({ url: masked });
});

export default r;
