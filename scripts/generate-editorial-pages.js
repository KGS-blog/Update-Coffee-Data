const fs = require('node:fs');
const path = require('node:path');
const { BERITA_KLASTER } = require('../BERITA_KLASTER_FINAL.js');

const ROOT = path.resolve(__dirname, '..');
const SITE = 'https://kabarkopi.qcoid.com';
const sourcePath = path.join(ROOT, 'data/editorial-current.json');
const doc = fs.existsSync(sourcePath) ? JSON.parse(fs.readFileSync(sourcePath, 'utf8')) : { articles: [] };
const feedPath = path.join(ROOT, 'data/berita-all.json');
const feed = fs.existsSync(feedPath) ? JSON.parse(fs.readFileSync(feedPath, 'utf8')) : { artikel: [] };
const latestNews = (feed.artikel || []).slice().sort((a, b) => Date.parse(b.tanggal || '') - Date.parse(a.tanggal || '')).slice(0, 6);
const reports = (doc.articles || []).filter(item => item.status === 'ai_generated' || item.status === 'editor_selected');
const output = path.join(ROOT, 'analisis-kopi');
fs.mkdirSync(output, { recursive: true });

const esc = value => String(value || '').replace(/[&<>"']/g, char => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[char]));
const slugify = value => String(value || '').normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/&/g,' dan ').replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'').slice(0,70) || 'analisis-pasar-kopi';
const safeUrl = value => { try { const url = new URL(value); return ['https:','http:'].includes(url.protocol) ? url.href : ''; } catch (_) { return ''; } };
const fileFor = (item, language) => `${slugify(item.cluster_id || item.cluster_name || item.article?.title || item.article_en?.title)}-${language}.html`;
function renderPage(item, language) {
  const en = language === 'en';
  const article = (en ? item.article_en : item.article) || {};
  const title = article.title || (en ? 'Coffee Market Analysis' : 'Analisis Pasar Kopi');
  const summary = article.summary || '';
  const lead = article.lead || '';
  const canonical = `${SITE}/analisis-kopi/${fileFor(item, language)}`;
  const altId = `${SITE}/analisis-kopi/${fileFor(item, 'id')}`;
  const altEn = item.article_en ? `${SITE}/analisis-kopi/${fileFor(item, 'en')}` : '';
  const date = item.generated_at || doc.generated_at || '';
  const cluster = BERITA_KLASTER.find(entry => entry.slug === item.cluster_id || entry.nama === item.cluster_name);
  const clusterName = en ? (item.cluster_name_en || cluster?.nama_en || item.cluster_name || '') : (item.cluster_name || '');
  const sections = (article.sections || []).map(section => `<section><h2>${esc(section.heading)}</h2>${(section.paragraphs || []).map(text => `<p>${esc(text)}</p>`).join('')}</section>`).join('');
  const recommendations = (article.recommendations || []).map(rec => `<li><strong>${esc(rec.audience)}:</strong> ${esc(rec.action)}<p class="basis">${en ? 'Basis' : 'Dasar'}: ${esc(rec.basis)}</p></li>`).join('');
  const used = new Set(article.source_urls || []);
  let sources = (item.input_sources || []).filter(source => used.has(source.url));
  if (!sources.length) sources = item.input_sources || [];
  const sourceLinks = sources.map(source => {
    const url = safeUrl(source.url);
    if (!url) return '';
    const label = `[${source.id}] ${source.source || (en ? 'Original source' : 'Sumber asli')}`;
    return `<li><a href="${esc(url)}" rel="noopener noreferrer">${esc(label)}</a>${source.title ? ` — ${esc(source.title)}` : ''}</li>`;
  }).filter(Boolean).join('');
  const contentText = [summary, lead, ...(article.sections || []).flatMap(s => [s.heading, ...(s.paragraphs || [])]), article.conclusion, ...(article.recommendations || []).flatMap(r => [r.audience, r.action, r.basis])].join(' ');
  const schema = { '@context':'https://schema.org','@type':'Article',headline:title,description:summary || lead,datePublished:date,dateModified:date,inLanguage:en?'en':'id',author:{'@type':'Organization',name:'Kabar Kopi Editorial'},publisher:{'@type':'Organization',name:'Kabar Kopi',url:`${SITE}/`},mainEntityOfPage:{'@type':'WebPage','@id':canonical},articleBody:contentText.slice(0,5000),isAccessibleForFree:true };
  const homeLabel = en ? '← Back to Kabar Kopi' : '← Kembali ke Kabar Kopi';
  const sourceLabel = en ? 'Sources' : 'Sumber berita';
  const conclusionLabel = en ? 'Conclusion' : 'Kesimpulan';
  const recommendationLabel = en ? 'Recommendations' : 'Rekomendasi';
  const evidenceLabel = en ? 'Evidence note' : 'Batas bukti';
  const languageLabel = en ? 'Bahasa Indonesia' : 'English';
  return `<!doctype html><html lang="${en?'en':'id'}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)} | Kabar Kopi</title><meta name="description" content="${esc(summary || lead).slice(0,300)}"><link rel="canonical" href="${canonical}"><link rel="alternate" hreflang="id" href="${altId}">${altEn?`<link rel="alternate" hreflang="en" href="${altEn}">`:''}<link rel="alternate" hreflang="x-default" href="${altId}"><meta property="og:type" content="article"><meta property="og:site_name" content="Kabar Kopi"><meta property="og:title" content="${esc(title)}"><meta property="og:description" content="${esc(summary || lead).slice(0,300)}"><meta property="og:url" content="${canonical}"><meta name="twitter:card" content="summary"><script type="application/ld+json">${JSON.stringify(schema).replace(/</g,'\\u003c')}</script><style>:root{color-scheme:light}*{box-sizing:border-box}body{margin:0;background:#fbfaf7;color:#25231f;font:17px/1.75 system-ui,-apple-system,"Segoe UI",sans-serif}.wrap{max-width:850px;margin:auto;padding:28px 22px 64px}nav{display:flex;justify-content:space-between;gap:14px;flex-wrap:wrap;margin-bottom:36px;font-size:14px}a{color:#68472f}article{background:#fff;border:1px solid #e7e1d8;padding:clamp(22px,5vw,56px)}.eyebrow{font-size:12px;text-transform:uppercase;letter-spacing:.12em;color:#a4472d;font-weight:700}h1,h2{font-family:Georgia,serif;line-height:1.25}h1{font-size:clamp(32px,5vw,48px);margin:10px 0 18px}h2{font-size:26px;margin-top:36px}.summary{font-size:20px;font-weight:600;color:#555}.meta{color:#777;font-size:13px;margin:18px 0 26px}.recommendations{padding-left:24px}.basis{color:#726b63;font-size:14px}footer{max-width:850px;margin:0 auto;padding:0 22px 30px;color:#777;font-size:13px}</style></head><body><main class="wrap"><nav><a href="${SITE}/">${homeLabel}</a>${altEn?`<a href="${en?altId:altEn}">${languageLabel}</a>`:''}</nav><article><div class="eyebrow">${en?'AI editorial analysis':'Laporan analisis editorial'} · ${esc(clusterName)}</div><h1>${esc(title)}</h1><p class="summary">${esc(summary)}</p><div class="meta">${en?'Generated':'Dibuat'} ${date ? new Intl.DateTimeFormat(en?'en-GB':'id-ID',{dateStyle:'long',timeZone:'UTC'}).format(new Date(date)) : ''} · ${en?'Automated analysis based on coffee news coverage':'Analisis otomatis dari pemberitaan kopi'}</div><p>${esc(lead)}</p>${sections}<h2>${conclusionLabel}</h2><p>${esc(article.conclusion || '')}</p><h2>${recommendationLabel}</h2><ul class="recommendations">${recommendations}</ul><p class="basis"><strong>${evidenceLabel}:</strong> ${esc(article.evidence_note || '')}</p><h2>${sourceLabel}</h2><ol>${sourceLinks}</ol></article></main><footer>Kabar Kopi · Berita, data, dan analisis industri kopi</footer></body></html>`;
}

let portal = fs.readFileSync(path.join(ROOT, 'scripts/templates/kabar-kopi.html'), 'utf8');
const leadNews = latestNews[0];
if (leadNews) {
  const leadUrl = safeUrl(leadNews.tautan);
  const lead = `<div class="eyebrow">${esc(leadNews.cluster_name || 'Berita kopi terbaru')}</div>${leadUrl ? `<a class="lead-link" href="${esc(leadUrl)}" target="_blank" rel="noopener noreferrer">` : ''}<h1>${esc(leadNews.judul || 'Kabar terbaru tentang kopi')}</h1>${leadUrl ? '</a>' : ''}<p>${esc(leadNews.sumber || 'Sumber berita')}${leadNews.tanggal ? ` · ${esc(new Intl.DateTimeFormat('id-ID',{day:'numeric',month:'short',year:'numeric'}).format(new Date(leadNews.tanggal)))}` : ''}</p>`;
  portal = portal.replace('<!-- STATIC_LEAD -->', lead);
}
const latest = latestNews.slice(1).map(item => {
  const url = safeUrl(item.tautan);
  const title = esc(item.judul || 'Berita kopi');
  return `<li>${url ? `<a href="${esc(url)}" target="_blank" rel="noopener noreferrer">${title}</a>` : title}<div class="meta">${esc(item.sumber || 'Sumber berita')}${item.tanggal ? ` <i class="dot"></i> ${esc(new Intl.DateTimeFormat('id-ID',{day:'numeric',month:'short',year:'numeric'}).format(new Date(item.tanggal)))}` : ''}</div></li>`;
}).join('');
if (latest) portal = portal.replace('<!-- STATIC_LATEST -->', latest);
fs.writeFileSync(path.join(ROOT, 'index.html'), portal);
fs.writeFileSync(path.join(ROOT, 'kabar-kopi.html'), portal);
const urls = [{ loc: `${SITE}/`, lastmod: doc.generated_at || '' }];
for (const item of reports) {
  for (const language of ['id','en']) {
    if (language === 'en' && !item.article_en) continue;
    const file = fileFor(item, language);
    fs.writeFileSync(path.join(output, file), renderPage(item, language));
    urls.push({ loc: `${SITE}/analisis-kopi/${file}`, lastmod: item.generated_at || doc.generated_at || '' });
  }
}
const sitemap = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.map(entry => `  <url><loc>${entry.loc}</loc>${entry.lastmod ? `<lastmod>${entry.lastmod.slice(0,10)}</lastmod>` : ''}</url>`).join('\n')}\n</urlset>\n`;
fs.writeFileSync(path.join(ROOT,'sitemap.xml'),sitemap);
console.log(`Generated ${urls.length - 1} editorial pages and sitemap.`);
