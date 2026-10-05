// Add the user's curated Coffee Intelligence Engine corpus to the searchable
// article collection and its dated/undated archive. No full article text is
// copied: only source metadata and a short excerpt are published.
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const DATA = path.join(ROOT, 'data');
const CORPUS_PATH = path.join(DATA, 'coffee-reference-articles.json');
const FEED_PATH = path.join(DATA, 'berita-all.json');
const UNDATED_ARCHIVE_PATH = path.join(DATA, 'arsip', 'berita-reference-undated.json');

const read = (file, fallback) => {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); }
  catch (_) { return fallback; }
};
const write = (file, value) => {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(value, null, 2) + '\n');
};
const normalizeUrl = value => {
  try {
    const url = new URL(String(value || '').trim());
    if (!['http:', 'https:'].includes(url.protocol)) return '';
    url.hash = '';
    url.hostname = url.hostname.toLowerCase().replace(/^www\./, '');
    if ((url.protocol === 'https:' && url.port === '443') || (url.protocol === 'http:' && url.port === '80')) url.port = '';
    url.pathname = url.pathname.replace(/\/{2,}/g, '/').replace(/\/$/, '');
    const entries = [...url.searchParams.entries()]
      .filter(([key]) => !/^utm_/i.test(key) && !['fbclid', 'gclid', 'mc_cid', 'mc_eid'].includes(key.toLowerCase()))
      .sort(([ak, av], [bk, bv]) => ak.localeCompare(bk) || av.localeCompare(bv));
    url.search = '';
    for (const [key, value] of entries) url.searchParams.append(key, value);
    return url.toString().replace(/\/$/, '');
  } catch (_) { return ''; }
};
const identityKey = value => {
  const normalized = normalizeUrl(value);
  if (!normalized) return '';
  const url = new URL(normalized);
  const ojs = url.pathname.match(/^(.*?\/article)\/(?:view|download)\/(\d+)(?:\/.*)?$/i);
  return ojs ? `${url.hostname}${ojs[1].toLowerCase()}/id/${ojs[2]}` : normalized;
};
const titleKey = value => String(value || '').normalize('NFKC').toLocaleLowerCase()
  .replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
const cleanDate = value => {
  if (!value) return '';
  const time = Date.parse(String(value));
  return Number.isFinite(time) ? new Date(time).toISOString() : '';
};
const directUrl = value => {
  const normalized = normalizeUrl(value);
  if (!normalized) return '';
  const host = new URL(normalized).hostname.toLowerCase();
  return host === 'news.google.com' || host === 'google.com' || host.endsWith('.google.com') ? '' : normalized;
};
const sourceName = (article, url) => {
  const named = article.source_name || article.publisher;
  if (named) return String(named).replace(/\s+/g, ' ').trim().slice(0, 120);
  try { return new URL(url).hostname.replace(/^www\./, ''); }
  catch (_) { return 'Sumber penerbit'; }
};
const toPublicArticle = raw => {
  const url = directUrl(raw.resolved_url || raw.url);
  // Keep the curated title as display title. Some publisher pages repeat the
  // same text in both <title> and Open Graph metadata during extraction.
  const title = String(raw.title || raw.source_title || '').replace(/\s+/g, ' ').trim();
  if (!url || !title || !['CORE', 'MIXED'].includes(String(raw.relevance || '').toUpperCase())) return null;
  // Mixed-focus records only pass the second screen when the retrieved title
  // or excerpt contains an explicit coffee signal. CORE is the source engine's
  // already validated high-relevance class and remains eligible.
  const material = `${title} ${raw.content_excerpt || raw.source_description || ''}`;
  const coffeeSignal = /\b(kopi|coffee|coffea|arabica|robusta|espresso|café|cafe|green bean|biji kopi|coffeehouse|coffee shop)\b/i.test(material);
  if (String(raw.relevance).toUpperCase() === 'MIXED' && !coffeeSignal) return null;
  const date = cleanDate(raw.source_published_date) || cleanDate(raw.published_date);
  const excerpt = String(raw.content_excerpt || raw.source_description || '').replace(/\s+/g, ' ').trim().slice(0, 360);
  return {
    judul: title,
    tautan: url,
    tanggal: date,
    sumber: sourceName(raw, url),
    ringkasan: excerpt,
    link_type: 'publisher_article',
    source_type: 'cie_curated_reference',
    source_original_url: directUrl(raw.url) || url,
    source_content_sha256: raw.content_sha256 || null,
    extraction_status: raw.extraction_status || 'not_attempted',
    source_relevance: String(raw.relevance).toUpperCase(),
    relevance_status: String(raw.relevance).toUpperCase() === 'CORE' ? 'passed_cie_core' : 'passed_cie_mixed_keyword_rescreen',
    cluster_id: 'lainnya',
    cluster_name: 'Lainnya',
    cluster_assignment: 'unassigned',
    cluster_review_version: 0
  };
};
const articleKey = article => identityKey(article.tautan || article.link || article.url);
const digest = article => String(article.source_content_sha256 || '').toLowerCase();

const corpus = read(CORPUS_PATH, null);
if (!corpus || !Array.isArray(corpus.articles)) throw new Error('Corpus referensi tidak tersedia atau format articles tidak valid.');
const feed = read(FEED_PATH, { artikel: [] });
if (!Array.isArray(feed.artikel)) feed.artikel = [];

const feedKeys = new Set(feed.artikel.map(articleKey).filter(Boolean));
const feedByKey = new Map(feed.artikel.map(article => [articleKey(article), article]).filter(([key]) => key));
const feedTitles = new Set(feed.artikel.map(article => titleKey(article.judul || article.title)).filter(Boolean));
const feedDigests = new Set(feed.artikel.map(digest).filter(Boolean));
const seenUrl = new Set();
const seenTitle = new Set();
const seenDigest = new Set();
const eligible = [];
const rejected = { no_public_url_or_title: 0, relevance: 0, mixed_without_coffee_signal: 0, duplicate_url_title_or_content: 0 };

for (const raw of corpus.articles) {
  const candidate = toPublicArticle(raw);
  if (!candidate) {
    if (!directUrl(raw.resolved_url || raw.url) || !(raw.source_title || raw.title)) rejected.no_public_url_or_title++;
    else if (!['CORE', 'MIXED'].includes(String(raw.relevance || '').toUpperCase())) rejected.relevance++;
    else rejected.mixed_without_coffee_signal++;
    continue;
  }
  const key = articleKey(candidate), title = titleKey(candidate.judul), hash = digest(candidate);
  const sameExistingReference = feedByKey.get(key)?.source_type === 'cie_curated_reference';
  if ((feedKeys.has(key) && !sameExistingReference) || (feedTitles.has(title) && !sameExistingReference)
    || (hash && ((!sameExistingReference && feedDigests.has(hash)) || seenDigest.has(hash))) || seenUrl.has(key) || seenTitle.has(title)) {
    rejected.duplicate_url_title_or_content++;
    continue;
  }
  seenUrl.add(key);
  seenTitle.add(title);
  if (hash) seenDigest.add(hash);
  eligible.push(candidate);
}

// Store dated sources under their real publication month. Undated material is
// still retained in a clearly labeled reference archive rather than assigned
// an invented date.
const undated = read(UNDATED_ARCHIVE_PATH, { archive_type: 'undated_curated_references', artikel: [] });
if (!Array.isArray(undated.artikel)) undated.artikel = [];
const undatedByKey = new Map(undated.artikel.map((article, index) => [articleKey(article), index]).filter(([key]) => key));
let addedToFeed = 0, addedToArchives = 0, updatedArchives = 0;
for (const article of eligible) {
  const key = articleKey(article);
  const existingIndex = feed.artikel.findIndex(existing => articleKey(existing) === key);
  if (existingIndex < 0) { feed.artikel.push(article); addedToFeed++; }
  else if (feed.artikel[existingIndex].source_type === 'cie_curated_reference') {
    const old = feed.artikel[existingIndex];
    Object.assign(old, article, {
      cluster_id: old.cluster_id || article.cluster_id,
      cluster_name: old.cluster_name || article.cluster_name,
      cluster_assignment: old.cluster_assignment || article.cluster_assignment,
      cluster_review_version: old.cluster_review_version || 0
    });
  }

  if (article.tanggal) {
    const month = article.tanggal.slice(0, 7);
    const archivePath = path.join(DATA, 'arsip', `berita-${month}.json`);
    const archive = read(archivePath, { bulan: month, artikel: [] });
    if (!Array.isArray(archive.artikel)) archive.artikel = [];
    const byKey = new Map(archive.artikel.map((item, index) => [articleKey(item), index]).filter(([itemKey]) => itemKey));
    if (!byKey.has(key)) { archive.artikel.push(article); addedToArchives++; }
    else {
      const old = archive.artikel[byKey.get(key)];
      if (old.source_type === 'cie_curated_reference') {
        Object.assign(old, article, {
          cluster_id: old.cluster_id || article.cluster_id,
          cluster_name: old.cluster_name || article.cluster_name,
          cluster_assignment: old.cluster_assignment || article.cluster_assignment,
          cluster_review_version: old.cluster_review_version || 0
        });
        updatedArchives++;
      }
    }
    write(archivePath, archive);
  } else if (!undatedByKey.has(key)) {
    undated.artikel.push(article);
    undatedByKey.set(key, undated.artikel.length - 1);
    addedToArchives++;
  } else {
    const old = undated.artikel[undatedByKey.get(key)];
    if (old.source_type === 'cie_curated_reference') Object.assign(old, article, {
      cluster_id: old.cluster_id || article.cluster_id,
      cluster_name: old.cluster_name || article.cluster_name,
      cluster_assignment: old.cluster_assignment || article.cluster_assignment,
      cluster_review_version: old.cluster_review_version || 0
    });
  }
}

feed.artikel.sort((a, b) => (Date.parse(b.tanggal || b.pubDate || '') || 0) - (Date.parse(a.tanggal || a.pubDate || '') || 0));
feed.fetched = feed.fetched || new Date().toISOString();
feed.reference_ingest = {
  source: 'KGS-blog/coffee-intelligence-engine/exports/coffee_relevant_articles.json',
  imported_at: new Date().toISOString(),
  source_records: corpus.articles.length,
  accepted_candidates: eligible.length,
  added_to_searchable_feed_this_run: addedToFeed,
  rejected
};
write(FEED_PATH, feed);
write(UNDATED_ARCHIVE_PATH, undated);
console.log(`Curated coffee references: ${eligible.length} passed relevance and URL checks; ${addedToFeed} added to searchable/clustering feed; ${addedToArchives} added to persistent archives; ${JSON.stringify(rejected)}.`);
