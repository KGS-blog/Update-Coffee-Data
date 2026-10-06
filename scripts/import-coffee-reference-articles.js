const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const SOURCE_URL = 'https://api.github.com/repos/KGS-blog/coffee-intelligence-engine/contents/exports/coffee_relevant_articles.json?ref=main';
const GROWTH_SOURCE_URL = 'https://raw.githubusercontent.com/KGS-blog/coffee-feed/main/artikel_pertumbuhan.json';
const OUTPUT = path.join(ROOT, 'data', 'coffee-reference-articles.json');
const UA = { 'User-Agent': 'KabarKopiDataPipeline/1.0' };

function readJson(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); }
  catch (_) { return fallback; }
}

function normalizeUrl(value) {
  try {
    const url = new URL(String(value || '').trim());
    if (!['http:', 'https:'].includes(url.protocol)) return '';
    url.hash = '';
    url.hostname = url.hostname.toLowerCase().replace(/^www\./, '');
    if ((url.protocol === 'https:' && url.port === '443') || (url.protocol === 'http:' && url.port === '80')) url.port = '';
    url.pathname = url.pathname.replace(/\/{2,}/g, '/').replace(/\/$/, '');
    const query = [...url.searchParams.entries()]
      .filter(([key]) => !/^utm_/i.test(key) && !['fbclid', 'gclid', 'mc_cid', 'mc_eid'].includes(key.toLowerCase()))
      .sort(([aKey, aValue], [bKey, bValue]) => aKey.localeCompare(bKey) || aValue.localeCompare(bValue));
    url.search = '';
    for (const [key, val] of query) url.searchParams.append(key, val);
    return url.toString().replace(/\/$/, '');
  } catch (_) { return ''; }
}

function identityKey(urlValue) {
  const raw = String(urlValue || '').trim();
  if (/^upload:[a-f0-9]{32,}$/i.test(raw)) return raw.toLowerCase();
  const normalized = normalizeUrl(urlValue);
  if (!normalized) return '';
  const url = new URL(normalized);
  const ojs = url.pathname.match(/^(.*?\/article)\/(?:view|download)\/(\d+)(?:\/.*)?$/i);
  if (ojs) return `${url.hostname}${ojs[1].toLowerCase()}/id/${ojs[2]}`;
  return normalized;
}

function titleKey(value) {
  return String(value || '').normalize('NFKC').toLocaleLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
}

function rank(article) {
  return (article.relevance === 'CORE' ? 1000000 : 0)
    + (Number(article.evidence_count) || 0) * 1000
    + (Date.parse(article.validated_at) || 0) / 1e12;
}

async function getSource() {
  if (process.env.COFFEE_REFERENCE_SOURCE_FILE) {
    return readJson(process.env.COFFEE_REFERENCE_SOURCE_FILE, null);
  }
  const headers = { ...UA, Accept: 'application/vnd.github.raw+json' };
  if (process.env.COFFEE_ENGINE_READ_TOKEN) headers.Authorization = `Bearer ${process.env.COFFEE_ENGINE_READ_TOKEN}`;
  const response = await fetch(SOURCE_URL, { headers, signal: AbortSignal.timeout(20000) });
  if (!response.ok) throw new Error(`Sumber artikel membalas HTTP ${response.status}`);
  return response.json();
}

async function getGrowthSource() {
  const response = await fetch(GROWTH_SOURCE_URL, { headers: { ...UA, Accept: 'application/json' }, signal: AbortSignal.timeout(20000) });
  if (!response.ok) throw new Error(`Sumber pertumbuhan MEVO membalas HTTP ${response.status}`);
  return response.json();
}

function deduplicate(rows, feedRows) {
  const feedKeys = new Set();
  for (const article of feedRows) {
    const url = article.tautan || article.link || article.url;
    const key = identityKey(url);
    if (key) feedKeys.add(key);
  }

  const sorted = [...rows].sort((a, b) => rank(b) - rank(a));
  const byIdentity = new Map();
  let invalid = 0;
  let overlapsWithFeed = 0;
  let internalFileReferences = 0;
  for (const raw of sorted) {
    const url = normalizeUrl(raw.url);
    const title = String(raw.title || '').trim();
    const internalReference = /^upload:[a-f0-9]{32,}$/i.test(String(raw.url || '').trim());
    if ((!url && !internalReference) || !title) { invalid++; continue; }
    const key = identityKey(raw.url);
    // Keep feed overlaps in the source corpus for future metadata backfills.
    // The merge step deduplicates them before publication.
    if (feedKeys.has(key)) overlapsWithFeed++;
    const current = byIdentity.get(key);
    if (!current) {
      byIdentity.set(key, {
        id: raw.id,
        title,
        url: url || null,
        source_locator: internalReference ? raw.url : undefined,
        availability: internalReference ? 'internal_file_reference_no_public_url' : 'public_link',
        published_date: raw.published_date || null,
        relevance: raw.relevance || 'UNCLASSIFIED',
        relevance_label: raw.relevance_label || '',
        evidence_count: Number(raw.evidence_count) || 0,
        validated_at: raw.validated_at || null,
        source_type: raw.source_collection === 'artikel_pertumbuhan' ? 'mevo_curated_growth' : 'reference_article',
        source_collection: raw.source_collection || 'coffee_relevant_articles',
        material_type: raw.material_type || null
      });
      if (internalReference) internalFileReferences++;
    } else if (!current.published_date && raw.published_date) {
      current.published_date = raw.published_date;
    }
  }

  const articles = [...byIdentity.values()];
  const titles = new Map();
  for (const article of articles) {
    const key = titleKey(article.title);
    if (key) titles.set(key, (titles.get(key) || 0) + 1);
  }
  const sameTitleGroups = [...titles.values()].filter(count => count > 1).length;
  return { articles, invalid, overlapsWithFeed, internalFileReferences, sameTitleGroups };
}

(async () => {
  let source, growthSource;
  try {
    [source, growthSource] = await Promise.all([getSource(), getGrowthSource()]);
  } catch (error) {
    if (fs.existsSync(OUTPUT)) {
      console.warn(`Coffee reference import skipped; retaining existing archive: ${error.message}`);
      return;
    }
    throw error;
  }

  if (!source || !Array.isArray(source.articles)) throw new Error('Format sumber Coffee Intelligence Engine tidak valid: articles harus berupa array.');
  if (!growthSource || !Array.isArray(growthSource.articles)) throw new Error('Format artikel_pertumbuhan.json tidak valid: articles harus berupa array.');
  // Both upstream collections have been screened for coffee relevance by MEVO.
  // Keep relevance labels as provenance metadata; CORE/MIXED is not a gate.
  const engineCandidates = source.articles.filter(Boolean).map(article => ({ ...article, source_collection: 'coffee_relevant_articles' }));
  const growthCandidates = growthSource.articles.filter(Boolean).map(article => ({
    ...article,
    id: `growth-${article.id}`,
    source_collection: 'artikel_pertumbuhan',
    material_type: article.material_type || 'growth'
  }));
  const candidates = [...engineCandidates, ...growthCandidates];
  const latestFeed = readJson(path.join(ROOT, 'data', 'berita-all.json'), { artikel: [] });
  const currentFeed = readJson(path.join(ROOT, 'data', 'berita.json'), { artikel: [] });
  const mergedFeed = [...(latestFeed.artikel || []), ...(currentFeed.artikel || [])];
  const result = deduplicate(candidates, mergedFeed);
  const previousCorpus = readJson(OUTPUT, { articles: [] });
  const previousById = new Map((previousCorpus.articles || []).map(article => [String(article.id), article]));
  const previousByUrl = new Map((previousCorpus.articles || []).filter(article => article.url).map(article => [identityKey(article.url), article]));
  const extractionFields = [
    'extraction_status', 'extracted_at', 'extracted_from_url', 'resolved_url', 'source_content_type',
    'extraction_method', 'source_title', 'source_description', 'source_authors',
    'source_published_date', 'publication_date_precision', 'publication_date_evidence',
    'date_enrichment_version', 'coffee_relevance_context', 'content_char_count', 'content_sha256',
    'content_excerpt', 'exact_content_duplicate_ids', 'source_http_status', 'fetch_error', 'retry_after'
  ];
  for (const article of result.articles) {
    const previous = previousById.get(String(article.id)) || previousByUrl.get(identityKey(article.url));
    if (!previous) continue;
    const sameSource = article.url && (article.url === previous.url || article.url === previous.extracted_from_url);
    if (!sameSource) continue;
    if (!article.published_date && previous.published_date) article.published_date = previous.published_date;
    for (const field of extractionFields) {
      if (previous[field] !== undefined) article[field] = previous[field];
    }
  }
  const output = {
    schema_version: 1,
    collection_type: 'coffee_reference_articles',
    source_repository: 'KGS-blog/coffee-intelligence-engine',
    source_path: ['KGS-blog/coffee-intelligence-engine/exports/coffee_relevant_articles.json', 'KGS-blog/coffee-feed/artikel_pertumbuhan.json'],
    source_generated_at: source.generated_at || null,
    mevo_growth_source: {
      repository: 'KGS-blog/coffee-feed',
      path: 'artikel_pertumbuhan.json',
      generated_at: growthSource.generated_at || null,
      source_records: growthSource.articles.length,
      relevance_labels_retained_as_metadata: true
    },
    fetched_at: new Date().toISOString(),
    content_fetch: previousCorpus.content_fetch || undefined,
    count: result.articles.length,
    note: 'Curated reference corpus. Items without a publication date are not treated as current news, chronological monthly archive entries, or automatic editorial input.',
    deduplication: {
      source_count: candidates.length,
      duplicate_urls_or_article_aliases_removed: candidates.length - result.articles.length - result.invalid,
      overlaps_with_news_feed_retained_for_independent_screening: result.overlapsWithFeed,
      invalid_items_removed: result.invalid,
      internal_file_references_without_public_url: result.internalFileReferences,
      records_without_publication_date: result.articles.filter(article => !article.published_date).length,
      repeated_title_groups_retained_for_review: result.sameTitleGroups
    },
    articles: result.articles
  };

  fs.mkdirSync(path.dirname(OUTPUT), { recursive: true });
  fs.writeFileSync(OUTPUT, JSON.stringify(output));
  console.log(`Coffee reference corpus: ${result.articles.length} records saved (${engineCandidates.length} engine + ${growthCandidates.length} MEVO growth candidates); ${output.deduplication.duplicate_urls_or_article_aliases_removed} URL/article-alias duplicates removed; ${result.overlapsWithFeed} feed overlaps retained for merge deduplication; ${result.sameTitleGroups} repeated-title groups kept because titles alone are not safe deduplication keys.`);
})().catch(error => {
  console.error('Coffee reference import failed:', error.message);
  process.exitCode = 1;
});
