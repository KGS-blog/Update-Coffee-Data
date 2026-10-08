const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const SITE = 'https://kabarkopi.qcoid.com';
const BLOG = 'https://blog.qcoid.com';
const snapshotPath = path.join(ROOT, 'data/blog-pillar-articles.json');
const snapshot = fs.existsSync(snapshotPath) ? JSON.parse(fs.readFileSync(snapshotPath, 'utf8')) : { articles: [] };
const articles = Array.isArray(snapshot.articles) ? snapshot.articles : [];
const now = Date.now();
const sevenDays = 7 * 24 * 60 * 60 * 1000;
const pillars = {
  harga: { id: 'Harga & Tracking Kopi', en: 'Coffee Prices & Tracking', marker: 'HARGA' },
  ekspor: { id: 'Panduan Ekspor Kopi', en: 'Coffee Export Guide', marker: 'EKSPOR' },
  'data-tren': { id: 'Data & Tren Industri', en: 'Industry Data & Trends', marker: 'DATA_TREN' },
  analisis: { id: 'Analisis & Report', en: 'Analysis & Reports', marker: 'ANALISIS' },
  berita: { id: 'Berita Terkini', en: 'Latest News', marker: 'BERITA' }
};
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]));
const slugify = value => String(value || '').normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/&/g, ' dan ').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 70) || 'artikel-kopi';
const articleDate = article => {
  for (const value of [article.kabar_featured_at, article.datePublished]) if (value && Number.isFinite(Date.parse(value))) return new Date(value).toISOString();
  const raw = String(article.date || '');
  const m = raw.match(/^(\d{1,2})\s+([\p{L}]+)\s+(\d{4})$/u);
  if (!m) return '';
  const months = ['januari','februari','maret','april','mei','juni','juli','agustus','september','oktober','november','desember','january','february','march','april','may','june','july','august','september','october','november','december'];
  const month = months.indexOf(m[2].toLowerCase()) % 12;
  return month < 0 ? '' : new Date(Date.UTC(Number(m[3]), month, Number(m[1]), 8)).toISOString();
};
const articlePath = (article, lang) => `/artikel-pilar/${slugify(article.title_id)}-${lang}-${article.id}.html`;
const blogPath = (article, lang) => `/artikel/${slugify(article.title_id)}-${lang}-${article.id}.html`;
function safeArticleHtml(value) {
  let html = String(value || '').replace(/<!--[\s\S]*?-->/g, '').replace(/<(script|style|iframe|object|svg|math)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, '');
  html = html.replace(/<([a-z][a-z0-9]*)\b([^>]*)>/gi, (whole, rawTag, attrs) => {
    const tag = rawTag.toLowerCase();
    if (['br','hr'].includes(tag)) return `<${tag}>`;
    if (!['p','h2','h3','h4','ul','ol','li','strong','b','em','i','blockquote','a'].includes(tag)) return '';
    if (tag !== 'a') return `<${tag}>`;
    const href = String(attrs.match(/\bhref\s*=\s*(["'])(.*?)\1/i)?.[2] || '');
    try { const url = new URL(href); return ['https:','http:'].includes(url.protocol) ? `<a href="${esc(url.href)}" rel="noopener noreferrer">` : '<a>'; } catch (_) { return '<a>'; }
  });
  return html.replace(/<\/(?:[a-z][a-z0-9]*)\s*>/gi, close => {
    const tag = close.match(/[a-z][a-z0-9]*/i)?.[0]?.toLowerCase();
    return ['p','h2','h3','h4','ul','ol','li','strong','b','em','i','blockquote','a'].includes(tag) ? `</${tag}>` : '';
  });
}
function currentFor(pillar) {
  return articles.filter(article => article.kabar_pillar === pillar)
    .map(article => ({ article, date: articleDate(article) }))
    .filter(item => item.date && Date.parse(item.date) <= now && now - Date.parse(item.date) <= sevenDays)
    .sort((a,b) => Date.parse(b.date) - Date.parse(a.date))[0]?.article || null;
}
function homeContext(article, field) {
  const source = String(article?.[field] || '');
  const paragraphs = [...source.matchAll(/<p\b[^>]*>([\s\S]*?)<\/p>/gi)];
  for (const match of paragraphs) {
    const text = match[1]
      .replace(/<br\s*\/?\s*>/gi, ' ')
      .replace(/<[^>]+>/g, ' ')
      .replace(/&nbsp;|&#160;/gi, ' ')
      .replace(/&amp;/gi, '&').replace(/&lt;/gi, '<').replace(/&gt;/gi, '>')
      .replace(/&quot;|&#34;/gi, '"').replace(/&#39;|&apos;/gi, "'")
      .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
      .replace(/&#x([\da-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
      .replace(/\s+/g, ' ').trim();
    if (text.length >= 90) return text;
  }
  return '';
}
function homeTopics(article, field) {
  return [...String(article?.[field] || '').matchAll(/<h2\b[^>]*>([\s\S]*?)<\/h2>/gi)]
    .map(match => match[1].replace(/<[^>]+>/g, ' ').replace(/&amp;/gi, '&').replace(/&nbsp;|&#160;/gi, ' ').replace(/\s+/g, ' ').trim())
    .filter(text => text && !/^(penutup|closing|kesimpulan|conclusion)$/i.test(text))
    .slice(0, 3);
}
function teaser(article, pillar) {
  if (!article) return '';
  const en = pillar === 'data-tren';
  const hrefId = articlePath(article, 'id');
  const hrefEn = articlePath(article, 'en');
  const title = `<span class="id-copy">${esc(article.title_id)}</span><span class="en-copy">${esc(article.title_en)}</span>`;
  const desc = `<span class="id-copy">${esc(article.desc_id)}</span><span class="en-copy">${esc(article.desc_en)}</span>`;
  const eyebrow = en ? ['Sorotan penulis · 7 hari','Author spotlight · 7 days'] : ['Tulisan penulis · 7 hari','Bylined article · 7 days'];
  const read = ['Baca artikel lengkap →','Read the full article →'];
  return `<article class="blog-pillar-feature"><div class="eyebrow"><span class="id-copy">${eyebrow[0]}</span><span class="en-copy">${eyebrow[1]}</span></div><h2><a class="id-copy" href="${hrefId}">${esc(article.title_id)}</a><a class="en-copy" href="${hrefEn}">${esc(article.title_en)}</a></h2><p>${desc}</p><a class="home-feature-link id-copy" href="${hrefId}">${read[0]}</a><a class="home-feature-link en-copy" href="${hrefEn}">${read[1]}</a></article>`;
}
function homeTeaser(article, pillar) {
  if (!article) return '';
  const labels = pillars[pillar];
  const hrefId = articlePath(article, 'id');
  const hrefEn = articlePath(article, 'en');
  const date = articleDate(article);
  const dateId = date ? new Intl.DateTimeFormat('id-ID', { day:'numeric', month:'short', year:'numeric', timeZone:'Asia/Jakarta' }).format(new Date(date)) : '';
  const dateEn = date ? new Intl.DateTimeFormat('en-GB', { day:'numeric', month:'short', year:'numeric', timeZone:'Asia/Jakarta' }).format(new Date(date)) : '';
  const contextId = homeContext(article, 'content_id');
  const contextEn = homeContext(article, 'content_en');
  const topicsId = homeTopics(article, 'content_id');
  const topicsEn = homeTopics(article, 'content_en');
  const topicList = (items, lang) => items.length ? `<ul class="${lang}-copy">${items.map(item => `<li>${esc(item)}</li>`).join('')}</ul>` : '';
  return `<article class="pillar-article-feature"><div class="eyebrow"><span class="id-copy">${esc(labels.id)} · Tulisan penulis</span><span class="en-copy">${esc(labels.en)} · Bylined article</span></div><h3><a class="id-copy" href="${hrefId}">${esc(article.title_id)}</a><a class="en-copy" href="${hrefEn}">${esc(article.title_en)}</a></h3><p class="pillar-feature-summary"><span class="id-copy">${esc(article.desc_id)}</span><span class="en-copy">${esc(article.desc_en)}</span></p>${contextId || contextEn ? `<p class="pillar-feature-context"><span class="id-copy">${esc(contextId)}</span><span class="en-copy">${esc(contextEn)}</span></p>` : ''}${topicsId.length || topicsEn.length ? `<section class="pillar-feature-highlights"><h4><span class="id-copy">Pokok bahasan</span><span class="en-copy">In this article</span></h4>${topicList(topicsId, 'id')}${topicList(topicsEn, 'en')}</section>` : ''}<div class="pillar-author-meta"><span class="id-copy">Terbit ${esc(dateId)} · ditampilkan 7 hari</span><span class="en-copy">Published ${esc(dateEn)} · featured for 7 days</span></div><a class="home-feature-link id-copy" href="${hrefId}">Baca artikel lengkap →</a><a class="home-feature-link en-copy" href="${hrefEn}">Read the full article →</a></article>`;
}
function standalone(article, lang) {
  const en = lang === 'en';
  const title = esc(en ? article.title_en : article.title_id);
  const description = esc(en ? article.desc_en : article.desc_id);
  const date = articleDate(article);
  const canonical = `${SITE}${articlePath(article, lang)}`;
  const opposite = `${SITE}${articlePath(article, en ? 'id' : 'en')}`;
  const blogCanonical = `${BLOG}${blogPath(article, lang)}`;
  const content = safeArticleHtml(en ? article.content_en : article.content_id);
  const schema = { '@context':'https://schema.org','@type':'Article',headline:title,description,datePublished:date || undefined,inLanguage:en?'en':'id',author:{'@type':'Person','name':article.author || 'Kabar Kopi'},publisher:{'@type':'Organization','name':'Kabar Kopi','url':`${SITE}/`},mainEntityOfPage:canonical,isPartOf:{'@type':'Blog','name':'Kabar Kopi'},isAccessibleForFree:true };
  const pillarLabel = pillars[article.kabar_pillar] || pillars['data-tren'];
  return `<!doctype html><html lang="${en?'en':'id'}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title} | Kabar Kopi</title><meta name="description" content="${description}"><link rel="canonical" href="${blogCanonical}"><link rel="alternate" hreflang="id" href="${en?opposite:canonical}"><link rel="alternate" hreflang="en" href="${en?canonical:opposite}"><script type="application/ld+json">${JSON.stringify(schema).replace(/</g,'\\u003c')}</script><style>body{max-width:900px;margin:40px auto;padding:0 22px;font:17px/1.75 system-ui,sans-serif;color:#29231e}h1,h2,h3{font-family:Georgia,serif;line-height:1.2}h1{font-size:42px}a{color:#704b31}.byline{color:#746f68;font-size:14px;border-bottom:1px solid #e7e1d8;padding-bottom:18px}.body{margin:30px 0}.note{background:#f5f1eb;border-left:4px solid #a4472d;padding:14px 18px}</style></head><body><p><a href="${SITE}/">${en?'← Kabar Kopi home':'← Beranda Kabar Kopi'}</a></p><main><div class="eyebrow">${esc(en?pillarLabel.en:pillarLabel.id)} · ${en?'Bylined article':'Artikel penulis'}</div><h1>${title}</h1><p class="intro">${description}</p><p class="byline">${date?new Intl.DateTimeFormat(en?'en-US':'id-ID',{dateStyle:'long',timeZone:'UTC'}).format(new Date(date)):''} · ${en?'Also published on Kabar Kopi Blog':'Terbit juga di Blog Kabar Kopi'}</p><article class="body">${content}</article><div class="note">${en?'This bylined article was published on the Kabar Kopi Blog and featured in this section for seven days.':'Artikel penulis ini diterbitkan di Blog Kabar Kopi dan ditampilkan sebagai sorotan di bagian ini selama tujuh hari.'}</div><p><a href="${blogCanonical}">${en?'Open the Blog edition':'Buka edisi Blog'}</a></p></main></body></html>`;
}

const outputDir = path.join(ROOT, 'artikel-pilar');
fs.mkdirSync(outputDir, { recursive: true });
for (const file of fs.readdirSync(outputDir)) if (file.endsWith('.html')) fs.unlinkSync(path.join(outputDir, file));
const sitemapUrls = [];
for (const article of articles) for (const lang of ['id','en']) {
  const file = articlePath(article, lang).replace(/^\/artikel-pilar\//, '');
  fs.writeFileSync(path.join(outputDir, file), standalone(article, lang));
  sitemapUrls.push(`${SITE}${articlePath(article, lang)}`);
}
for (const file of ['index.html','kabar-kopi.html']) {
  const target = path.join(ROOT, file);
  if (!fs.existsSync(target)) continue;
  let html = fs.readFileSync(target, 'utf8');
  const dataLead = currentFor('data-tren');
  const newsLead = currentFor('berita');
  for (const [pillar, labels] of Object.entries(pillars)) {
    const article = currentFor(pillar);
    const marker = `<!-- BLOG_PILLAR_HOME_${labels.marker} -->`;
    if (article) {
      const expiresAt = new Date(Date.parse(articleDate(article)) + sevenDays).toISOString();
      const cardAttributes = new RegExp(`data-pillar-card="${pillar}"(?: data-has-author-article="true" data-author-expires-at="[^"]*")*`);
      html = html.replace(cardAttributes, `data-pillar-card="${pillar}" data-has-author-article="true" data-author-expires-at="${expiresAt}"`);
    }
    html = html.replace(marker, homeTeaser(article, pillar));
  }
  html = html.replace('<!-- BLOG_PILLAR_DATA_TREN -->', teaser(dataLead, 'data-tren') || '<p class="section-intro">Harga acuan kopi terbaru, ringkasan perubahan pasar, dan data ekspor Indonesia. Angka diperbarui dari feed berkala dan ditautkan ke sumbernya.</p>');
  html = html.replace('<!-- BLOG_PILLAR_BERITA -->', newsLead ? `${teaser(newsLead, 'berita')}<p class="source-line id-copy"><a id="weekly-brief-link" href="/rangkuman-pekanan/">Baca rangkuman kopi pekan ini →</a></p><p class="source-line en-copy"><a id="weekly-brief-link-en" href="/en/weekly-coffee-brief/">Read this week’s coffee brief →</a></p>` : '<p class="section-intro" style="margin:4px 0 0"><span class="id-copy">Berita kopi dari berbagai sumber, disatukan dalam satu feed dan dikelompokkan menurut topik.</span><span class="en-copy">Coffee news from multiple sources, brought together in one feed and grouped by topic.</span></p><p class="source-line"><a id="weekly-brief-link" href="/rangkuman-pekanan/">Baca rangkuman kopi pekan ini →</a></p>');
  fs.writeFileSync(target, html);
}
for (const lang of ['id','en']) {
  const relative = lang === 'id' ? 'data-tren-kopi/index.html' : 'en/coffee-market-data/index.html';
  const dataPage = path.join(ROOT, relative);
  const article = currentFor('data-tren');
  if (!fs.existsSync(dataPage) || !article) continue;
  const title = esc(lang === 'en' ? article.title_en : article.title_id);
  const description = esc(lang === 'en' ? article.desc_en : article.desc_id);
  const block = `<section class="panel"><div class="eyebrow">${lang === 'en' ? 'Bylined article · 7-day feature' : 'Tulisan penulis · sorotan 7 hari'}</div><h2><a href="${SITE}${articlePath(article,lang)}">${title}</a></h2><p>${description}</p><a href="${SITE}${articlePath(article,lang)}">${lang === 'en' ? 'Read the full article →' : 'Baca artikel lengkap →'}</a></section>`;
  let html = fs.readFileSync(dataPage, 'utf8');
  html = html.replace('<section aria-labelledby="prices">', `${block}<section aria-labelledby="prices">`);
  fs.writeFileSync(dataPage, html);
}
const sitemapPath = path.join(ROOT, 'sitemap.xml');
if (fs.existsSync(sitemapPath)) {
  let sitemap = fs.readFileSync(sitemapPath, 'utf8').replace(/\s*<url>\s*<loc>https:\/\/kabarkopi\.qcoid\.com\/artikel-pilar\/[^<]+<\/loc>[^<]*<\/url>/g, '');
  for (const url of sitemapUrls) if (!sitemap.includes(`<loc>${url}</loc>`)) sitemap = sitemap.replace('</urlset>', `  <url><loc>${url}</loc></url>\n</urlset>`);
  fs.writeFileSync(sitemapPath, sitemap);
}
console.log(`Rendered ${articles.length} bilingual Kabar Kopi author articles; ${sitemapUrls.length} article URLs added to sitemap.`);
