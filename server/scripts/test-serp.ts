import { scrapeOneSerp, estimateSerpDifficulty, buildUule } from '../src/seo-pipeline/serpScraper.js';
import axios from 'axios';
import { HttpsProxyAgent } from 'https-proxy-agent';
import { loadProxyConfig, buildProxyUrl } from '../src/proxy.js';

async function debugRaw() {
  const cfg = loadProxyConfig();
  if (!cfg) { console.log('no proxy'); return; }
  const proxyUrl = buildProxyUrl(cfg, { country: 'de', sticky: false });
  const agent = new HttpsProxyAgent(proxyUrl);
  const ax = axios.create({ timeout: 30000, httpsAgent: agent, httpAgent: agent, proxy: false });
  const r = await ax.get('https://www.google.de/search?q=maler+kassel+preise&hl=de&gl=de&num=10&gbv=1&pws=0', {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
      'Accept': 'text/html,application/xhtml+xml',
      'Accept-Language': 'de-DE,de;q=0.9,en;q=0.8',
      'Cookie': 'CONSENT=YES+DE.de+V14+BX',
    },
    validateStatus: () => true,
    responseType: 'text',
    transformResponse: [(d) => d],
  });
  const html = String(r.data || '');
  console.log(`status: ${r.status}`);
  console.log(`html length: ${html.length}`);
  console.log(`captcha?: ${/captcha|recaptcha/i.test(html)}`);
  // Sample of result-containing area
  const fs = require('fs');
  fs.writeFileSync('serp-debug.html', html, 'utf-8');
  console.log('written serp-debug.html');
  // Find anchors with /url? prefix (gbv=1 wraps URLs)
  const allAnchors = html.match(/<a[^>]+href="\/url\?[^"]+"/g) || [];
  console.log(`/url? anchors: ${allAnchors.length}`);
  if (allAnchors.length > 0) console.log('sample:', allAnchors[0].slice(0, 200));
}

async function main() {
  if (process.argv.includes('--debug-raw')) {
    await debugRaw();
    return;
  }
  const keyword = process.argv[2] || 'maler und lackierer kassel';
  const city = process.argv[3] || 'Kassel';
  const noProxy = process.argv.includes('--no-proxy');

  console.log(`Test SERP: kw="${keyword}" city="${city}" proxy=${!noProxy}`);
  console.log(`UULE: ${buildUule(city)}`);
  console.log();

  const r = await scrapeOneSerp(keyword, { city, useProxy: !noProxy });
  console.log(`fetchedAt: ${r.fetchedAt.toISOString()}`);
  if (r.errorMessage) {
    console.log(`ERROR: ${r.errorMessage}`);
    return;
  }
  console.log(`features: ${r.features.join(', ') || '(none)'}`);
  console.log(`adCount: ${r.adCount}`);
  console.log(`top-${r.results.length}:`);
  for (const res of r.results) {
    console.log(`  ${res.position}. ${res.domain}`);
    console.log(`     ${res.title.slice(0, 80)}`);
  }
  const diff = estimateSerpDifficulty(r);
  console.log(`\nestimated difficulty: ${diff}/100`);
}

main().catch(e => { console.error(e); process.exit(1); });
