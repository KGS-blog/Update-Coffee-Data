// Build bilingual, crawlable weekly coffee briefs from the dated direct-source news feed.
// This is a navigation and coverage digest, not an independently verified market report.
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const SITE = 'https://kabarkopi.qcoid.com';
const feed = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/berita-all.json'), 'utf8'));
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]));
const sourceHost = value => { try { return new URL(value).hostname.replace(/^www\./, ''); } catch (_) { return ''; } };
const directUrl = value => { try { const u = new URL(value); return u.protocol === 'https:' && !/(^|\.)google\.com$/i.test(u.hostname) && !/(^|\.)news\.google\.com$/i.test(u.hostname); } catch (_) { return false; } };
const dayOf = article => {
  const raw = article.source_published_date || article.published_date || article.tanggal || article.pubDate;
  const parsed = raw ? new Date(raw) : null;
  return parsed && Number.isFinite(parsed.getTime()) ? parsed.toISOString().slice(0, 10) : '';
};
const datedFeed = (Array.isArray(feed.artikel) ? feed.artikel : [])
  .filter(a => a.cluster_assignment !== 'editor_irrelevant')
  .map(a => ({ ...a, briefDate: dayOf(a), briefUrl: a.resolved_url || a.tautan || a.link || '' }))
  .filter(a => a.briefDate && directUrl(a.briefUrl));
const referenceDate = (() => {
  const fetched = Date.parse(feed.fetched || '');
  if (Number.isFinite(fetched)) return new Date(fetched).toISOString().slice(0, 10);
  return datedFeed.map(a => a.briefDate).sort().at(-1) || new Date().toISOString().slice(0, 10);
})();
const end = new Date(`${referenceDate}T00:00:00Z`);
const start = new Date(end); start.setUTCDate(start.getUTCDate() - 6);
const startDate = start.toISOString().slice(0, 10);
const inWindow = datedFeed.filter(a => a.briefDate >= startDate && a.briefDate <= referenceDate)
  .sort((a,b) => b.briefDate.localeCompare(a.briefDate) || String(a.judul || a.title).localeCompare(String(b.judul || b.title)));
const unique = new Map();
for (const article of inWindow) {
  const key = article.briefUrl.replace(/#.*$/, '').replace(/\/$/, '').toLowerCase();
  if (!unique.has(key)) unique.set(key, article);
}
const stories = [...unique.values()];
const clusters = new Map();
for (const article of stories) {
  const name = article.cluster_name || article.cluster || '';
  if (!name || /^(lainnya|belum terklasifikasi|others|unclassified)$/i.test(name)) continue;
  clusters.set(name, (clusters.get(name) || 0) + 1);
}
const topClusters = [...clusters].sort((a,b) => b[1]-a[1] || a[0].localeCompare(b[0])).slice(0, 6);
const dateLabel = (date, locale) => new Intl.DateTimeFormat(locale, { day:'numeric', month:'long', year:'numeric', timeZone:'UTC' }).format(new Date(`${date}T00:00:00Z`));

function shell({ lang, title, description, canonical, opposite, body, schema }) {
  return `<!doctype html><html lang="${lang}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)}</title><meta name="description" content="${esc(description)}"><link rel="canonical" href="${canonical}">
<link rel="alternate" hreflang="id" href="${lang === 'id' ? canonical : opposite}"><link rel="alternate" hreflang="en" href="${lang === 'en' ? canonical : opposite}"><link rel="alternate" hreflang="x-default" href="${SITE}/rangkuman-pekanan/">
<meta property="og:type" content="article"><meta property="og:site_name" content="Kabar Kopi"><meta property="og:title" content="${esc(title)}"><meta property="og:description" content="${esc(description)}"><meta property="og:url" content="${canonical}"><meta property="og:locale" content="${lang === 'id' ? 'id_ID' : 'en_US'}"><meta name="twitter:card" content="summary">
<link rel="icon" type="image/svg+xml" href="${SITE}/favicon.svg"><script type="application/ld+json">${JSON.stringify(schema).replace(/</g,'\\u003c')}</script>
<style>:root{--ink:#25231f;--muted:#746f68;--line:#e7e1d8;--paper:#fbfaf7;--coffee:#62432e;--rust:#a9472d;--cream:#f2ede5}*{box-sizing:border-box}body{margin:0;background:var(--paper);color:var(--ink);font:16px/1.65 system-ui,-apple-system,"Segoe UI",sans-serif}a{color:var(--coffee);text-underline-offset:3px}.wrap{width:min(1080px,calc(100% - 36px));margin:auto}.mast{padding:22px 0;border-bottom:1px solid var(--line);display:flex;justify-content:space-between;align-items:center;gap:20px}.brand{font:700 27px Georgia,serif;color:var(--ink);text-decoration:none}.nav{display:flex;gap:16px;flex-wrap:wrap;padding:14px 0;border-bottom:3px solid #38281a;background:#fff}.nav a{font-size:14px;font-weight:700;text-decoration:none}.lang{margin-left:auto}main{padding:42px 0 64px}h1,h2{font-family:Georgia,"Times New Roman",serif;line-height:1.2}h1{font-size:clamp(36px,6vw,58px);letter-spacing:-1px;margin:8px 0 14px}h2{font-size:25px;margin:28px 0 10px}.eyebrow{color:var(--rust);font-size:12px;font-weight:800;letter-spacing:.13em;text-transform:uppercase}.intro{max-width:850px;color:#57524c;font-size:19px}.panel{background:#fff;border:1px solid var(--line);padding:22px;margin:20px 0}.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:12px;margin:20px 0}.stat{background:#fff;border:1px solid var(--line);padding:16px}.stat strong{display:block;font:700 27px Georgia,serif}.muted,.note{color:var(--muted)}.note{background:var(--cream);padding:14px 16px;border-left:3px solid var(--coffee);font-size:14px}.story{padding:17px 0;border-bottom:1px solid var(--line)}.story h3{font:700 21px/1.35 Georgia,"Times New Roman",serif;margin:0 0 4px}.meta{font-size:13px;color:var(--muted)}.button{display:inline-block;background:var(--coffee);color:white;border:1px solid var(--coffee);padding:11px 16px;text-decoration:none;font-weight:700;border-radius:4px;margin:6px 8px 6px 0}.button.alt{background:white;color:var(--coffee)}.footer{padding:20px 0;border-top:1px solid var(--line);color:var(--muted);font-size:13px}@media(max-width:600px){.wrap{width:calc(100% - 26px)}.mast{align-items:flex-start}.brand{font-size:23px}.nav{gap:10px}.lang{margin-left:0}main{padding-top:28px}.panel{padding:16px}}</style></head>
<body><header class="wrap mast"><a class="brand" href="${SITE}/">Kabar Kopi <span style="font:500 11px system-ui;color:var(--muted)">· ${lang === 'id' ? 'BERITA · DATA · ANALISIS' : 'NEWS · DATA · ANALYSIS'}</span></a><span class="muted">${lang === 'id' ? 'Rangkuman mingguan industri kopi' : 'Weekly coffee industry brief'}</span></header>
<nav class="wrap nav" aria-label="${lang === 'id' ? 'Navigasi Kabar Kopi' : 'Kabar Kopi navigation'}"><a href="${SITE}/">${lang === 'id' ? 'Beranda' : 'Home'}</a><a href="${SITE}/#berita">${lang === 'id' ? 'Semua berita kopi' : 'All coffee news'}</a><a href="${SITE}/kabar-kopi.html#mevo">${lang === 'id' ? 'Analisis publik' : 'Public analysis'}</a><a href="${SITE}/data-tren-kopi/">${lang === 'id' ? 'Data & Tren' : 'Data & Trends'}</a><a href="${SITE}/kabar-kopi.html#report-mevo">${lang === 'id' ? 'Report by MEVO · anggota' : 'Report by MEVO · members'}</a><a class="lang" href="${opposite}">${lang === 'id' ? 'English' : 'Bahasa Indonesia'}</a></nav>
<main class="wrap">${body}</main><footer class="wrap footer">© 2026 Kabar Kopi · <a href="${SITE}/tentang-kabar-kopi.html">${lang === 'id' ? 'Tentang, metode, dan koreksi' : 'About, methods, and corrections'}</a></footer></body></html>`;
}

function page(lang) {
  const en = lang === 'en';
  const pathName = en ? '/en/weekly-coffee-brief/' : '/rangkuman-pekanan/';
  const canonical = SITE + pathName;
  const opposite = SITE + (en ? '/rangkuman-pekanan/' : '/en/weekly-coffee-brief/');
  const locale = en ? 'en-US' : 'id-ID';
  const title = en ? `This Week in Coffee | ${dateLabel(startDate, locale)} – ${dateLabel(referenceDate, locale)} | Kabar Kopi` : `Rangkuman Kopi Pekan Ini | ${dateLabel(startDate, locale)} – ${dateLabel(referenceDate, locale)} | Kabar Kopi`;
  const description = en ? `A source-linked weekly overview of ${stories.length} dated coffee stories and the topics covered in Kabar Kopi’s feed.` : `Ringkasan mingguan dengan tautan sumber untuk ${stories.length} berita kopi bertanggal dan topik yang muncul dalam feed Kabar Kopi.`;
  const clusterBody = topClusters.length ? `<div class="grid">${topClusters.map(([name,count]) => `<article class="stat"><strong>${count}</strong><span>${esc(en ? ({'Kedai, Konsumsi & Gaya Hidup':'Cafés, Consumption & Lifestyle','Ekspor & Daya Saing':'Exports & Competitiveness','Produksi & Panen':'Production & Harvest','Event & Kompetisi':'Events & Competitions','Riset & Tren Konsumen':'Consumer Research & Trends','Barista & Teknik Seduh':'Barista & Brewing','Harga & Pasar':'Prices & Markets','Pendidikan & Industri':'Education & Industry','Kebijakan & Regulasi':'Policy & Regulation','Brand Global':'Global Brands','Budaya & Sastra Kopi':'Coffee Culture & Literature'}[name] || name) : name)}</span></article>`).join('')}</div>` : `<p>${en ? 'No categorized stories were recorded in this period.' : 'Belum ada berita berkategori yang tercatat pada periode ini.'}</p>`;
  const storyBody = stories.length ? stories.slice(0, 12).map(a => `<article class="story"><h3><a href="${esc(a.briefUrl)}" rel="noopener noreferrer">${esc(a.judul || a.title || a.source_title || (en ? 'Coffee industry story' : 'Berita industri kopi'))}</a></h3><div class="meta">${esc(a.sumber || sourceHost(a.briefUrl))} · <time datetime="${esc(a.briefDate)}">${dateLabel(a.briefDate, locale)}</time></div></article>`).join('') : `<p>${en ? 'No dated direct-publisher stories are available for this period.' : 'Belum ada berita bertanggal dari penerbit langsung pada periode ini.'}</p>`;
  const body = `<div class="eyebrow">${en ? 'Coffee industry · weekly coverage' : 'Industri kopi · pantauan mingguan'}</div><h1>${en ? 'This Week in Coffee' : 'Rangkuman Kopi Pekan Ini'}</h1><p class="intro">${en ? 'A concise guide to coffee stories appearing across publishers, with links to the original coverage and clear routes to Kabar Kopi’s analysis and data.' : 'Panduan ringkas atas berita kopi yang muncul di berbagai penerbit, dengan tautan ke liputan sumber serta akses ke analisis dan data Kabar Kopi.'}</p>
<p class="muted">${en ? 'Coverage period' : 'Periode pantauan'}: <time datetime="${startDate}">${dateLabel(startDate, locale)}</time> – <time datetime="${referenceDate}">${dateLabel(referenceDate, locale)}</time>. ${en ? 'Feed snapshot' : 'Snapshot feed'}: <time datetime="${esc(feed.fetched || referenceDate)}">${esc(feed.fetched || referenceDate)}</time>.</p>
<section class="panel" aria-labelledby="topics"><h2 id="topics">${en ? 'Topics covered' : 'Topik yang muncul'}</h2>${clusterBody}<p class="note">${en ? 'Topic counts reflect the number of stories assigned to each cluster in this feed and period. They describe coverage volume, not market impact, public opinion, or whether a claim is true.' : 'Jumlah topik menunjukkan banyaknya berita yang ditempatkan dalam tiap klaster pada feed dan periode ini. Angka menggambarkan volume pemberitaan, bukan dampak pasar, opini publik, atau kebenaran suatu klaim.'}</p></section>
<section aria-labelledby="stories"><h2 id="stories">${en ? 'Selected source-linked stories' : 'Pilihan berita dan sumber'}</h2><p class="muted">${en ? `Showing up to 12 of ${stories.length} unique, dated direct-publisher links in the period.` : `Menampilkan hingga 12 dari ${stories.length} tautan penerbit langsung yang unik dan bertanggal dalam periode ini.`}</p>${storyBody}<p><a class="button alt" href="${SITE}/kabar-kopi.html#berita">${en ? 'Browse all coffee news' : 'Jelajahi semua berita kopi'}</a></p></section>
<section class="panel"><h2>${en ? 'Continue exploring' : 'Lanjutkan membaca'}</h2><p>${en ? 'Use the public editorial analysis for synthesized coverage themes; consult the data pages for market indicators and their source notes. MEVO reports document source mapping and issue selection and are available to members.' : 'Baca analisis editorial publik untuk melihat sintesis tema pemberitaan; buka halaman data untuk indikator pasar dan catatan sumber. Report MEVO mendokumentasikan pemetaan sumber dan pemilihan isu, dan tersedia bagi anggota.'}</p><a class="button" href="${SITE}/kabar-kopi.html#mevo">${en ? 'Public coffee analysis' : 'Analisis kopi publik'}</a><a class="button alt" href="${SITE}/data-tren-kopi/">${en ? 'Coffee data & trends' : 'Data & Tren Kopi'}</a><a class="button alt" href="${SITE}/kabar-kopi.html#report-mevo">${en ? 'Member reports by MEVO' : 'Report anggota by MEVO'}</a></section>
<p class="note">${en ? 'This digest is compiled from the dated publisher links available in the feed. Some items may not have a usable publication date and are omitted; no dates are inferred. Clusters organize coverage for navigation and are not independent fact-checks.' : 'Rangkuman ini disusun dari tautan penerbit bertanggal yang tersedia di feed. Sebagian item mungkin tidak memiliki tanggal terbit yang dapat digunakan sehingga tidak disertakan; tanggal tidak direka. Klaster membantu menata pemberitaan dan bukan pemeriksaan fakta independen.'}</p>`;
  const schema = {'@context':'https://schema.org','@type':'CollectionPage','name':title,'description':description,'url':canonical,'inLanguage':lang,'dateModified':referenceDate,'publisher':{'@type':'Organization','name':'Kabar Kopi'},'temporalCoverage':`${startDate}/${referenceDate}`,'mainEntity':{'@type':'ItemList','numberOfItems':Math.min(stories.length,12),'itemListElement':stories.slice(0,12).map((a,i)=>({'@type':'ListItem','position':i+1,'url':a.briefUrl,'name':a.judul||a.title||a.source_title||''}))}};
  return { path:pathName, html:shell({lang,title,description,canonical,opposite,body,schema}) };
}

const pages = [page('id'), page('en')];
for (const item of pages) {
  const output = path.join(ROOT, item.path.replace(/^\//, ''), 'index.html');
  fs.mkdirSync(path.dirname(output), { recursive:true });
  fs.writeFileSync(output, item.html);
}
const sitemapPath = path.join(ROOT, 'sitemap.xml');
let sitemap = fs.readFileSync(sitemapPath, 'utf8');
for (const item of pages) {
  const url = SITE + item.path;
  if (!sitemap.includes(`<loc>${url}</loc>`)) sitemap = sitemap.replace('</urlset>', `  <url><loc>${url}</loc><lastmod>${referenceDate}</lastmod></url>\n</urlset>`);
}
fs.writeFileSync(sitemapPath, sitemap);
console.log(`Generated bilingual weekly coffee briefs for ${startDate} through ${referenceDate} (${stories.length} unique dated direct-source stories).`);
