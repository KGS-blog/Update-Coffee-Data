// Render crawlable quarterly prices, keeping explicitly identified bean forms apart.
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const MEAN_BAND = 0.25;
const MEAN_BAND_LABEL = `${Math.round(MEAN_BAND * 100)}%`;
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
const sourceIdentity = row => row.source_type === 'field'
  ? `field:${normalizeProduct(row.source)}:${normalizeProduct(row.source_detail)}`
  : `url:${row.source_url}`;
const identity = row => [sourceIdentity(row), normalizeProduct(row.product), row.type, row.formClass, row.currency, row.period, row.date, Number(row.price_per_kg)].join('|');
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
// Keep listings within ±25% of the arithmetic mean for each period, type,
// and bean form. Process and market tier stay pooled as requested. If a group
// has observations but none falls in-band, retain the observation nearest the
// mean so screening can never turn an existing period into zero data.
const meanGroups = new Map();
for (const row of chartableIdr) {
  const key = [row.type, row.formClass, row.currency, row.period].join('|');
  const group = meanGroups.get(key) || { rows: [], total: 0 };
  group.rows.push(row);
  group.total += Number(row.price_per_kg);
  meanGroups.set(key, group);
}
const outlierRows = [];
const includedIds = new Set();
const meanGroupSummaries = [];
for (const group of meanGroups.values()) {
  const mean = group.total / group.rows.length;
  const lower = mean * (1 - MEAN_BAND);
  const upper = mean * (1 + MEAN_BAND);
  const inBand = group.rows.filter(row => {
    const price = Number(row.price_per_kg);
    return price >= lower && price <= upper;
  });
  const fallback = inBand.length ? [] : [group.rows.reduce((closest, row) =>
    Math.abs(Number(row.price_per_kg) - mean) < Math.abs(Number(closest.price_per_kg) - mean) ? row : closest
  )];
  const includedRows = [...inBand, ...fallback];
  const includedGroupIds = new Set(includedRows.map(row => row.observation_id));
  for (const row of group.rows) {
    const price = Number(row.price_per_kg);
    if (includedGroupIds.has(row.observation_id)) {
      includedIds.add(row.observation_id);
    } else {
      outlierRows.push({ ...row, group_mean: Math.round(mean), lower_limit: Math.round(lower), upper_limit: Math.round(upper), screening_method: `Outside ±${MEAN_BAND_LABEL} of arithmetic mean for same type/form/period` });
    }
  }
  const first = group.rows[0];
  meanGroupSummaries.push({ type: first.type, formClass: first.formClass, period: first.period, mean: Math.round(mean), lower: Math.round(lower), upper: Math.round(upper), total: group.rows.length, included: includedRows.length, excluded: group.rows.length - includedRows.length, fallback_to_nearest_mean: fallback.length > 0 });
}
const idr = chartableIdr.filter(row => includedIds.has(row.observation_id));
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
  const allRecords = chartableIdr.filter(row => row.type === type && row.formClass === form);
  const periods = [...new Set(allRecords.map(row => row.period))].sort((a, b) => quarterIndex(a) - quarterIndex(b));
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
  let hasPreviousPoint = false;
  const pathD = points.map(point => {
    if (!Number.isFinite(point.median)) { hasPreviousPoint = false; return ''; }
    const command = hasPreviousPoint ? 'L' : 'M';
    hasPreviousPoint = true;
    return `${command} ${x(point.period)} ${y(point.median)}`;
  }).filter(Boolean).join(' ');
  const line = pathD.includes('L') ? `<path class="${cls}" d="${pathD}"/>` : '';
  const dots = points.map(point => Number.isFinite(point.median)
    ? `<circle class="point ${cls}-point" cx="${x(point.period)}" cy="${y(point.median)}" r="6"><title>${esc(type)} · ${esc(displayPeriod(point.period))} · ${formatIdr(point.median)} · ${point.count} price observations within range</title></circle>`
    : `<text class="no-data" x="${x(point.period)}" y="${top + plotHeight / 2}" text-anchor="middle"><title>No source listings available for this period</title>—</text>`).join('');
  const periodLabels = periods.map(period => `<text x="${x(period)}" y="${height-16}" text-anchor="middle">${esc(displayPeriod(period))}</text>`).join('');
  const table = `<div class="price-table-scroll"><table class="price-period-table"><thead><tr><th><span class="id-copy">Periode</span><span class="en-copy">Period</span></th><th><span class="id-copy">Median harga/kg</span><span class="en-copy">Median price/kg</span></th><th><span class="id-copy">Jumlah observasi harga</span><span class="en-copy">Price observations</span></th></tr></thead><tbody>${points.map(point => `<tr><th scope="row">${esc(displayPeriod(point.period))}</th><td>${Number.isFinite(point.median) ? formatIdr(point.median) : '<span class="id-copy">Tidak ada listing dalam rentang</span><span class="en-copy">No listings in range</span>'}</td><td class="count">${point.count.toLocaleString('id-ID')}</td></tr>`).join('')}</tbody></table></div>`;
  const formName = form === 'green' ? ['Green bean', 'Green beans'] : ['Roasted bean', 'Roasted beans'];
  const speciesName = type === 'Arabika' ? ['Arabika', 'Arabica'] : ['Robusta', 'Robusta'];
  const id = `${type.toLowerCase()}-${form}-chart`;
  return `<section class="price-form-panel" aria-labelledby="${id}-heading"><h3 id="${id}-heading"><span class="id-copy">${speciesName[0]} · ${form === 'green' ? 'Biji hijau (green bean)' : 'Biji sangrai (roasted beans)'}</span><span class="en-copy">${speciesName[1]} · ${formName[1]}</span></h3><div class="price-chart-wrap"><svg class="price-chart" viewBox="0 0 ${width} ${height}" role="img" aria-labelledby="${id}-title ${id}-desc"><title id="${id}-title">${speciesName[1]} ${formName[1]} median listing prices per kilogram by period</title><desc id="${id}-desc">Median IDR listing prices for ${speciesName[1]} ${formName[1]}, with processing methods combined.</desc>${horizontalGrid}${line}${dots}${periodLabels}</svg></div>${table}<p class="price-count-note"><span class="id-copy">Jumlah menunjukkan observasi listing harga, bukan transaksi.</span><span class="en-copy">Counts show price-listing observations, not transactions.</span></p></section>`;
};
const usdCount = (dataset.listings || []).filter(row => row && row.currency === 'USD' && quarterIndex(row.period) && Number.isFinite(Number(row.price_per_kg)) && Number(row.price_per_kg) > 0 && (row.type === 'Arabika' || row.type === 'Robusta')).length;
const excludedFormCount = idr.length - formRows.green.length - formRows.roasted.length;
// Low included counts or a changed source mix weaken quarter-to-quarter
// comparability; those warnings are computed after applying the display band.
const comparisonWarnings = [];
const periodGroups = new Map();
for (const row of idr) {
  const key = [row.type, row.formClass, row.currency, row.period].join('|');
  const group = periodGroups.get(key) || { type: row.type, form: row.formClass, period: row.period, sources: new Set(), count: 0 };
  group.sources.add(sourceIdentity(row)); group.count++; periodGroups.set(key, group);
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
  : ['customer', 'reseller', 'retail', 'wholesale', 'farmgate'].includes(row.price_level) ? row.price_level
  : '';
const marketLevelWarnings = [];
for (const current of periodGroups.values()) {
  const byChannel = new Map();
  for (const row of idr.filter(row => row.type === current.type && row.formClass === current.form && row.period === current.period)) {
    const channel = channelOf(row); if (channel) byChannel.set(channel, (byChannel.get(channel) || 0) + 1);
  }
  if (byChannel.size > 1) marketLevelWarnings.push({ type: current.type, form: current.form, period: current.period, channels: Object.fromEntries(byChannel) });
}
const labelForm = form => form === 'green' ? 'Biji hijau (green bean)' : 'Biji sangrai (roasted bean)';
const flagged = meanGroupSummaries.filter(group => group.excluded > 0).map(group => `<li><strong>${esc(group.type)} · ${esc(labelForm(group.formClass))} · ${esc(displayPeriod(group.period))}</strong>: <span class="id-copy">rata-rata ${formatIdr(group.mean)}/kg; rentang ${formatIdr(group.lower)}–${formatIdr(group.upper)}/kg; ${group.included} dari ${group.total} listing masuk, ${group.excluded} dikeluarkan.</span><span class="en-copy">mean ${formatIdr(group.mean)}/kg; range ${formatIdr(group.lower)}–${formatIdr(group.upper)}/kg; ${group.included} of ${group.total} listings included, ${group.excluded} excluded.</span></li>`).join('');
const duplicateNote = duplicateRows.length ? `${duplicateRows.length} baris duplikat terdeteksi dari perbedaan tanda baca/nama produk dan tidak dihitung dua kali.` : 'Tidak ada duplikat nama-produk yang terdeteksi.';
const warningItems = comparisonWarnings.map(item => `<li><span class="id-copy">${esc(item.type)} · ${esc(labelForm(item.form))} · ${esc(displayPeriod(item.period))} dibanding ${esc(displayPeriod(item.previous_period))}: ${item.current_count} observasi vs ${item.previous_count}; ${esc(item.reason)}</span><span class="en-copy">${esc(item.type)} · ${item.form === 'green' ? 'Green beans' : 'Roasted beans'} · ${esc(displayPeriod(item.period))} vs ${esc(displayPeriod(item.previous_period))}: ${item.current_count} observations vs ${item.previous_count}; ${item.previous_count < 5 ? 'The prior period has fewer than 5 observations.' : 'The source mix changed substantially; few sources overlap.'}</span></li>`).join('');
const levelItems = marketLevelWarnings.map(item => {
  const counts = item.channels;
  const idLabels = { farmgate: 'tingkat petani', wholesale: 'grosir', retail: 'eceran/premium', customer: 'harga customer', reseller: 'harga reseller' };
  const enLabels = { farmgate: 'farm-gate', wholesale: 'wholesale', retail: 'retail/premium', customer: 'customer price', reseller: 'reseller price' };
  const idSummary = Object.entries(counts).map(([key, count]) => `${count} ${idLabels[key]}`).join(', ');
  const enSummary = Object.entries(counts).map(([key, count]) => `${count} ${enLabels[key]}`).join(', ');
  return `<li><span class="id-copy">${esc(item.type)} · ${esc(labelForm(item.form))} · ${esc(displayPeriod(item.period))}: ${idSummary}. Tingkat harga yang berbeda ditampilkan bersama dalam acuan ini; jangan dibaca sebagai satu harga pada tingkat pasar yang sama.</span><span class="en-copy">${esc(item.type)} · ${item.form === 'green' ? 'Green beans' : 'Roasted beans'} · ${esc(displayPeriod(item.period))}: ${enSummary}. Different price tiers are included in this reference; do not read them as one market-level price.</span></li>`;
}).join('');
const screenHtml = `<details class="price-screening"><summary><span class="id-copy">Pemeriksaan kualitas data</span><span class="en-copy">Data quality screening</span></summary><p><span class="id-copy">${duplicateNote} ${currencyMismatchRows.length.toLocaleString('id-ID')} listing unik dari Indonesia Specialty Coffee tidak dihitung dalam grafik rupiah: sumber aslinya menyatakan semua harga dalam USD, sedangkan data impor menandainya IDR tanpa nilai dan tanggal kurs yang dapat diverifikasi. Untuk setiap periode, jenis, dan bentuk biji, grafik hanya memuat listing dalam rentang 75%–125% dari rata-rata aritmetika grup; metode proses digabung. Jika tidak ada listing yang lolos, satu listing terdekat ke rata-rata tetap ditampilkan. Listing lain di luar rentang diringkas per grup di bawah; data mentah tetap tersimpan. Grup dengan satu observasi tidak menyediakan pembanding variasi.</span><span class="en-copy">${duplicateRows.length} duplicate rows caused by punctuation/product-name variants were detected and are not double-counted. ${currencyMismatchRows.length} unique Indonesia Specialty Coffee listings are excluded from IDR charts: the source states all prices are in USD, while the imported records label them IDR without a verifiable exchange rate and date. For each period, coffee type, and bean form, charts include listings within 75%–125% of the group arithmetic mean; processing methods are pooled. If no listing passes, the one nearest the mean remains visible. Other listings outside the band are summarized by group below; raw data remains stored. A group with one observation cannot show price variation.</span></p>${flagged ? `<ul>${flagged}</ul>` : `<p><span class="id-copy">Semua listing yang diperiksa berada dalam rentang rata-rata ±25%.</span><span class="en-copy">All screened listings fall within the mean ±25% band.</span></p>`}${warningItems ? `<h4><span class="id-copy">Catatan perbandingan periode</span><span class="en-copy">Period comparison notes</span></h4><ul>${warningItems}</ul>` : ''}${levelItems ? `<h4><span class="id-copy">Campuran tingkat harga</span><span class="en-copy">Mixed price stages</span></h4><ul>${levelItems}</ul>` : ''}</details>`;
const chartHtml = `<div class="price-form-grid">${chart(formRows.green, 'green', 'Arabika')}${chart(formRows.roasted, 'roasted', 'Arabika')}${chart(formRows.green, 'green', 'Robusta')}${chart(formRows.roasted, 'roasted', 'Robusta')}</div><p class="price-form-coverage"><span class="id-copy"><strong>Cakupan: ${rawIdr.length.toLocaleString('id-ID')} observasi berlabel IDR diperiksa.</strong> ${currencyMismatchRows.length.toLocaleString('id-ID')} listing unik dikeluarkan karena mata uang sumber berbeda, ${duplicateRows.length.toLocaleString('id-ID')} duplikat tidak dihitung dua kali, dan ${outlierRows.length.toLocaleString('id-ID')} listing di luar rentang rata-rata ±25% dipisahkan. Grafik memakai ${idr.length.toLocaleString('id-ID')} observasi unik. Biji hijau: ${formRows.green.length.toLocaleString('id-ID')}; biji sangrai: ${formRows.roasted.length.toLocaleString('id-ID')}; kopi bubuk atau bentuk tak jelas tidak masuk grafik. ${usdCount.toLocaleString('id-ID')} listing berlabel USD tetap terpisah. Proses digabung. Jumlah adalah listing, bukan transaksi.</span><span class="en-copy"><strong>Scope: ${rawIdr.length.toLocaleString('en-US')} observations labeled IDR were screened.</strong> ${currencyMismatchRows.length.toLocaleString('en-US')} unique listings were excluded due to source-currency mismatch, ${duplicateRows.length.toLocaleString('en-US')} duplicates were not double-counted, and ${outlierRows.length.toLocaleString('en-US')} listings outside the mean ±25% band were excluded. Charts use ${idr.length.toLocaleString('en-US')} unique observations. Green beans: ${formRows.green.length.toLocaleString('en-US')}; roasted beans: ${formRows.roasted.length.toLocaleString('en-US')}; ground or unclear forms are excluded. ${usdCount.toLocaleString('en-US')} USD-labeled listings remain separate. Processing methods are combined. Counts are listings, not transactions.</span></p>`;
const screening = { generated_at: new Date().toISOString(), method: { duplicate_key: 'source identity (URL or explicit field-source identity) + normalized product + type + form + currency + period + date + price_per_kg', source_currency_rule: 'Rows from specialtycoffee.id that were labeled IDR are excluded from IDR charts because the primary source states all its prices are USD; original source-currency prices are not reconstructed without verified FX metadata', outlier_rule: 'Inclusive ±25% band around the arithmetic mean within each type/form/currency/period group; process and market tier are pooled; when no row passes, retain the row nearest the mean', chart_policy: 'source-currency mismatches, duplicates, and listings outside the group mean ±25% band are excluded from IDR chart medians, except one nearest-mean row is retained when a group would otherwise be empty; raw source rows remain in mevo_prices.json' }, summary: { raw_idr_observations: rawIdr.length, unique_idr_observations: uniqueIdr.length, duplicate_rows: duplicateRows.length, source_currency_mismatch_rows: currencyMismatchRows.length, range_excluded_observations: outlierRows.length, outlier_candidates: outlierRows.length, chart_eligible_unique_idr_observations: idr.length, groups_retained_nearest_mean_fallback: meanGroupSummaries.filter(group => group.fallback_to_nearest_mean).length, group_summaries: meanGroupSummaries }, duplicates: duplicateRows.map(row => ({ observation_id: row.observation_id, duplicate_of: row.duplicate_of, type: row.type, form: row.form, period: row.period, date: row.date, price_per_kg: row.price_per_kg, product: row.product, source: row.source, source_type: row.source_type || 'url', source_detail: row.source_detail || null, source_url: row.source_url || null, status: 'duplicate_excluded_from_chart' })), currency_mismatches: currencyMismatchRows.map(row => ({ observation_id: row.observation_id, type: row.type, form: row.form, period: row.period, date: row.date, imported_currency: row.currency, imported_price_per_kg: row.price_per_kg, source_currency: 'USD', product: row.product, source: row.source, source_type: row.source_type || 'url', source_detail: row.source_detail || null, source_url: row.source_url || null, status: 'excluded_from_idr_chart_currency_not_verified' })), outliers: outlierRows.map(row => ({ observation_id: row.observation_id, type: row.type, form: row.form, period: row.period, date: row.date, price_per_kg: row.price_per_kg, group_mean: row.group_mean, lower_limit: row.lower_limit, upper_limit: row.upper_limit, screening_method: row.screening_method, product: row.product, source: row.source, source_type: row.source_type || 'url', source_detail: row.source_detail || null, source_url: row.source_url || null, status: 'excluded_from_chart_outside_group_mean_25_percent' })), comparison_warnings: comparisonWarnings, market_level_warnings: marketLevelWarnings };
fs.writeFileSync(path.join(ROOT, 'data', 'mevo_prices_screening.json'), `${JSON.stringify(screening, null, 2)}\n`);
const secureSource = value => { try { const url = new URL(String(value || '')); return url.protocol === 'https:' ? url.href : ''; } catch (_) { return ''; } };
// Keep every public source represented by the canonical JSON, including sources
// that currently provide only USD observations (even though charts are IDR-only).
const sourceMap = new Map();
for (const row of dataset.listings || []) {
  if (row?.source_type === 'field' && row.source && row.source_detail) {
    const key = `field:${normalizeProduct(row.source)}:${normalizeProduct(row.source_detail)}`;
    sourceMap.set(key, { name: row.source, detail: row.source_detail, type: 'field', url: '' });
    continue;
  }
  const url = secureSource(row?.source_url);
  if (url) sourceMap.set(`url:${url}`, { name: row?.source || url, type: 'url', url });
}
const sources = [...sourceMap.values()].sort((a,b)=>a.name.localeCompare(b.name));
const sourceList = sources.map(source => source.type === 'field'
  ? `<li><strong>${esc(source.name)}</strong> <span class="id-copy">· Sumber langsung dari lapangan, tanpa URL publik</span><span class="en-copy">· Direct field source, no public URL</span><br><span>${esc(source.detail)}</span></li>`
  : `<li><a href="${esc(source.url)}" target="_blank" rel="noopener noreferrer">${esc(source.name)}</a></li>`).join('');
const sourceCoverage = sources.length.toLocaleString('id-ID');
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
  html = replaceRegion(html, 'PRICE_SOURCE_COVERAGE', sourceCoverage);
  html = replaceRegion(html, 'PRICE_UPDATED', esc(updatedAt));
  html = replaceRegion(html, 'PRICE_COUNT', sourceCount);
  fs.writeFileSync(filePath, html);
}
console.log(`Rendered IDR charts from ${idr.length} price observations: ${formRows.green.length} green-bean, ${formRows.roasted.length} roasted-bean, and ${excludedFormCount} ground or unspecified-form observations excluded; ${usdCount} USD observations are not included in IDR charts.`);
