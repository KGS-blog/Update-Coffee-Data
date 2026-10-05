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
const cleanDate = (value, precision) => {
  if (!value) return '';
  const text = String(value).trim();
  if (precision === 'year') {
    const year = text.match(/20\d{2}/);
    return year ? year[0] : '';
  }
  if (precision === 'month') {
    const month = text.match(/(20\d{2})[-/.](\d{1,2})/);
    return month && Number(month[2]) >= 1 && Number(month[2]) <= 12
      ? `${month[1]}-${String(month[2]).padStart(2, '0')}` : '';
  }
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
  if (!url || !title) return null;
  // Treat the upstream relevance label as audit metadata, never as a gate.
  // Screen the actual title, description, excerpt and fetched coffee context.
  const material = `${title} ${raw.source_description || ''} ${raw.content_excerpt || ''} ${raw.coffee_relevance_context || ''}`;
  const coffeeSignal = /\b(kopi|coffee|coffea|arabica|robusta|espresso|café|cafe|green\s+bean|biji kopi|coffeehouse|coffee shop|coffeehouse chain|coffee shop chain)\b/i.test(material);
  if (!coffeeSignal) return null;
  const date = cleanDate(raw.source_published_date, raw.publication_date_precision) || cleanDate(raw.published_date, raw.publication_date_precision);
  const precision = raw.publication_date_precision || (/^20\d{2}$/.test(date) ? 'year' : /^20\d{2}-\d{2}$/.test(date) ? 'month' : date ? 'day' : null);
  const excerpt = String(raw.content_excerpt || raw.source_description || '').replace(/\s+/g, ' ').trim().slice(0, 360);
  return {
    judul: title,
    tautan: url,
    tanggal: date,
    publication_date_precision: precision,
    publication_date_evidence: raw.publication_date_evidence || null,
    sumber: sourceName(raw, url),
    ringkasan: excerpt,
    coffee_relevance_context: String(raw.coffee_relevance_context || '').slice(0, 1100),
    link_type: 'publisher_article',
    source_type: 'cie_curated_reference',
    source_original_url: directUrl(raw.url) || url,
    source_content_sha256: raw.content_sha256 || null,
    extraction_status: raw.extraction_status || 'not_attempted',
    source_relevance: String(raw.relevance || 'UNLABELED').toUpperCase(),
    relevance_status: 'passed_kabar_kopi_fulltext_coffee_signal',
    cluster_id: 'lainnya',
    cluster_name: 'Lainnya',
    cluster_assignment: 'unassigned',
    cluster_review_version: 0
  };
};
const articleKey = article => identityKey(article.tautan || article.link || article.url);
const digest = article => String(article.source_content_sha256 || '').toLowerCase();
const archiveMonth = article => article.publication_date_precision === 'year'
  ? `${article.tanggal}-01`
  : String(article.tanggal || '').slice(0, 7);

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
const rejected = { no_public_url_or_title: 0, no_independent_coffee_signal: 0, duplicate_url_title_or_content: 0 };

for (const raw of corpus.articles) {
  const candidate = toPublicArticle(raw);
  if (!candidate) {
    if (!directUrl(raw.resolved_url || raw.url) || !(raw.source_title || raw.title)) rejected.no_public_url_or_title++;
    else rejected.no_independent_coffee_signal++;
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

const eligibleByKey = new Map(eligible.map(article => [articleKey(article), article]));
// Reconcile earlier runs when date enrichment or the independent coffee
// relevance screen changes a reference's destination or eligibility.
const beforeFeedReferenceCount = feed.artikel.filter(article => article.source_type === 'cie_curated_reference').length;
feed.artikel = feed.artikel.filter(article => article.source_type !== 'cie_curated_reference' || eligibleByKey.has(articleKey(article)));
const staleFeedReferencesRemoved = beforeFeedReferenceCount - feed.artikel.filter(article => article.source_type === 'cie_curated_reference').length;

for (const file of fs.readdirSync(path.join(DATA, 'arsip')).filter(name => /^berita-\d{4}-\d{2}\.json$/.test(name))) {
  const archivePath = path.join(DATA, 'arsip', file);
  const archive = read(archivePath, { artikel: [] });
  if (!Array.isArray(archive.artikel)) continue;
  const before = archive.artikel.length;
  archive.artikel = archive.artikel.filter(article => {
    if (article.source_type !== 'cie_curated_reference') return true;
    const candidate = eligibleByKey.get(articleKey(article));
    return !!candidate && !!candidate.tanggal && archiveMonth(candidate) === file.slice(7, 14);
  });
  if (archive.artikel.length !== before) {
    if (archive.artikel.length) write(archivePath, archive);
    else fs.unlinkSync(archivePath);
  } else if (!archive.artikel.length) {
    fs.unlinkSync(archivePath);
  }
}

// Store dated sources under their real publication month. Undated material is
// still retained in a clearly labeled reference archive rather than assigned
// an invented date.
const undated = read(UNDATED_ARCHIVE_PATH, { archive_type: 'undated_curated_references', artikel: [] });
if (!Array.isArray(undated.artikel)) undated.artikel = [];
const beforeUndatedReferenceCount = undated.artikel.length;
undated.artikel = undated.artikel.filter(article => {
  if (article.source_type !== 'cie_curated_reference') return true;
  const candidate = eligibleByKey.get(articleKey(article));
  return !!candidate && !candidate.tanggal;
});
const undatedReferencesRemoved = beforeUndatedReferenceCount - undated.artikel.length;
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
    const month = archiveMonth(article);
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
  dated_candidates: eligible.filter(article => article.tanggal).length,
  undated_candidates: eligible.filter(article => !article.tanggal).length,
  removed_from_undated_archive: undatedReferencesRemoved,
  removed_stale_cie_references_from_feed: staleFeedReferencesRemoved,
  added_to_searchable_feed_this_run: addedToFeed,
  rejected
};
write(FEED_PATH, feed);
write(UNDATED_ARCHIVE_PATH, undated);
const archiveDir = path.join(DATA, 'arsip');
const months = fs.readdirSync(archiveDir).filter(name => /^berita-\d{4}-\d{2}\.json$/.test(name)).sort().map(file => {
  const doc = read(path.join(archiveDir, file), { artikel: [] });
  return { month: file.match(/\d{4}-\d{2}/)[0], file: `arsip/${file}`, articles: Array.isArray(doc.artikel) ? doc.artikel.length : 0 };
});
write(path.join(archiveDir, 'index.json'), {
  version: 1,
  generated_at: new Date().toISOString(),
  months,
  reference_collection: undated.artikel.length
    ? { label: 'Referensi kopi tanpa tanggal publikasi', label_en: 'Coffee references without a publication date', file: 'arsip/berita-reference-undated.json', articles: undated.artikel.length }
    : null
});
console.log(`Curated coffee references: ${eligible.length} passed relevance and URL checks; ${addedToFeed} added to searchable/clustering feed; ${addedToArchives} added to persistent archives; ${JSON.stringify(rejected)}.`);
