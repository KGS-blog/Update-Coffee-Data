// Render crawlable quarterly prices, keeping explicitly identified bean forms apart.
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const datasetPath = path.join(ROOT, 'data', 'mevo_prices.json');
if (!fs.existsSync(datasetPath)) throw new Error('Run scripts/import-mevo-price-data.js before rendering the coffee-price chart.');
const dataset = JSON.parse(fs.readFileSync(datasetPath, 'utf8'));
const esc = value => String(value ?? '').replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
const quarterIndex = value => {
  const match = /^Q([1-4])\s+(\d{4})$/.exec(String(value || ''));
  return match ? Number(match[2]) * 10 + Number(match[1]) : 0;
};

// The upstream price JSON is authoritative for product form. Do not infer form
// from process labels or product titles when the source provides a form field.
const formLabels = new Map([
  ['biji kopi mentah', 'green'], ['green coffee beans', 'green'], ['green beans', 'green'],
  ['biji kopi sangrai', 'roasted'], ['roasted coffee beans', 'roasted'], ['roasted beans', 'roasted'],
  ['kopi bubuk', 'ground'], ['ground coffee', 'ground'],
]);
const classifyForm = row => {
  const sourceForm = String(row.form || '').trim().toLocaleLowerCase('id-ID');
  if (sourceForm) return formLabels.get(sourceForm) || 'unspecified';
  // Backward compatibility only for old JSON snapshots that predate `form`.
  // Powder is checked first so “roasted ground coffee” is never plotted as beans.
  const product = String(row.product || '');
  if (/\bground\b|\bbubuk\b|\bpowder\b|\binstant\b|\bgiling\b/i.test(product)) return 'ground';
  const green = /\bgreen\s*(?:bean|beans|coffee)\b|\bgreenbean\b|\bunroasted\b|\braw\s+coffee\b|kopi\s+mentah|biji\s+mentah/i.test(product);
  const roasted = /\broast(?:ed|ing)?\b|\bsangrai\b/i.test(product);
  if (green && !roasted) return 'green';
  if (roasted && !green) return 'roasted';
  return 'unspecified';
};
const rawIdr = (dataset.listings || []).filter(row =>
  row && row.currency === 'IDR' && quarterIndex(row.period) &&
  Number.isFinite(Number(row.price_per_kg)) && Number(row.price_per_kg) > 0 &&
  (row.type === 'Arabika' || row.type === 'Robusta')
).map(row => ({ ...row, formClass: classifyForm(row) }));
// Normalize punctuation/spacing in product names to catch repeated snapshots
// whose only difference is a hyphen glyph. Preserve every row in the source JSON;
// only one representative is used in the chart and the rest are logged below.
const normalizeProduct = value => String(value || '').normalize('NFKC').toLocaleLowerCase('id-ID').replace(/[^\p{L}\p{N}]+/gu, ' ').trim().replace(/\s+/g, ' ');
const identity = row => [row.source_url, normalizeProduct(row.product), row.type, row.formClass, row.currency, row.period, row.date, Number(row.price_per_kg)].join('|');
const seen = new Map();
const uniqueIdr = [];
const duplicateRows = [];
for (const row of rawIdr) {
  const key = identity(row);
  if (seen.has(key)) duplicateRows.push({ ...row, duplicate_of: seen.get(key).observation_id });
  else { seen.set(key, row); uniqueIdr.push(row); }
}
// The Indonesia Specialty Coffee source explicitly states that every price is
// quoted in USD. Historical imports were FX-converted but retained as IDR with
// no exchange-rate metadata; exclude these mislabeled values from IDR charts.
const isUsdQuotedSource = row => /(^|\.)specialtycoffee\.id$/i.test(new URL(row.source_url || 'https://invalid.invalid').hostname);
const currencyMismatchRows = uniqueIdr.filter(row => row.currency === 'IDR' && isUsdQuotedSource(row));
const chartableIdr = uniqueIdr.filter(row => !currencyMismatchRows.includes(row));
const median = values => {
  const sorted = values.slice().sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length ? (sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2) : null;
};
const quartile = (sorted, fraction) => {
  const position = (sorted.length - 1) * fraction;
  const lower = Math.floor(position), upper = Math.ceil(position);
  return sorted[lower] + (sorted[upper] - sorted[lower]) * (position - lower);
};
// Flag only source-local statistical extremes with enough observations. This
// avoids treating legitimate price tiers from different market stages as errors.
const sourceGroups = new Map();
for (const row of chartableIdr) {
  // Rows without a stable source URL cannot be compared within a source and
  // therefore remain visible without statistical outlier screening.
  if (!row.source_url) continue;
  const key = [row.type, row.formClass, row.currency, row.period, row.source_url].join('|');
  const group = sourceGroups.get(key) || [];
  group.push(row); sourceGroups.set(key, group);
}
const outlierRows = [];
for (const group of sourceGroups.values()) {
  // Very large source batches often contain several product tiers, so a single
  // IQR fence would mislabel legitimate premium listings as errors.
  if (group.length < 8 || group.length > 100) continue;
  const prices = group.map(row => Number(row.price_per_kg)).sort((a, b) => a - b);
  const q1 = quartile(prices, 0.25), q3 = quartile(prices, 0.75), iqr = q3 - q1;
  const lower = q1 - 1.5 * iqr, upper = q3 + 1.5 * iqr;
  for (const row of group) if (Number(row.price_per_kg) < lower || Number(row.price_per_kg) > upper) {
    outlierRows.push({ ...row, lower_fence: Math.round(lower), upper_fence: Math.round(upper), screening_method: 'Tukey 1.5×IQR; source-local group of at least 8 unique observations' });
  }
}
const outlierIds = new Set(outlierRows.map(row => row.observation_id));
const idr = chartableIdr.filter(row => !outlierIds.has(row.observation_id));
const formRows = {
  green: idr.filter(row => row.formClass === 'green'),
  roasted: idr.filter(row => row.formClass === 'roasted'),
};
const formatIdr = value => `Rp${new Intl.NumberFormat('id-ID', { maximumFractionDigits: 0 }).format(value)}`;
const displayPeriod = period => {
  const match = /^(Q[1-4])\s+(\d{4})$/.exec(period);
  return match ? `${match[2]} · ${match[1]}` : period;
};
const chart = (rows, form, type) => {
  const records = rows.filter(row => row.type === type);
  const periods = [...new Set(records.map(row => row.period))].sort((a, b) => quarterIndex(a) - quarterIndex(b));
  const points = periods.map(period => {
    const observations = records.filter(row => row.period === period);
    return { period, median: median(observations.map(row => Number(row.price_per_kg))), count: observations.length };
  });
  const allPrices = points.map(point => point.median).filter(Number.isFinite);
  const maxPrice = Math.max(50000, Math.ceil(Math.max(...allPrices, 0) / 50000) * 50000);
  const width = 900, height = 330, left = 88, right = 24, top = 24, bottom = 50;
  const plotWidth = width - left - right, plotHeight = height - top - bottom;
  const quarterSpan = Math.max(1, quarterIndex(periods.at(-1)) - quarterIndex(periods[0]));
  const x = period => periods.length === 1 ? left + plotWidth / 2 : left + plotWidth * (quarterIndex(period) - quarterIndex(periods[0])) / quarterSpan;
  const y = value => top + plotHeight * (1 - value / maxPrice);
  const horizontalGrid = Array.from({ length: 5 }, (_, i) => {
    const value = maxPrice * i / 4, yy = y(value);
    return `<line class="grid" x1="${left}" x2="${width-right}" y1="${yy}" y2="${yy}"/><text x="${left-10}" y="${yy+4}" text-anchor="end">${i === 0 ? '0' : `${Math.round(value/1000)}k`}</text>`;
  }).join('');
  const cls = type === 'Arabika' ? 'arabica' : 'robusta';
  const pathD = points.map((point, i) => `${i ? 'L' : 'M'} ${x(point.period)} ${y(point.median)}`).join(' ');
  const line = points.length > 1 ? `<path class="${cls}" d="${pathD}"/>` : '';
  const dots = points.map(point => `<circle class="point ${cls}-point" cx="${x(point.period)}" cy="${y(point.median)}" r="6"><title>${esc(type)} · ${esc(displayPeriod(point.period))} · ${formatIdr(point.median)} · ${point.count} price observations</title></circle>`).join('');
  const periodLabels = periods.map(period => `<text x="${x(period)}" y="${height-16}" text-anchor="middle">${esc(displayPeriod(period))}</text>`).join('');
  const table = `<div class="price-table-scroll"><table class="price-period-table"><thead><tr><th><span class="id-copy">Periode</span><span class="en-copy">Period</span></th><th><span class="id-copy">Median harga/kg</span><span class="en-copy">Median price/kg</span></th><th><span class="id-copy">Jumlah observasi harga</span><span class="en-copy">Price observations</span></th></tr></thead><tbody>${points.map(point => `<tr><th scope="row">${esc(displayPeriod(point.period))}</th><td>${formatIdr(point.median)}</td><td class="count">${point.count.toLocaleString('id-ID')}</td></tr>`).join('')}</tbody></table></div>`;
  const formName = form === 'green' ? ['Green bean', 'Green beans'] : ['Roasted bean', 'Roasted beans'];
  const speciesName = type === 'Arabika' ? ['Arabika', 'Arabica'] : ['Robusta', 'Robusta'];
  const id = `${type.toLowerCase()}-${form}-chart`;
  return `<section class="price-form-panel" aria-labelledby="${id}-heading"><h3 id="${id}-heading"><span class="id-copy">${speciesName[0]} · ${form === 'green' ? 'Biji hijau (green bean)' : 'Biji sangrai (roasted beans)'}</span><span class="en-copy">${speciesName[1]} · ${formName[1]}</span></h3><div class="price-chart-wrap"><svg class="price-chart" viewBox="0 0 ${width} ${height}" role="img" aria-labelledby="${id}-title ${id}-desc"><title id="${id}-title">${speciesName[1]} ${formName[1]} median listing prices per kilogram by period</title><desc id="${id}-desc">Median IDR listing prices for ${speciesName[1]} ${formName[1]}, with processing methods combined.</desc>${horizontalGrid}${line}${dots}${periodLabels}</svg></div>${table}<p class="price-count-note"><span class="id-copy">Jumlah menunjukkan observasi listing harga, bukan transaksi.</span><span class="en-copy">Counts show price-listing observations, not transactions.</span></p></section>`;
};
const usdCount = (dataset.listings || []).filter(row => row && row.currency === 'USD' && quarterIndex(row.period) && Number.isFinite(Number(row.price_per_kg)) && Number(row.price_per_kg) > 0 && (row.type === 'Arabika' || row.type === 'Robusta')).length;
const excludedFormCount = idr.length - formRows.green.length - formRows.roasted.length;
// A comparison warning is separate from outlier handling: low counts or a
// changed source mix weaken quarter-to-quarter comparability without deleting data.
const comparisonWarnings = [];
const periodGroups = new Map();
for (const row of chartableIdr) {
  const key = [row.type, row.formClass, row.currency, row.period].join('|');
  const group = periodGroups.get(key) || { type: row.type, form: row.formClass, period: row.period, sources: new Set(), count: 0 };
  group.sources.add(row.source_url); group.count++; periodGroups.set(key, group);
}
for (const current of periodGroups.values()) {
  const previous = [...periodGroups.values()].filter(g => g.type === current.type && g.form === current.form && quarterIndex(g.period) < quarterIndex(current.period)).sort((a,b)=>quarterIndex(b.period)-quarterIndex(a.period))[0];
  if (!previous) continue;
  const overlap = [...current.sources].filter(source => previous.sources.has(source)).length;
  const union = new Set([...current.sources, ...previous.sources]).size;
  if (previous.count < 5 || (union && overlap / union < 0.5)) comparisonWarnings.push({ type: current.type, form: current.form, period: current.period, previous_period: previous.period, current_count: current.count, previous_count: previous.count, current_sources: [...current.sources], previous_sources: [...previous.sources], source_overlap: overlap, reason: previous.count < 5 ? 'Pembanding periode sebelumnya memiliki kurang dari 5 observasi.' : 'Komposisi sumber periode ini berbeda; sumber yang sama hanya sedikit.' });
}
const channelOf = row => /\bpetani\b|farm[ -]?gate/i.test(row.product || '') ? 'farmgate'
  : /\bgrosir\b|wholesale/i.test(row.product || '') ? 'wholesale'
  : /\beceran\b|retail/i.test(row.product || '') ? 'retail'
  : '';
const marketLevelWarnings = [];
for (const current of periodGroups.values()) {
  const byChannel = new Map();
  for (const row of chartableIdr.filter(row => row.type === current.type && row.formClass === current.form && row.period === current.period)) {
    const channel = channelOf(row); if (channel) byChannel.set(channel, (byChannel.get(channel) || 0) + 1);
  }
  if (byChannel.size > 1) marketLevelWarnings.push({ type: current.type, form: current.form, period: current.period, channels: Object.fromEntries(byChannel) });
}
const labelForm = form => form === 'green' ? 'Biji hijau (green bean)' : 'Biji sangrai (roasted bean)';
const flagged = outlierRows.map(row => `<li><strong>${esc(row.type)} · ${esc(labelForm(row.formClass))} · ${esc(displayPeriod(row.period))}: ${formatIdr(Number(row.price_per_kg))}/kg</strong> — ${esc(row.product)}; ${esc(row.source)}. <span class="id-copy">Terpisah untuk pemeriksaan; tidak masuk median grafik.</span><span class="en-copy">Separated for review; excluded from chart median.</span> <a href="${esc(row.source_url)}" target="_blank" rel="noopener noreferrer"><span class="id-copy">Periksa sumber</span><span class="en-copy">Check source</span></a></li>`).join('');
const duplicateNote = duplicateRows.length ? `${duplicateRows.length} baris duplikat terdeteksi dari perbedaan tanda baca/nama produk dan tidak dihitung dua kali.` : 'Tidak ada duplikat nama-produk yang terdeteksi.';
const warningItems = comparisonWarnings.map(item => `<li><span class="id-copy">${esc(item.type)} · ${esc(labelForm(item.form))} · ${esc(displayPeriod(item.period))} dibanding ${esc(displayPeriod(item.previous_period))}: ${item.current_count} observasi vs ${item.previous_count}; ${esc(item.reason)}</span><span class="en-copy">${esc(item.type)} · ${item.form === 'green' ? 'Green beans' : 'Roasted beans'} · ${esc(displayPeriod(item.period))} vs ${esc(displayPeriod(item.previous_period))}: ${item.current_count} observations vs ${item.previous_count}; ${item.previous_count < 5 ? 'The prior period has fewer than 5 observations.' : 'The source mix changed substantially; few sources overlap.'}</span></li>`).join('');
const levelItems = marketLevelWarnings.map(item => {
  const counts = item.channels;
  const idLabels = { farmgate: 'tingkat petani', wholesale: 'grosir', retail: 'eceran/premium' };
  const enLabels = { farmgate: 'farm-gate', wholesale: 'wholesale', retail: 'retail/premium' };
  const idSummary = Object.entries(counts).map(([key, count]) => `${count} ${idLabels[key]}`).join(', ');
  const enSummary = Object.entries(counts).map(([key, count]) => `${count} ${enLabels[key]}`).join(', ');
  return `<li><span class="id-copy">${esc(item.type)} · ${esc(labelForm(item.form))} · ${esc(displayPeriod(item.period))}: ${idSummary}. Tahap harga berbeda ini tidak sebaiknya dibaca sebagai satu tingkat pasar yang seragam.</span><span class="en-copy">${esc(item.type)} · ${item.form === 'green' ? 'Green beans' : 'Roasted beans'} · ${esc(displayPeriod(item.period))}: ${enSummary}. These different price stages should not be read as one uniform market level.</span></li>`;
}).join('');
const screenHtml = `<details class="price-screening"><summary><span class="id-copy">Pemeriksaan kualitas data</span><span class="en-copy">Data quality screening</span></summary><p><span class="id-copy">${duplicateNote} ${currencyMismatchRows.length.toLocaleString('id-ID')} listing unik dari Indonesia Specialty Coffee tidak dihitung dalam grafik rupiah: sumber aslinya menyatakan semua harga dalam USD, sedangkan data impor menandainya IDR tanpa nilai dan tanggal kurs yang dapat diverifikasi. Pencilan statistik diperiksa per sumber, jenis, bentuk, mata uang, dan periode dengan pagar Tukey 1,5×IQR untuk grup 8–100 listing unik. Penanda berarti perlu ditinjau, bukan otomatis salah.</span><span class="en-copy">${duplicateRows.length} duplicate rows caused by punctuation/product-name variants were detected and are not double-counted. ${currencyMismatchRows.length} unique Indonesia Specialty Coffee listings are excluded from IDR charts: the source states all prices are in USD, while the imported records label them IDR without a verifiable exchange rate and date. Statistical outliers use Tukey’s 1.5×IQR fences within source/type/form/currency/period groups of 8–100 unique listings. A flag means review is needed, not that a value is automatically wrong.</span></p>${flagged ? `<ul>${flagged}</ul>` : `<p><span class="id-copy">Belum ada kandidat pencilan.</span><span class="en-copy">No outlier candidates found.</span></p>`}${warningItems ? `<h4><span class="id-copy">Catatan perbandingan periode</span><span class="en-copy">Period comparison notes</span></h4><ul>${warningItems}</ul>` : ''}${levelItems ? `<h4><span class="id-copy">Campuran tingkat harga</span><span class="en-copy">Mixed price stages</span></h4><ul>${levelItems}</ul>` : ''}<p><a href="/data/mevo_prices_screening.json" target="_blank" rel="noopener noreferrer"><span class="id-copy">Buka rincian screening (JSON) →</span><span class="en-copy">Open screening details (JSON) →</span></a></p></details>`;
const chartHtml = `<div class="price-form-grid">${chart(formRows.green, 'green', 'Arabika')}${chart(formRows.roasted, 'roasted', 'Arabika')}${chart(formRows.green, 'green', 'Robusta')}${chart(formRows.roasted, 'roasted', 'Robusta')}</div><p class="price-form-coverage"><span class="id-copy"><strong>Cakupan: ${rawIdr.length.toLocaleString('id-ID')} observasi berlabel IDR diperiksa.</strong> ${currencyMismatchRows.length.toLocaleString('id-ID')} listing unik dikeluarkan karena mata uang sumber berbeda, ${duplicateRows.length.toLocaleString('id-ID')} duplikat tidak dihitung dua kali, dan ${outlierRows.length.toLocaleString('id-ID')} kandidat pencilan dipisahkan untuk tinjauan. Grafik memakai ${idr.length.toLocaleString('id-ID')} observasi unik. Biji hijau: ${formRows.green.length.toLocaleString('id-ID')}; biji sangrai: ${formRows.roasted.length.toLocaleString('id-ID')}; kopi bubuk atau bentuk tak jelas tidak masuk grafik. ${usdCount.toLocaleString('id-ID')} listing berlabel USD tetap terpisah. Proses digabung. Jumlah adalah listing, bukan transaksi.</span><span class="en-copy"><strong>Scope: ${rawIdr.length.toLocaleString('en-US')} observations labeled IDR were screened.</strong> ${currencyMismatchRows.length.toLocaleString('en-US')} unique listings were excluded due to source-currency mismatch, ${duplicateRows.length.toLocaleString('en-US')} duplicates were not double-counted, and ${outlierRows.length.toLocaleString('en-US')} outlier candidates were separated for review. Charts use ${idr.length.toLocaleString('en-US')} unique observations. Green beans: ${formRows.green.length.toLocaleString('en-US')}; roasted beans: ${formRows.roasted.length.toLocaleString('en-US')}; ground or unclear forms are excluded. ${usdCount.toLocaleString('en-US')} USD-labeled listings remain separate. Processing methods are combined. Counts are listings, not transactions.</span></p>`;
const screening = { generated_at: new Date().toISOString(), method: { duplicate_key: 'source_url + normalized product + type + form + currency + period + date + price_per_kg', source_currency_rule: 'Rows from specialtycoffee.id that were labeled IDR are excluded from IDR charts because the primary source states all its prices are USD; original source-currency prices are not reconstructed without verified FX metadata', outlier_rule: 'Tukey 1.5×IQR within source/type/form/currency/period groups with 8–100 unique observations; large batches are skipped because they can mix product tiers. Flagged items are pending review, not automatically invalid', chart_policy: 'source-currency mismatches, duplicates and flagged outliers excluded from IDR chart medians; raw source rows remain in mevo_prices.json' }, summary: { raw_idr_observations: rawIdr.length, unique_idr_observations: uniqueIdr.length, duplicate_rows: duplicateRows.length, source_currency_mismatch_rows: currencyMismatchRows.length, outlier_candidates: outlierRows.length, chart_eligible_unique_idr_observations: idr.length }, duplicates: duplicateRows.map(row => ({ observation_id: row.observation_id, duplicate_of: row.duplicate_of, type: row.type, form: row.form, period: row.period, date: row.date, price_per_kg: row.price_per_kg, product: row.product, source: row.source, source_url: row.source_url, status: 'duplicate_excluded_from_chart' })), currency_mismatches: currencyMismatchRows.map(row => ({ observation_id: row.observation_id, type: row.type, form: row.form, period: row.period, date: row.date, imported_currency: row.currency, imported_price_per_kg: row.price_per_kg, source_currency: 'USD', product: row.product, source: row.source, source_url: row.source_url, status: 'excluded_from_idr_chart_currency_not_verified' })), outliers: outlierRows.map(row => ({ observation_id: row.observation_id, type: row.type, form: row.form, period: row.period, date: row.date, price_per_kg: row.price_per_kg, lower_fence: row.lower_fence, upper_fence: row.upper_fence, product: row.product, source: row.source, source_url: row.source_url, status: 'pending_manual_review' })), comparison_warnings: comparisonWarnings, market_level_warnings: marketLevelWarnings };
fs.writeFileSync(path.join(ROOT, 'data', 'mevo_prices_screening.json'), `${JSON.stringify(screening, null, 2)}\n`);
const secureSource = value => { try { const url = new URL(String(value || '')); return url.protocol === 'https:' ? url.href : ''; } catch (_) { return ''; } };
// Keep every public source represented by the canonical JSON, including sources
// that currently provide only USD observations (even though charts are IDR-only).
const sources = [...new Map((dataset.listings || []).map(row => [secureSource(row?.source_url), row?.source || row?.source_url]).filter(([url]) => url)).entries()].sort((a,b)=>a[1].localeCompare(b[1]));
const sourceList = sources.map(([url, name]) => `<li><a href="${esc(url)}" target="_blank" rel="noopener noreferrer">${esc(name)}</a></li>`).join('');
const rawUpdatedAt = Date.parse(dataset.generated_at || '');
const updatedAt = Number.isNaN(rawUpdatedAt)
  ? 'tanggal tidak tersedia / date unavailable'
  : `${new Intl.DateTimeFormat('id-ID', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Jakarta' }).format(rawUpdatedAt)} WIB`;
const sourceCount = idr.length.toLocaleString('id-ID');
const replaceRegion = (html, name, value) => {
  const start = `<!-- ${name}_START -->`, end = `<!-- ${name}_END -->`;
  const expression = new RegExp(`${start}[\\s\\S]*?${end}`, 'g');
  if (!html.includes(start) || !html.includes(end)) throw new Error(`Homepage is missing the ${name} render markers.`);
  return html.replace(expression, `${start}${value}${end}`);
};
for (const filename of ['index.html', 'kabar-kopi.html']) {
  const filePath = path.join(ROOT, filename);
  let html = fs.readFileSync(filePath, 'utf8');
  html = replaceRegion(html, 'PRICE_CHART', chartHtml);
  html = replaceRegion(html, 'PRICE_SCREENING', screenHtml);
  html = replaceRegion(html, 'PRICE_SOURCES', sourceList);
  html = replaceRegion(html, 'PRICE_UPDATED', esc(updatedAt));
  html = replaceRegion(html, 'PRICE_COUNT', sourceCount);
  fs.writeFileSync(filePath, html);
}
console.log(`Rendered IDR charts from ${idr.length} price observations: ${formRows.green.length} green-bean, ${formRows.roasted.length} roasted-bean, and ${excludedFormCount} ground or unspecified-form observations excluded; ${usdCount} USD observations are not included in IDR charts.`);
