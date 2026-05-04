/**
 * Candidate keyword extractor — извлекает кандидатные ключи из УЖЕ собранных
 * полей провайдера (без новых scrape-запросов):
 *   - provider.description                       — Google Places описание
 *   - provider.websiteText                       — text сайта (если есть)
 *   - provider.siteAnalysis.{textContent,html}   — alt-источник site analyzer'а
 *   - provider.socialContent[].bio               — YT/IG/FB bio (богатый источник)
 *   - provider.socialContent[].displayName       — название аккаунта
 *   - provider.youtubeAbout.description          — descript YT канала (если scrape сделал)
 *   - provider.youtubeVideos[].title             — заголовки YT видео
 *   - provider.importedVideos[].title            — заголовки импортированных видео
 *   - provider.audit.signals.web                 — extracted services из audit'а
 *   - provider.category                          — фолбэк seed
 *
 * Используется в `/api/seo/provider/:id/full` когда global `sc_keywords` для
 * (category, city) пуст или дополняет его. UI показывает их отдельной секцией
 * «Кандидаты — нужна валидация», юзер кликает «годится/мусор» — это идёт в
 * DirectorTraining как kind:'keyword-feedback' с rating +2/-2 и embed-ится в
 * Qdrant. Положительные кандидаты постепенно становятся обычными keywords
 * через ручной promote или автоматическую промоцию (iteration 2).
 */

const GERMAN_STOP_WORDS = new Set([
  'der','die','das','den','dem','des','ein','eine','einer','eines','einem','einen',
  'und','oder','aber','doch','sondern','denn','weil','wenn','ob','dass','daß',
  'ist','sind','war','waren','wird','werden','wurde','wurden','sein','hat','haben',
  'hatte','hatten','wir','sie','er','es','ich','du','ihr','mein','dein','sein',
  'unser','euer','ihr','meine','deine','seine','unsere','eure','ihre',
  'in','an','auf','aus','bei','für','mit','nach','von','vor','zu','zum','zur',
  'durch','über','unter','vom','beim','am','im','ins','aufs','um','gegen','ohne',
  'als','wie','mehr','sehr','auch','noch','schon','nur','doch','aber','jedoch',
  'hier','dort','wo','wer','was','wann','warum','weshalb','welche','welcher','welches',
  'this','that','the','and','or','but','for','with','from','to','of','in','on','at',
  'is','are','was','were','be','been','being','have','has','had','do','does','did',
  'a','an','it','its','i','you','he','she','we','they','our','your','their',
  'kontakt','impressum','datenschutz','agb','startseite','home','about','über',
  'mehr','lesen','klicken','hier','jetzt','heute','morgen','gestern',
  'sie','wir','ihre','unser','sind','haben','können','möchten','wollen','sollen',
  'unserem','unseren','unsere','unseres','seit','während','zwischen','neben',
  'gibt','geben','gibts','machen','macht','lassen','tun','seinen','seiner','seinem',
  'eigene','eigenen','eigener','eigenes','dabei','damit','daran','darauf','darin',
  'cookies','website','seite','impressum','newsletter','telefon','email','adresse',
]);

const NOISE_PATTERNS = [
  /^\d+$/,                            // pure numbers
  /^[\d\s\-\+\(\)]+$/,                // phone-like
  /^[\w._-]+@[\w.-]+\.\w+$/,          // emails
  /^https?:\/\//,                     // URLs
  /^[a-z]{1,2}$/i,                    // 1-2 letter words
];

export interface CandidateKeyword {
  text: string;
  source: 'hwk-gewerke' | 'description' | 'website' | 'site-analysis' | 'social-bio' | 'youtube-about' | 'youtube-titles' | 'audit-services' | 'category';
  weight: number;          // grubo: частота × длина — для сортировки
  context?: string;        // фрагмент исходного текста (опционально для UI)
}

/** Strip HTML if any. Returns plain text. */
function stripHtml(s: string): string {
  return s.replace(/<script[\s\S]*?<\/script>/gi, ' ')
          .replace(/<style[\s\S]*?<\/style>/gi, ' ')
          .replace(/<[^>]+>/g, ' ')
          .replace(/&nbsp;/g, ' ')
          .replace(/&amp;/g, '&')
          .replace(/&[a-z]+;/gi, ' ')
          .replace(/\s+/g, ' ')
          .trim();
}

function isNoise(token: string): boolean {
  if (!token || token.length < 3 || token.length > 60) return true;
  if (GERMAN_STOP_WORDS.has(token.toLowerCase())) return true;
  for (const p of NOISE_PATTERNS) if (p.test(token)) return true;
  return false;
}

/**
 * Извлекает n-grams (1..3 слова) и считает частоты, фильтрует stop-words,
 * возвращает топ по weight (частота × средняя длина токенов).
 */
function extractTopNgrams(text: string, top = 15): Array<{ text: string; weight: number }> {
  const cleaned = text.toLowerCase().replace(/[^\wäöüß\s\-]/giu, ' ').replace(/\s+/g, ' ').trim();
  const tokens = cleaned.split(' ').filter(t => !isNoise(t));
  const counts = new Map<string, number>();

  // unigrams
  for (const t of tokens) counts.set(t, (counts.get(t) || 0) + 1);
  // bigrams + trigrams (более ценные для SEO — это и есть compound queries)
  for (let i = 0; i < tokens.length - 1; i++) {
    const bi = `${tokens[i]} ${tokens[i + 1]}`;
    counts.set(bi, (counts.get(bi) || 0) + 2); // boost
    if (i < tokens.length - 2) {
      const tri = `${tokens[i]} ${tokens[i + 1]} ${tokens[i + 2]}`;
      counts.set(tri, (counts.get(tri) || 0) + 3); // boost больше
    }
  }

  return Array.from(counts.entries())
    .filter(([k, v]) => v >= 2 && k.length >= 4)
    .map(([text, freq]) => ({ text, weight: freq * (1 + Math.log(text.length)) }))
    .sort((a, b) => b.weight - a.weight)
    .slice(0, top);
}

export function extractCandidates(provider: any): CandidateKeyword[] {
  const out: CandidateKeyword[] = [];
  const seen = new Set<string>();
  const push = (text: string, source: CandidateKeyword['source'], weight: number, context?: string) => {
    const key = text.toLowerCase().trim();
    if (!key || seen.has(key)) return;
    seen.add(key);
    out.push({ text: key, source, weight, context });
  };

  // ── 0. HWK Gewerke (юридически зарегистрированные услуги — highest authority) ──
  // Каждый Gewerk → отдельный кандидат с максимальным весом 100 чтобы оказаться
  // в топе. Это primary SEO seed для провайдеров без сайта.
  const hwkItems: string[] = Array.isArray(provider?.handwerkServices?.items)
    ? provider.handwerkServices.items
    : [];
  for (const g of hwkItems) {
    if (typeof g === 'string' && g.length >= 3 && g.length < 100) {
      push(g.toLowerCase(), 'hwk-gewerke', 100);
    }
  }

  // ── 1. Description (Google Places summary, часто содержит услуги) ──
  const desc = provider?.description;
  if (typeof desc === 'string' && desc.length > 30) {
    const ngrams = extractTopNgrams(desc, 8);
    for (const n of ngrams) push(n.text, 'description', n.weight * 1.3); // boost — это уже человеком отредактированный текст
  }

  // ── 2. Website text — если scrape отработал ──
  const wt = provider?.websiteText;
  if (typeof wt === 'string' && wt.length > 50) {
    const plain = stripHtml(wt);
    const ngrams = extractTopNgrams(plain, 15);
    for (const n of ngrams) push(n.text, 'website', n.weight);
  }

  // ── 3. Site analyzer — если сайт reachable, может быть текст ──
  const sa = provider?.siteAnalysis;
  if (sa && sa.reachable) {
    for (const f of ['textContent', 'html', 'mainText', 'extractedText']) {
      const v = sa[f];
      if (typeof v === 'string' && v.length > 50) {
        const plain = stripHtml(v);
        const ngrams = extractTopNgrams(plain, 10);
        for (const n of ngrams) push(n.text, 'site-analysis', n.weight * 0.9);
        break;
      }
    }
  }

  // ── 4. Social content — bio из IG/FB/YT (часто богаче чем сайт) ──
  if (Array.isArray(provider?.socialContent)) {
    for (const sc of provider.socialContent) {
      if (sc?.bio && typeof sc.bio === 'string' && sc.bio.length > 30) {
        const ngrams = extractTopNgrams(sc.bio, 10);
        for (const n of ngrams) push(n.text, 'social-bio', n.weight);
      }
      if (sc?.displayName && typeof sc.displayName === 'string') {
        const ngrams = extractTopNgrams(sc.displayName, 3);
        for (const n of ngrams) push(n.text, 'social-bio', n.weight * 0.7);
      }
    }
  }

  // ── 5. YouTube About description ──
  const ytDesc = provider?.youtubeAbout?.description;
  if (typeof ytDesc === 'string' && ytDesc.length > 30) {
    const ngrams = extractTopNgrams(ytDesc, 8);
    for (const n of ngrams) push(n.text, 'youtube-about', n.weight * 0.8);
  }

  // ── 6. YouTube/imported videos — заголовки часто = описания услуг ──
  const videoTitles: string[] = [];
  if (Array.isArray(provider?.youtubeVideos)) {
    for (const v of provider.youtubeVideos.slice(0, 30)) {
      if (v?.title && typeof v.title === 'string') videoTitles.push(v.title);
    }
  }
  if (Array.isArray(provider?.importedVideos)) {
    for (const v of provider.importedVideos.slice(0, 30)) {
      if (v?.title && typeof v.title === 'string') videoTitles.push(v.title);
    }
  }
  if (videoTitles.length > 0) {
    const joined = videoTitles.join(' . ');
    const ngrams = extractTopNgrams(joined, 8);
    for (const n of ngrams) push(n.text, 'youtube-titles', n.weight * 0.85);
  }

  // ── 7. Audit signals — если auditor извлекал что-то «сервис-подобное» ──
  const auditSvcs = provider?.audit?.signals?.web?.services
    || provider?.audit?.signals?.web?.h1Texts
    || [];
  if (Array.isArray(auditSvcs)) {
    for (const s of auditSvcs.slice(0, 10)) {
      if (typeof s === 'string' && s.length >= 4 && s.length < 80) {
        push(s.toLowerCase(), 'audit-services', 5);
      }
    }
  }

  // ── 8. Category fallback (последний — даёт хоть что-то) ──
  if (provider?.category && out.length < 3) {
    push(String(provider.category).toLowerCase(), 'category', 1);
  }

  return out.slice(0, 25).sort((a, b) => b.weight - a.weight);
}
