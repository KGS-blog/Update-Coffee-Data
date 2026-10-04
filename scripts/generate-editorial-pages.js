const fs = require('node:fs');
const path = require('node:path');
const { BERITA_KLASTER, clusterBerita } = require('../BERITA_KLASTER_FINAL.js');

const ROOT = path.resolve(__dirname, '..');
const SITE = 'https://kabarkopi.qcoid.com';
const sourcePath = path.join(ROOT, 'data/editorial-current.json');
const doc = fs.existsSync(sourcePath) ? JSON.parse(fs.readFileSync(sourcePath, 'utf8')) : { articles: [] };
const feedPath = path.join(ROOT, 'data/berita-all.json');
const feed = fs.existsSync(feedPath) ? JSON.parse(fs.readFileSync(feedPath, 'utf8')) : { artikel: [] };
const catalogPath = path.join(ROOT, 'data/cluster-catalog.json');
const decisionsPath = path.join(ROOT, 'data/cluster-decisions.json');
const catalog = fs.existsSync(catalogPath) ? JSON.parse(fs.readFileSync(catalogPath, 'utf8')) : { clusters: BERITA_KLASTER };
const decisions = fs.existsSync(decisionsPath) ? JSON.parse(fs.readFileSync(decisionsPath, 'utf8')) : { overrides: [] };
const definitions = Array.isArray(catalog.clusters) && catalog.clusters.length ? catalog.clusters : BERITA_KLASTER;
const overrides = new Map((decisions.overrides || []).map(item => [String(item.url || item.tautan || ''), item.cluster_id || item.klaster]));
const feedArticles = (feed.artikel || []).map(item => {
  const cluster = overrides.get(String(item.tautan || ''));
  return cluster ? { ...item, cluster_id: cluster, cluster_assignment: 'editor_override' } : item;
});
global.window = { BERITA_KLASTER: definitions };
const clustering = clusterBerita(feedArticles);
delete global.window;
const latestNews = (feed.artikel || []).slice().sort((a, b) => Date.parse(b.tanggal || '') - Date.parse(a.tanggal || '')).slice(0, 6);
const psdDoc = fs.existsSync(path.join(ROOT, 'data/psd.json')) ? JSON.parse(fs.readFileSync(path.join(ROOT, 'data/psd.json'), 'utf8')) : { data: [] };
const exportDoc = fs.existsSync(path.join(ROOT, 'data/ekspor.json')) ? JSON.parse(fs.readFileSync(path.join(ROOT, 'data/ekspor.json'), 'utf8')) : { data: [] };
const reports = (doc.articles || []).filter(item => item.status === 'ai_generated' || item.status === 'editor_selected');
const output = path.join(ROOT, 'analisis-kopi');
fs.mkdirSync(output, { recursive: true });

const esc = value => String(value || '').replace(/[&<>"']/g, char => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[char]));
const slugify = value => String(value || '').normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/&/g,' dan ').replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'').slice(0,70) || 'analisis-pasar-kopi';
const safeUrl = value => { try { const url = new URL(value); return ['https:','http:'].includes(url.protocol) ? url.href : ''; } catch (_) { return ''; } };
const sourceRouteLabel = value => { try { return new URL(value).hostname === 'news.google.com' ? ' · tautan Google News' : ''; } catch (_) { return ''; } };
const fmtID = value => new Intl.NumberFormat('id-ID').format(value);
const lastDataDate = [psdDoc.fetched, exportDoc.fetched].filter(Boolean).sort().at(-1);
const dataUpdated = psdDoc.status === 'stale'
  ? `Data USDA: pembaruan terakhir berhasil ${psdDoc.fetched ? new Intl.DateTimeFormat('id-ID',{day:'numeric',month:'short',year:'numeric',timeZone:'UTC'}).format(new Date(psdDoc.fetched)) : 'tanggal tidak tersedia'}`
  : lastDataDate ? `Data terakhir diperbarui ${new Intl.DateTimeFormat('id-ID',{day:'numeric',month:'short',year:'numeric',timeZone:'UTC'}).format(new Date(lastDataDate))}` : 'Tanggal pembaruan data tidak tersedia';
const psdRows = psdDoc.data || [];
const psdYear = Math.max(0, ...psdRows.map(row => Number(row.tahun) || 0));
const psdLabels = { Production: 'Produksi', Exports: 'Ekspor', 'Domestic Consumption': 'Konsumsi domestik', 'Ending Stocks': 'Stok akhir' };
const psdSummary = Object.entries(psdLabels).map(([key, label]) => {
  const row = psdRows.find(item => Number(item.tahun) === psdYear && item.atribut === key);
  return row ? `<div class="stat"><strong>${fmtID(Number(row.nilai))}</strong><span>${label} · MY ${psdYear}</span></div>` : '';
}).join('') || '<div class="empty">Data USDA belum tersedia.</div>';
const exportRows = (exportDoc.data || []).filter(row => !row.trade_flow || row.trade_flow === 'export');
const exportYear = Math.max(0, ...exportRows.map(row => Number(row.year) || 0));
const latestExports = exportRows.filter(row => Number(row.year) === exportYear);
const exportVolume = latestExports.reduce((sum, row) => sum + (Number(row.volume) || 0), 0);
const exportValue = latestExports.reduce((sum, row) => sum + (Number(row.value_usd) || 0), 0);
const exportSummary = exportVolume || exportValue
  ? `<div class="stat"><strong>${fmtID(exportVolume)} ton</strong><span>Volume ekspor ${exportYear}</span></div><div class="stat"><strong>US$ ${(exportValue / 1e9).toLocaleString('id-ID',{maximumFractionDigits:2})} miliar</strong><span>Nilai ekspor ${exportYear}</span></div>`
  : '<div class="empty">Data perdagangan BPS belum tersedia.</div>';
const fileFor = (item, language) => `${slugify(item.cluster_id || item.cluster_name || item.article?.title || item.article_en?.title)}-${language}.html`;
const newsDate = item => item.tanggal ? new Intl.DateTimeFormat('id-ID',{day:'numeric',month:'short',year:'numeric'}).format(new Date(item.tanggal)) : '';
const categories = (clustering.klaster || []).slice();
if ((clustering.lainnya_items || []).length) categories.push({ nama: 'Lainnya', items: clustering.lainnya_items });
categories.sort((a,b)=>(b.items||[]).length-(a.items||[]).length);
const classifiedCategories = categories.filter(c => String(c.nama).toLocaleLowerCase('id') !== 'lainnya');
const unclassifiedCount = (clustering.lainnya_items || []).length;
const topicChips = classifiedCategories.slice(0,10).map(c=>`<button class="topic-chip" data-topic="${esc(c.nama)}">${esc(c.nama)} · ${fmtID((c.items||[]).length)}</button>`).join('') + (unclassifiedCount ? `<span class="topic-chip" aria-label="Berita belum terklasifikasi">Belum terklasifikasi · ${fmtID(unclassifiedCount)}</span>` : '');
const topicRows = classifiedCategories.slice(0,10).map(c=>`<div class="topic-row"><button data-topic="${esc(c.nama)}">${esc(c.nama)}</button><span>${fmtID((c.items||[]).length)} berita</span></div>`).join('') + (unclassifiedCount ? `<div class="topic-row"><span>Belum terklasifikasi</span><span>${fmtID(unclassifiedCount)} berita</span></div>` : '') || '<p class="empty">Peta topik belum tersedia.</p>';
const totalNews = Number(clustering.total_artikel) || (feed.artikel||[]).length;
const topicNames = new Map(categories.flatMap(c=>(c.items||[]).map(item=>[String(item.tautan||''),c.nama])));
const newsCards = feedArticles.slice().sort((a,b)=>Date.parse(b.tanggal||'')-Date.parse(a.tanggal||'')).slice(0,24).map(item=>{
  const url=safeUrl(item.tautan), title=esc(item.judul||'Berita kopi'), cluster=esc(topicNames.get(String(item.tautan||''))||'Lainnya');
  return `<article class="news-card"><span class="category">${cluster}</span><h2 class="news-title">${url?`<a href="${esc(url)}" target="_blank" rel="noopener noreferrer">${title}</a>`:title}</h2><div class="meta">${esc(item.sumber||'Sumber berita')}${newsDate(item)?` <i class="dot"></i> ${newsDate(item)}`:''}${sourceRouteLabel(url)}</div>${item.ringkasan?`<p class="news-desc">${esc(item.ringkasan)}</p>`:''}</article>`;
}).join('');
const analysisCards = classifiedCategories.map((c,index)=>{const count=(c.items||[]).length, share=totalNews?count/totalNews*100:0, avg=classifiedCategories.length?totalNews/classifiedCategories.length:0;return `<article class="analysis-card"><div class="eyebrow">${fmtID(count)} berita</div><div class="num">${Math.round(share)}%</div><h3>${esc(c.nama)}</h3><p>${avg?(count/avg).toLocaleString('id-ID',{maximumFractionDigits:1}):'0'}× rata-rata volume klaster · peringkat ${index+1} dari ${classifiedCategories.length}</p><div class="bar" aria-label="Porsi dari seluruh berita"><i style="width:${Math.max(1,share)}%"></i></div></article>`}).join('');
const publicReports = reports.map(item=>{const article=item.article||{}, page=`analisis-kopi/${fileFor(item,'id')}`, cluster=BERITA_KLASTER.find(entry=>entry.slug===item.cluster_id||entry.nama===item.cluster_name), used=new Set(article.source_urls||[]);let refs=(item.input_sources||[]).filter(s=>used.has(s.url));if(!refs.length)refs=item.input_sources||[];const sources=refs.map(s=>{const u=safeUrl(s.url);return u?`<li><a href="${esc(u)}" rel="noopener noreferrer">[${esc(s.id)}] ${esc(s.source||'Sumber asli')}${s.title?` — ${esc(s.title)}`:''}</a></li>`:''}).filter(Boolean).join('');return `<article class="report-card"><span class="candidate-badge">Artikel analisis · Publik · ${esc(item.cluster_name||cluster?.nama||'Kopi')} · ${esc(item.period_days||'')} hari</span><h3><a href="${esc(page)}">${esc(article.title||'Analisis pasar kopi')}</a></h3>${article.summary?`<p><strong>${esc(article.summary)}</strong></p>`:''}${article.lead?`<p>${esc(article.lead)}</p>`:''}<p class="source-line">Analisis editorial otomatis dari berita yang dihimpun. Kategori dan jumlah berita menunjukkan pola pemberitaan, bukan verifikasi kebenaran klaim atau dampak ekonomi.</p>${sources?`<details><summary>Sumber yang dikutip (${refs.length})</summary><ol>${sources}</ol></details>`:''}<p><a href="${esc(page)}">Baca analisis lengkap, kesimpulan, rekomendasi, sumber, dan batas bukti →</a></p></article>`}).join('');
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
portal = portal.replace('<!-- STATIC_PSD_TIME -->', esc(dataUpdated))
  .replace('<!-- STATIC_PSD_SUMMARY -->', psdSummary)
  .replace('<!-- STATIC_BPS_SUMMARY -->', exportSummary)
  .replace('<!-- STATIC_HOME_TOPICS -->', topicChips)
  .replace('<!-- STATIC_TOPIC_COUNTS -->', topicRows)
  .replace('<!-- STATIC_NEWS -->', `${newsCards}<p class="source-line">Menampilkan 24 berita terbaru dari ${fmtID(totalNews)} berita dalam feed. Pencarian arsip dan filter interaktif tersedia saat JavaScript aktif.</p>`)
  .replace('<!-- STATIC_CLUSTERS -->', analysisCards || '<p class="empty">Peta topik belum tersedia.</p>')
  .replace('<!-- STATIC_EDITORIAL_REPORTS -->', publicReports || '<p class="empty">Belum ada analisis editorial yang diterbitkan.</p>');
const feedStamp = feed.fetched || feed.updated_at || feed.fetched_at || feed.updated || '';
const stampText = feedStamp ? new Intl.DateTimeFormat('id-ID',{day:'numeric',month:'long',year:'numeric',hour:'2-digit',minute:'2-digit',timeZone:'Asia/Jakarta'}).format(new Date(feedStamp)) : 'Pembaruan feed berkala';
portal = portal.replace('Memuat kabar terbaru…', `Feed berisi ${fmtID(totalNews)} berita · diperbarui ${esc(stampText)}`)
  .replace('Mengambil berita kopi terbaru…', esc(latestNews.map(item=>item.judul).filter(Boolean).slice(0,4).join(' · ') || 'Berita kopi dari berbagai sumber'))
  .replace('Memuat feed berita…', '')
  .replace('Menghitung topik…', '')
  .replace('Memuat hasil clustering…', '')
  .replace('Memuat laporan…', '')
  .replace('Artikel disusun dari pemberitaan dan sumber yang tercantum di bawah tiap laporan.', `Pembaruan arsip: ${esc(doc.generated_at||'')} · ${reports.length} laporan editorial. Artikel merangkum berita yang dihimpun; lihat tautan sumber dan batas bukti pada setiap laporan.`);
const leadNews = latestNews.find(item => {
  const category = topicNames.get(String(item.tautan || ''));
  return category && !['Lainnya', 'Other'].includes(category);
}) || latestNews[0];
if (leadNews) {
  const leadUrl = safeUrl(leadNews.tautan);
  const lead = `<div class="eyebrow">${esc(topicNames.get(String(leadNews.tautan||'')) || 'Berita kopi terbaru')}</div>${leadUrl ? `<a class="lead-link" href="${esc(leadUrl)}" target="_blank" rel="noopener noreferrer">` : ''}<h1>${esc(leadNews.judul || 'Kabar terbaru tentang kopi')}</h1>${leadUrl ? '</a>' : ''}<p>${esc(leadNews.sumber || 'Sumber berita')}${leadNews.tanggal ? ` · ${esc(new Intl.DateTimeFormat('id-ID',{day:'numeric',month:'short',year:'numeric'}).format(new Date(leadNews.tanggal)))}` : ''}${sourceRouteLabel(leadUrl)}</p>`;
  portal = portal.replace('<!-- STATIC_LEAD -->', lead);
}
const latest = latestNews.slice(1).map(item => {
  const url = safeUrl(item.tautan);
  const title = esc(item.judul || 'Berita kopi');
  return `<li>${url ? `<a href="${esc(url)}" target="_blank" rel="noopener noreferrer">${title}</a>` : title}<div class="meta">${esc(item.sumber || 'Sumber berita')}${item.tanggal ? ` <i class="dot"></i> ${esc(new Intl.DateTimeFormat('id-ID',{day:'numeric',month:'short',year:'numeric'}).format(new Date(item.tanggal)))}` : ''}${sourceRouteLabel(url)}</div></li>`;
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
