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
const directPublisherUrl = value => { try { const url = new URL(String(value || '')); return url.protocol === 'https:' && url.hostname !== 'news.google.com' && !url.hostname.endsWith('.google.com'); } catch (_) { return false; } };
const directFeedArticles = (feed.artikel || []).filter(item => item.link_type !== 'aggregator_redirect' && directPublisherUrl(item.tautan));
const feedArticles = directFeedArticles.map(item => {
  const cluster = overrides.get(String(item.tautan || ''));
  return cluster ? { ...item, cluster_id: cluster, cluster_assignment: 'editor_override' } : item;
});
global.window = { BERITA_KLASTER: definitions };
const clustering = clusterBerita(feedArticles);
delete global.window;
const latestNews = directFeedArticles.slice().sort((a, b) => Date.parse(b.tanggal || '') - Date.parse(a.tanggal || '')).slice(0, 6);
const psdDoc = fs.existsSync(path.join(ROOT, 'data/psd.json')) ? JSON.parse(fs.readFileSync(path.join(ROOT, 'data/psd.json'), 'utf8')) : { data: [] };
const exportDoc = fs.existsSync(path.join(ROOT, 'data/ekspor.json')) ? JSON.parse(fs.readFileSync(path.join(ROOT, 'data/ekspor.json'), 'utf8')) : { data: [] };
const reports = (doc.articles || []).filter(item => item.status === 'ai_generated' || item.status === 'editor_selected');
const editorialUpdateNotice = doc.status === 'retained_previous' ? ' Belum cukup berita penerbit langsung untuk membuat laporan baru; laporan terakhir tetap ditampilkan dan belum diperbarui.' : '';
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
const psdMarketLabels = { Production:'Produksi total', 'Arabica Production':'Produksi Arabika', 'Robusta Production':'Produksi Robusta', Exports:'Ekspor total', 'Domestic Consumption':'Konsumsi domestik', 'Ending Stocks':'Stok akhir' };
const psdMarketRows = Object.entries(psdMarketLabels).map(([key,label]) => { const row=psdRows.find(item=>Number(item.tahun)===psdYear&&item.atribut===key); return row?`<tr><th>${label}</th><td>MY ${psdYear}</td><td>${fmtID(Number(row.nilai))}</td></tr>`:'' }).filter(Boolean).join('');
const psdMarketTable = psdMarketRows ? `<table class="market-table"><thead><tr><th>Indikator</th><th>Tahun pemasaran</th><th>Ribu kantong 60 kg</th></tr></thead><tbody>${psdMarketRows}</tbody></table>` : '<p class="empty">Data USDA PSD belum tersedia.</p>';
const exportRows = (exportDoc.data || []).filter(row => !row.trade_flow || row.trade_flow === 'export');
const exportYear = Math.max(0, ...exportRows.map(row => Number(row.year) || 0));
const latestExports = exportRows.filter(row => Number(row.year) === exportYear);
const exportVolume = latestExports.reduce((sum, row) => sum + (Number(row.volume) || 0), 0);
const exportValue = latestExports.reduce((sum, row) => sum + (Number(row.value_usd) || 0), 0);
const exportSummary = exportVolume || exportValue
  ? `<div class="stat"><strong>${fmtID(exportVolume)} ton</strong><span>Volume ekspor ${exportYear}</span></div><div class="stat"><strong>US$ ${(exportValue / 1e9).toLocaleString('id-ID',{maximumFractionDigits:2})} miliar</strong><span>Nilai ekspor ${exportYear}</span></div>`
  : '<div class="empty">Data perdagangan BPS belum tersedia.</div>';
const marketDoc = fs.existsSync(path.join(ROOT, 'data/market-data.json')) ? JSON.parse(fs.readFileSync(path.join(ROOT, 'data/market-data.json'), 'utf8')) : {};
const marketArabica = Number(marketDoc.arabica?.current) || 0;
const marketRobusta = Number(marketDoc.robusta?.current) || 0;
const marketFx = Number(marketDoc.idrUsd?.current) || 0;
const calcArabicaUsdKg = marketArabica / 100 * 2.2046226218;
const marketSnapshotHtml = (value, unit, sourceDate = '') => `<strong>${fmtID(value)} ${unit}</strong>${sourceDate ? ` <span class="source-line">· ${esc(sourceDate)}</span>` : ''}`;
const marketRowsByYear = [...new Set(exportRows.filter(row => row.trade_flow === 'export').map(row => Number(row.year)))].filter(Number.isFinite).sort((a,b)=>b-a).slice(0,2).map(year => {
  const rows = exportRows.filter(row => Number(row.year) === year && row.trade_flow === 'export' && /^09\d{4,}$/.test(String(row.hs_code || '')));
  const totalVolume = rows.reduce((sum,row)=>sum+(Number(row.volume)||0),0);
  const totalValue = rows.reduce((sum,row)=>sum+(Number(row.value_usd)||0),0);
  const arabica = rows.filter(row=>/arabika/i.test(row.hs_description_id||'')).reduce((sum,row)=>sum+(Number(row.volume)||0),0);
  const robusta = rows.filter(row=>/robusta/i.test(row.hs_description_id||'')).reduce((sum,row)=>sum+(Number(row.volume)||0),0);
  return { year, totalVolume, totalValue, html: `<tr><th>${year}</th><td>${fmtID(totalVolume)} ton</td><td>US$ ${(totalValue/1e9).toLocaleString('id-ID',{maximumFractionDigits:2})} miliar</td><td>${fmtID(arabica)}</td><td>${fmtID(robusta)}</td></tr>` };
});
const staticExportTable = marketRowsByYear.length ? `<table class="market-table"><thead><tr><th>Tahun rujukan</th><th>Volume tercatat</th><th>Nilai tercatat</th><th>Arabika (ton)</th><th>Robusta (ton)</th></tr></thead><tbody>${marketRowsByYear.map(row=>row.html).join('')}</tbody></table>` : '<p class="empty">Data ekspor BPS belum tersedia.</p>';
const staticExportTrend = marketRowsByYear.length > 1 ? `Pada baris yang tercakup dalam feed saat ini, volume ekspor tercatat ${((marketRowsByYear[0].totalVolume/marketRowsByYear[1].totalVolume-1)*100)>=0?'naik':'turun'} ${Math.abs((marketRowsByYear[0].totalVolume/marketRowsByYear[1].totalVolume-1)*100).toLocaleString('id-ID',{maximumFractionDigits:1})}% dan nilainya ${((marketRowsByYear[0].totalValue/marketRowsByYear[1].totalValue-1)*100)>=0?'naik':'turun'} ${Math.abs((marketRowsByYear[0].totalValue/marketRowsByYear[1].totalValue-1)*100).toLocaleString('id-ID',{maximumFractionDigits:1})}% dari ${marketRowsByYear[1].year} ke ${marketRowsByYear[0].year}. Ini menjelaskan data yang tersedia, bukan penyebab perubahannya.` : 'Perbandingan tren memerlukan sedikitnya dua tahun data yang tersedia.';
const exportSourceUrl = safeUrl(exportRows.find(row=>Number(row.year)===exportYear&&row.publication_url)?.publication_url)||'https://www.bps.go.id/';
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
const newsCards = directFeedArticles.slice().sort((a,b)=>Date.parse(b.tanggal||'')-Date.parse(a.tanggal||'')).slice(0,24).map(item=>{
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
  const citationText = [summary, lead, ...(article.sections || []).flatMap(section => [section.heading, ...(section.paragraphs || [])]), article.conclusion, ...(article.recommendations || []).flatMap(rec => [rec.audience, rec.action, rec.basis])].join(' ');
  const citationIds = new Set([...citationText.matchAll(/\[(\d+)\]/g)].map(match => match[1]));
  const listedCitationIds = new Set(sources.map(source => String(source.id)));
  const missingCitations = [...citationIds].filter(id => !listedCitationIds.has(id));
  if (missingCitations.length) {
    throw new Error(`Citation/source mismatch in ${item.cluster_id || item.cluster_name} (${en ? 'en' : 'id'}): referenced source number(s) ${missingCitations.join(', ')} are not listed.`);
  }
  const sourceLinks = sources.map(source => {
    const url = safeUrl(source.url);
    if (!url) return '';
    const aggregatorNote = url.hostname === 'news.google.com' ? (en ? ' · Google News aggregator' : ' · agregator Google News') : '';
    const label = `[${source.id}] ${source.source || (en ? 'Original source' : 'Sumber asli')}${aggregatorNote}`;
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
  .replace('<!-- STATIC_MARKET_ARABICA -->', marketSnapshotHtml(marketArabica, '¢/lb'))
  .replace('<!-- STATIC_MARKET_ROBUSTA -->', marketSnapshotHtml(marketRobusta, 'USD/ton ekuivalen', marketDoc.robusta?.sourceDate || ''))
  .replace('<!-- STATIC_MARKET_FX -->', marketSnapshotHtml(marketFx, 'IDR/USD'))
  .replace('<!-- STATIC_USDA_MARKET_TABLE -->', psdMarketTable)
  .replace('<!-- STATIC_CALC_BASE -->', calcArabicaUsdKg.toFixed(3))
  .replace('<!-- STATIC_CALC_FX -->', String(Math.round(marketFx)))
  .replace('<!-- STATIC_EXPORT_TABLE -->', staticExportTable)
  .replace('<!-- STATIC_EXPORT_TREND -->', staticExportTrend)
  .replace('STATIC_EXPORT_SOURCE', esc(exportSourceUrl))
  .replace('<!-- STATIC_HOME_TOPICS -->', topicChips)
  .replace('<!-- STATIC_TOPIC_COUNTS -->', topicRows)
  .replace('<!-- STATIC_NEWS -->', `${newsCards}<p class="source-line">Menampilkan ${fmtID(Math.min(24, directFeedArticles.length))} berita terbaru dengan tautan langsung ke penerbit dari ${fmtID(totalNews)} berita dalam feed. Arsip dan filter lengkap tersedia saat JavaScript aktif.</p>`)
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
  .replace('Artikel disusun dari pemberitaan dan sumber yang tercantum di bawah tiap laporan.', `Pembaruan arsip: ${esc(doc.generated_at||'')} · ${reports.length} laporan editorial. Artikel merangkum berita yang dihimpun; lihat tautan sumber dan batas bukti pada setiap laporan.${esc(editorialUpdateNotice)}`);
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
const aboutPage = `<!doctype html><html lang="id"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Tentang Kabar Kopi: Sumber, Metode, dan Koreksi</title><meta name="description" content="Cara Kabar Kopi mengumpulkan berita, mengelompokkan tema, mengolah data, memakai AI, dan menangani koreksi."><link rel="canonical" href="${SITE}/tentang-kabar-kopi.html"><link rel="icon" type="image/svg+xml" href="/favicon.svg"><script type="application/ld+json">{"@context":"https://schema.org","@type":"AboutPage","name":"Tentang Kabar Kopi","url":"${SITE}/tentang-kabar-kopi.html","isPartOf":{"@type":"WebSite","name":"Kabar Kopi","url":"${SITE}/"}}</script><style>body{max-width:860px;margin:50px auto;padding:0 22px;font:17px/1.75 system-ui,sans-serif;color:#29231e}h1,h2{font-family:Georgia,serif;line-height:1.2}h1{font-size:42px}h2{margin-top:34px}a{color:#704b31}li{margin:9px 0}.note{background:#f5f1eb;border-left:4px solid #a4472d;padding:14px 18px}</style></head><body><p><a href="/">← Kabar Kopi</a></p><main><h1>Tentang Kabar Kopi</h1><p>Kabar Kopi mengumpulkan berita dan data tentang industri kopi, menyusun peta topik, serta menerbitkan analisis editorial publik. Kami berupaya membantu pembaca menelusuri bahan dan memahami cara angka atau tema disajikan.</p><h2>Sumber berita dan tautan</h2><p>Feed berita terbaru dihimpun otomatis dari penerbit dan menautkan pembaca langsung ke halaman sumber. Google News hanya menjadi sumber penemuan tambahan dan dibatasi maksimum 10% dari feed terbaru; item yang URL penerbitnya tidak dapat diverifikasi tetap dilabeli sebagai agregator dan tidak dipakai untuk analisis editorial otomatis. Sebagian arsip historis masih menyimpan tautan Google News ketika alamat penerbit aslinya belum dapat dipastikan; entri seperti itu ditandai sebagai tautan agregator dan tidak dihitung sebagai sumber langsung. Judul atau cuplikan bukan pengganti artikel sumber.</p><h2>Kategori, pengelompokan, dan AI</h2><p>Penentuan topik mengutamakan konteks artikel: sistem membandingkan judul dengan isi yang berhasil diambil dari sumber. Judul menjadi fallback bila isi tidak tersedia atau terlalu tipis; artikel yang kecocokannya belum kuat ditahan di “Lainnya” untuk ditinjau editor. Hasil membantu navigasi dan membaca pola cakupan, tetapi tidak menjamin relevansi sempurna, memverifikasi klaim, atau mengukur dampak ekonomi maupun opini publik. AI dapat membantu sintesis editorial. Sumber dan keterbatasan disertakan sejauh tersedia.</p><h2>Data pasar</h2><p>Harga Arabika C-Market, indikator Robusta ICO, kurs, USDA PSD, dan data perdagangan BPS memiliki sumber, unit, periode, dan jadwal pembaruan masing-masing. Indikator ICO Robusta bukan kontrak futures ICE. Data ekspor mengikuti kode HS pada dataset, sedangkan harga acuan bukan harga transaksi fisik atau harga di tingkat petani.</p><h2>MEVO Coffee Research</h2><p>Report by MEVO merupakan laporan anggota yang diunggah melalui sistem admin. Laporan tersebut terpisah dari Analisis Kopi editorial publik. Setiap report seharusnya mencantumkan periode, pemilihan isu, sumber dan kutipan yang dapat ditelusuri, metode, serta keterbatasannya. Rujukan JBI, PRISMA-S, atau PRISMA-ScR menjelaskan prinsip yang diacu; penyebutan itu tidak berarti report merupakan systematic review atau scoping review akademik formal.</p><h2>Kepentingan dan pengelolaan</h2><p>Kabar Kopi dikembangkan dalam ekosistem Q.co. Hubungan ini relevan saat konten menyebut usaha, produk, atau kegiatan yang terkait dengan ekosistem tersebut; pembaca sebaiknya menilai konteks dan sumbernya. Kabar Kopi tidak menyatakan dukungan resmi dari USDA, BPS, ICO, atau penerbit yang tautannya ditampilkan.</p><h2>Koreksi dan pembaruan</h2><p>Angka feed dan arsip dapat berubah ketika sumber memperbarui data atau proses pengolahan diperbaiki. Jika menemukan kesalahan pada angka, kategori, kutipan, atau atribusi, simpan URL dan bagian yang dimaksud lalu hubungi tim Kabar Kopi melalui kanal kontak resmi situs. Koreksi material sebaiknya mencantumkan perubahan dan tanggal pembaruan.</p><div class="note"><strong>Prinsip membaca:</strong> gunakan laporan sebagai peta informasi dan titik awal pemeriksaan. Untuk keputusan bisnis, cocokkan kembali angka dan klaim dengan sumber primer, periode, definisi, serta kondisi transaksi yang relevan.</div><hr><h1>About Kabar Kopi</h1><p>Kabar Kopi collects news and data about the coffee industry, maps recurring topics, and publishes public editorial analysis. We aim to make the underlying material and presentation of figures or themes easier to inspect.</p><h2>News sources and links</h2><p>The latest news feed is collected from publishers and links readers directly to the source pages. Google News is a supplementary discovery source capped at 10% of the latest feed; unresolved publisher URLs remain labeled as aggregator links and are excluded from automated editorial analysis. Some historical archive entries retain Google News URLs where the original publisher address could not be verified; these are labeled as aggregator links and are not counted as direct sources. Headlines and excerpts do not replace the source article.</p><h2>Classification, clustering, and AI</h2><p>Topic assignment prioritizes article context by comparing each headline with content retrieved from its source. Headlines are a fallback when content is unavailable or too thin; items without a strong match stay in “Other” for editor review. The classification supports navigation and coverage analysis, but does not guarantee perfect relevance, verify claims, or measure economic impact or public opinion. AI may assist editorial synthesis. Sources and limitations are shown with reports where available.</p><h2>Market data</h2><p>Arabica C-Market prices, the ICO Robusta indicator, exchange rates, USDA PSD, and BPS trade data each have their own sources, units, periods, and update schedules. The ICO Robusta indicator is not an ICE futures contract. Export figures follow the dataset’s HS codes, and reference prices are not physical transaction or farm-gate prices.</p><h2>MEVO Coffee Research</h2><p>Report by MEVO consists of member reports uploaded through the admin system and is separate from public editorial Coffee Analysis. Reports should identify the period, issue selection, traceable sources and quotations, method, and limitations. References to JBI, PRISMA-S, or PRISMA-ScR indicate principles consulted; they do not make a report a formal academic systematic or scoping review.</p><h2>Interests and stewardship</h2><p>Kabar Kopi is developed within the Q.co ecosystem. This relationship is relevant when content discusses businesses, products, or activities connected to that ecosystem; readers should consider the context and sources. Kabar Kopi does not imply official endorsement by USDA, BPS, ICO, or linked publishers.</p><h2>Corrections and updates</h2><p>Feed figures and archives may change when a source updates its data or processing is improved. For an error in a figure, classification, quotation, or attribution, keep the URL and relevant passage and contact the Kabar Kopi team through the site’s official contact channel. Material corrections should identify what changed and when.</p><div class="note"><strong>How to use this site:</strong> treat reports as an information map and a starting point for verification. For business decisions, check figures and claims against primary sources, periods, definitions, and relevant transaction conditions.</div></main></body></html>`;
fs.writeFileSync(path.join(ROOT, 'tentang-kabar-kopi.html'), aboutPage);
const urls = [
  { loc: `${SITE}/`, lastmod: doc.generated_at || '' },
  { loc: `${SITE}/en/`, lastmod: doc.generated_at || '' },
  { loc: `${SITE}/tentang-kabar-kopi.html`, lastmod: doc.generated_at || '' },
  { loc: `${SITE}/data-tren-kopi/`, lastmod: doc.generated_at || '' },
  { loc: `${SITE}/en/coffee-market-data/`, lastmod: doc.generated_at || '' },
  { loc: `${SITE}/kalkulator-kopi/`, lastmod: doc.generated_at || '' },
  { loc: `${SITE}/en/coffee-export-calculator/`, lastmod: doc.generated_at || '' },
];
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
