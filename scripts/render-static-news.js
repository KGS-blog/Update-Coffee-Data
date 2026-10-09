// Render the crawlable news fallback while preserving an active bylined feature.
const fs = require('node:fs');
const path = require('node:path');
const { BERITA_KLASTER, clusterBerita } = require('../BERITA_KLASTER_FINAL.js');

const root = path.join(__dirname, '..');
const readJson = (name, fallback) => {
  const file = path.join(root, 'data', name);
  return fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : fallback;
};
const escape = value => String(value ?? '').replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
const dateValue = article => Date.parse(article.tanggal || article.pubDate || '') || 0;
const directUrl = value => {
  try {
    const url = new URL(String(value || ''));
    return url.protocol === 'https:' && !/(^|\.)google\.com$/i.test(url.hostname) && !/(^|\.)news\.google\.com$/i.test(url.hostname);
  } catch (_) { return false; }
};
const direct = (readJson('berita-all.json', { artikel: [] }).artikel || [])
  .filter(article => article.cluster_assignment !== 'editor_irrelevant' && directUrl(article.tautan || article.link))
  .sort((a, b) => dateValue(b) - dateValue(a));
const decisions = readJson('cluster-decisions.json', { overrides: [] });
const overrides = new Map((decisions.overrides || []).map(item => [String(item.url || item.tautan || ''), item.cluster_id || item.klaster]));
const catalog = readJson('cluster-catalog.json', { clusters: BERITA_KLASTER });
global.window = { BERITA_KLASTER: Array.isArray(catalog.clusters) && catalog.clusters.length ? catalog.clusters : BERITA_KLASTER };
const classified = clusterBerita(direct.map(article => {
  const override = overrides.get(String(article.tautan || article.link || ''));
  return override ? { ...article, cluster_id: override, cluster_assignment: 'editor_override' } : article;
}));
delete global.window;
const topicByUrl = new Map();
for (const cluster of classified.klaster || []) for (const article of cluster.items || []) topicByUrl.set(String(article.tautan || article.link || ''), cluster.nama);
for (const article of classified.lainnya_items || []) topicByUrl.set(String(article.tautan || article.link || ''), 'Lainnya');
for (const article of classified.unclassified_items || []) topicByUrl.set(String(article.tautan || article.link || ''), 'Belum diklasifikasikan');
const curated = direct.filter(article => {
  const category = topicByUrl.get(String(article.tautan || article.link || ''));
  return category && !['Lainnya', 'Other', 'Belum diklasifikasikan', 'Unclassified'].includes(category);
});
const visibleNews = curated.slice(0, 5);
const formatDate = (article, locale = 'id-ID') => {
  const value = dateValue(article);
  if (!value) return '';
  const precision = article.publication_date_precision || 'day';
  const options = precision === 'year' ? { year: 'numeric' }
    : precision === 'month' ? { month: 'long', year: 'numeric' }
    : { day: 'numeric', month: 'short', year: 'numeric' };
  return new Intl.DateTimeFormat(locale, { ...options, timeZone: 'Asia/Jakarta' }).format(new Date(value));
};
const sourceOf = article => article.sumber || article.source_name || 'Sumber penerbit';
const categoryOf = article => {
  const name = topicByUrl.get(String(article.tautan || article.link || '')) || 'Berita kopi';
  const translations = { 'Berita kopi': 'Coffee news', 'Kedai, Konsumsi & Gaya Hidup': 'Cafes, Consumption & Lifestyle', 'Event & Kompetisi': 'Events & Competitions', 'Barista & Teknik Seduh': 'Barista & Brewing', 'Ekspor & Daya Saing': 'Exports & Competitiveness', 'Produksi & Panen': 'Production & Harvest', 'Riset & Tren Konsumen': 'Consumer Research & Trends', 'Merek Global': 'Global Brands', 'Harga & Pasar': 'Prices & Markets', 'Kebijakan & Regulasi': 'Policy & Regulation' };
  return `<span class="id-copy">${escape(name)}</span><span class="en-copy">${escape(translations[name] || 'Coffee news')}</span>`;
};
const linkOf = article => article.tautan || article.link;
const titleOf = article => article.judul || article.title || 'Berita kopi terbaru';
const dateForFeature = article => {
  for (const value of [article.kabar_featured_at, article.datePublished]) if (value && Number.isFinite(Date.parse(value))) return new Date(value).toISOString();
  return '';
};
const snapshot = readJson('blog-pillar-articles.json', { articles: [] });
const now = Date.now(), sevenDays = 7 * 24 * 60 * 60 * 1000;
const authorNews = (snapshot.articles || [])
  .filter(article => article.kabar_pillar === 'berita' && String(article.status || '').toLowerCase() === 'published')
  .map(article => ({ article, date: dateForFeature(article) }))
  .filter(item => item.date && Date.parse(item.date) <= now && now - Date.parse(item.date) <= sevenDays)
  .sort((a, b) => Date.parse(b.date) - Date.parse(a.date))[0] || null;
const slugify = value => String(value || '').normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/&/g, ' dan ').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 70) || 'artikel-kopi';
const articlePath = (article, lang) => `/artikel-pilar/${slugify(article.title_id)}-${lang}-${article.id}.html`;
const escapeContent = value => String(value || '').replace(/<[^>]*>/g, ' ').replace(/&nbsp;|&#160;/gi, ' ').replace(/&amp;/gi, '&').replace(/&lt;/gi, '<').replace(/&gt;/gi, '>').replace(/&quot;|&#34;/gi, '"').replace(/&#39;|&apos;/gi, "'").replace(/\s+/g, ' ').trim();
const authorFeature = authorNews ? (() => {
  const article = authorNews.article;
  const publishedAt = new Intl.DateTimeFormat('id-ID', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Asia/Jakarta' }).format(new Date(authorNews.date));
  return `<div class="pillar-article-feature"><div class="eyebrow"><span class="id-copy">Berita terkini · Tulisan penulis</span><span class="en-copy">Latest news · Bylined article</span></div><h3><a class="id-copy" href="${articlePath(article, 'id')}">${escape(article.title_id)}</a><a class="en-copy" href="${articlePath(article, 'en')}">${escape(article.title_en)}</a></h3><p class="pillar-feature-summary"><span class="id-copy">${escape(article.desc_id)}</span><span class="en-copy">${escape(article.desc_en)}</span></p>${article.content_id ? `<p class="pillar-feature-context"><span class="id-copy">${escape(escapeContent((String(article.content_id).match(/<p\b[^>]*>([\s\S]*?)<\/p>/i) || [,''])[1]).slice(0, 240))}</span><span class="en-copy">${escape(escapeContent((String(article.content_en).match(/<p\b[^>]*>([\s\S]*?)<\/p>/i) || [,''])[1]).slice(0, 240))}</span></p>` : ''}<div class="pillar-author-meta"><span class="id-copy">Terbit ${publishedAt} · ditampilkan 7 hari</span><span class="en-copy">Published ${new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Asia/Jakarta' }).format(new Date(authorNews.date))} · featured for 7 days</span></div><a class="home-feature-link id-copy" href="${articlePath(article, 'id')}">Baca artikel lengkap →</a><a class="home-feature-link en-copy" href="${articlePath(article, 'en')}">Read the full article →</a></div>`;
})() : '';
const leadFallback = visibleNews.length
  ? `<div class="eyebrow"><span class="id-copy">Berita terkini · Pilihan feed</span><span class="en-copy">Latest news · From the feed</span></div><p class="feature-topic">${categoryOf(visibleNews[0])}</p><a class="lead-link" href="${escape(linkOf(visibleNews[0]))}" target="_blank" rel="noopener noreferrer"><h2>${escape(titleOf(visibleNews[0]))}</h2></a><p class="lead-summary">${escape(visibleNews[0].ringkasan || visibleNews[0].source_description || visibleNews[0].summary || visibleNews[0].description || visibleNews[0].deskripsi || visibleNews[0].content_excerpt || '')}</p><p class="lead-meta">${escape(sourceOf(visibleNews[0]))} · <span class="id-copy">${escape(formatDate(visibleNews[0]))} · Sumber artikel langsung</span><span class="en-copy">${escape(formatDate(visibleNews[0], 'en-GB'))} · Direct publisher source</span></p><a class="home-feature-link id-copy" href="/berita-kopi/">Jelajahi berita terkini →</a><a class="home-feature-link en-copy" href="/en/coffee-news/">Explore latest news →</a>`
  : `<div class="eyebrow"><span class="id-copy">Berita terkini</span><span class="en-copy">Latest news</span></div><h2>Belum ada berita yang memenuhi kriteria pilihan.</h2><p>Berita feed tetap tersedia di halaman berita.</p><a class="home-feature-link id-copy" href="/berita-kopi/">Jelajahi berita terkini →</a><a class="home-feature-link en-copy" href="/en/coffee-news/">Explore latest news →</a>`;
const expiresAt = authorNews ? new Date(Date.parse(authorNews.date) + sevenDays).toISOString() : '';
const featureAttrs = authorNews ? ` data-has-author-article="true" data-author-expires-at="${escape(expiresAt)}"` : '';
const lead = `<article id="lead-story" data-pillar-card="berita"${featureAttrs} class="home-feature-card feed-feature"><div class="home-pillar-fallback" data-pillar-fallback>${leadFallback}</div><div class="home-pillar-author" data-pillar-author="berita">${authorFeature}</div></article>`;
const latest = visibleNews.slice(authorNews ? 0 : 1, authorNews ? 4 : 5).map(article => {
  const summary = article.ringkasan || article.source_description || article.summary || article.description || article.deskripsi || article.content_excerpt || '';
  return `<li><a href="${escape(linkOf(article))}" target="_blank" rel="noopener noreferrer">${escape(titleOf(article))}</a>${summary ? `<p class="latest-summary">${escape(summary)}</p>` : ''}<div class="meta">${escape(sourceOf(article))} <i class="dot"></i> <span class="id-copy">${escape(formatDate(article))} · Sumber artikel langsung</span><span class="en-copy">${escape(formatDate(article, 'en-GB'))} · Direct publisher source</span></div></li>`;
}).join('');
for (const filename of ['index.html', 'kabar-kopi.html']) {
  const htmlPath = path.join(root, filename);
  const html = fs.readFileSync(htmlPath, 'utf8');
  const updated = html
    .replace(/<article id="lead-story"[^>]*>[\s\S]*?<\/article>/, lead)
    .replace(/(<ul id="home-latest" class="side-list">)[\s\S]*?(<\/ul>)/, `$1${latest}$2`);
  if (!html.includes('<article id="lead-story"') || !html.includes('<ul id="home-latest" class="side-list">')) {
    throw new Error(`Homepage news markup is missing in ${filename}.`);
  }
  if (updated !== html) fs.writeFileSync(htmlPath, updated);
}
console.log(`Rendered ${visibleNews.length} classified publisher headlines; active bylined feature ${authorNews ? 'retained through ' + expiresAt : 'not found'}.`);
