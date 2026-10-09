// Render crawlable quarterly prices, keeping explicitly identified bean forms apart.
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const MIN_PERIOD_OBSERVATIONS = 5;
const datasetPath = path.join(ROOT, 'data', 'mevo_prices.json');
if (!fs.existsSync(datasetPath)) throw new Error('Run scripts/import-mevo-price-data.js before rendering the coffee-price chart.');
const dataset = JSON.parse(fs.readFileSync(datasetPath, 'utf8'));
const respondentPath = path.join(ROOT, 'data', 'respondent-price-aggregates.json');
const respondentDataset = fs.existsSync(respondentPath) ? JSON.parse(fs.readFileSync(respondentPath, 'utf8')) : { groups: [] };
const respondentPrice = new Map((respondentDataset.groups || []).map(row => [`${row.type}|${row.form}|${row.period}`, Number(row.price_per_kg)]));
const panelPriceFor = (type, form, period) => respondentPrice.get(`${type}|${form}|${period}`);
const esc = value => String(value ?? '').replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
const safeHttps = value => { try { const url = new URL(String(value || '')); return url.protocol === 'https:' ? url.href : ''; } catch (_) { return ''; } };
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
  Boolean(row.type)
).map(row => ({ ...row, formClass: classifyForm(row) }));
// Normalize punctuation/spacing in product names to catch repeated snapshots
// whose only difference is a hyphen glyph. Preserve every row in the source JSON;
// only one representative is used in the chart and the rest are logged below.
const normalizeProduct = value => String(value || '').normalize('NFKC').toLocaleLowerCase('id-ID').replace(/[^\p{L}\p{N}]+/gu, ' ').trim().replace(/\s+/g, ' ');
const isFieldRecord = row => ['field', 'ocr', 'manual', 'manual_upload', 'field_ocr'].includes(String(row.source_type || '').trim().toLowerCase()) ||
  /ocr/i.test(String(row.extraction_method || row.ingest_method || row.capture_method || ''));
const sourceIdentity = row => isFieldRecord(row)
  ? `field:${normalizeProduct(row.source)}:${normalizeProduct(row.source_detail)}`
  : `url:${row.source_url}`;
const packageGrams = row => {
  const amount = Number(row.package_size?.amount ?? row.amount);
  const unit = String(row.package_size?.unit ?? row.unit ?? 'g').toLowerCase();
  if (!(amount > 0)) return null;
  if (['kg', 'kilogram', 'kilograms'].includes(unit)) return amount * 1000;
  if (['g', 'gram', 'gr', 'grams'].includes(unit)) return amount;
  return null;
};
const identity = row => [sourceIdentity(row), normalizeProduct(row.product), row.type, row.formClass, row.currency, row.period, row.date, row.price_level || '', packageGrams(row) || '', Number(row.price_per_kg)].join('|');
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
// Wine-process offers are excluded from the comparable series, but retained in source data.
const isWineProcess = row => /\bwine\b/i.test(String(row.process || '')) ||
  /\bwine(?:\s+(?:process|processed|ferment(?:ed|ation)?))?\s*$/i.test(String(row.product || ''));
const wineExcludedRows = chartableIdr.filter(isWineProcess);
const nonWineRows = chartableIdr.filter(row => !isWineProcess(row));

// Prefer exact 1 kg / 1000 g pack sizes within a source/product/period/price-tier
// listing. If absent, retain only the available size nearest 1 kg; its price/kg
// conversion is then used as the explicit fallback.
const sizeGroups = new Map();
for (const row of nonWineRows) {
  const key = [sourceIdentity(row), normalizeProduct(row.product), row.type, row.formClass, row.process, row.price_level || '', row.currency, row.period, row.date].join('|');
  const group = sizeGroups.get(key) || [];
  group.push(row); sizeGroups.set(key, group);
}
const packageSizeExcludedRows = [];
const sizeSelectedRows = [];
const packageSelectionCounts = { exact_1kg_groups: 0, fallback_size_groups: 0, unknown_size_groups: 0 };
for (const rows of sizeGroups.values()) {
  const knownSizes = rows.map(packageGrams).filter(Number.isFinite);
  if (!knownSizes.length) { packageSelectionCounts.unknown_size_groups++; sizeSelectedRows.push(...rows); continue; }
  const exactKg = rows.filter(row => packageGrams(row) === 1000);
  const selectedSize = exactKg.length ? 1000 : [...new Set(knownSizes)].sort((a,b) => Math.abs(a - 1000) - Math.abs(b - 1000) || b - a)[0];
  if (exactKg.length) packageSelectionCounts.exact_1kg_groups++; else packageSelectionCounts.fallback_size_groups++;
  for (const row of rows) {
    const size = packageGrams(row);
    if (size === selectedSize) sizeSelectedRows.push(row);
    else packageSizeExcludedRows.push({ ...row, selected_package_grams: selectedSize, screening_method: size === null ? 'Excluded: package size is unknown while another size is available' : exactKg.length ? 'Excluded: an exact 1 kg listing exists for this source/product/period/tier' : 'Excluded: another available pack size is closer to 1 kg' });
  }
}

// Do not screen outliers or report period movement from pooled observations:
// that pool mixes market tiers, origins, processes, and sources. Price
// movement indicators are deferred until those dimensions are comparable.
const significantMoves = new Map();
const trendOutlierRows = [];
const screenedPeriodSummaries = [];
const idr = sizeSelectedRows;
const legacyChartRows = idr.filter(row => row.type === 'Arabika' || row.type === 'Robusta');
const overviewPeriodCounts = new Map();
for (const row of legacyChartRows.filter(row => row.formClass === 'green' || row.formClass === 'roasted')) {
  const key = [row.type, row.formClass, row.period].join('|');
  overviewPeriodCounts.set(key, (overviewPeriodCounts.get(key) || 0) + 1);
}
for (const row of respondentDataset.groups || []) {
  const key = [row.type, row.form, row.period].join('|');
  overviewPeriodCounts.set(key, (overviewPeriodCounts.get(key) || 0) + 1);
}
const lowSampleOverviewGroups = [...overviewPeriodCounts].filter(([, count]) => count < MIN_PERIOD_OBSERVATIONS)
  .map(([key, count]) => { const [type, formClass, period] = key.split('|'); return { type, formClass, period, count }; });
const displayedChartRows = legacyChartRows.filter(row =>
  (row.formClass === 'green' || row.formClass === 'roasted') &&
  overviewPeriodCounts.get([row.type, row.formClass, row.period].join('|')) >= MIN_PERIOD_OBSERVATIONS
);
const formRows = {
  green: idr.filter(row => row.formClass === 'green'),
  roasted: idr.filter(row => row.formClass === 'roasted'),
};
const idPeriod = period => { const match = /^(Q[1-4])\s+(\d{4})$/.exec(period || ''); return match ? `${match[1]} ${match[2]}` : period; };
const enPeriod = period => { const match = /^(Q[1-4])\s+(\d{4})$/.exec(period || ''); return match ? `${match[1]} ${match[2]}` : period; };
const idrText = value => `Rp${new Intl.NumberFormat('id-ID', { maximumFractionDigits: 0 }).format(value)}`;
const pricePillarId = 'Data harga dipisahkan menurut bentuk biji, jenis, tingkat pasar, asal, proses, dan sumber. Ringkasan periode masih indikatif; perubahan pasar baru dihitung setelah komposisi segmennya sebanding.';
const pricePillarEn = 'Price data is separated by bean form, type, market tier, origin, process, and source. Period summaries remain indicative; market movements are calculated only after segment composition is comparable.';
const formatIdr = value => `Rp${new Intl.NumberFormat('id-ID', { maximumFractionDigits: 0 }).format(value)}`;
const displayPeriod = period => {
  const match = /^(Q[1-4])\s+(\d{4})$/.exec(period);
  return match ? `${match[2]} · ${match[1]}` : period;
};
const compactPeriod = period => {
  const match = /^(Q[1-4])\s+(\d{4})$/.exec(period);
  return match ? `${match[1]} ’${match[2].slice(-2)}` : period;
};
const overviewSeries = [
  { type: 'Arabika', form: 'green', color: '#4169d8', id: 'Arabika green', en: 'Arabica green' },
  { type: 'Arabika', form: 'roasted', color: '#087f70', id: 'Arabika roasted', en: 'Arabica roasted' },
  { type: 'Robusta', form: 'green', color: '#a66a18', id: 'Robusta green', en: 'Robusta green' },
  { type: 'Robusta', form: 'roasted', color: '#dc978e', id: 'Robusta roasted', en: 'Robusta roasted' },
];
const buildOverviewChart = () => {
  const series = overviewSeries.map(item => {
    const observations = idr.filter(row => row.type === item.type && row.formClass === item.form);
    const candidatePeriods = [...new Set([...observations.map(row => row.period), ...(respondentDataset.groups || []).filter(row => row.type === item.type && row.form === item.form).map(row => row.period)])].sort((a, b) => quarterIndex(a) - quarterIndex(b));
    const points = candidatePeriods.map(period => {
      const prices = observations.filter(row => row.period === period).map(row => Number(row.price_per_kg));
      const respondent = panelPriceFor(item.type, item.form, period);
      if (Number.isFinite(respondent)) prices.push(respondent);
      return { period, value: median(prices), count: prices.length };
    }).filter(point => Number.isFinite(point.value) && point.count >= MIN_PERIOD_OBSERVATIONS);
    return { ...item, points, latest: points.at(-1) || null };
  });
  const periods = [...new Set(series.flatMap(item => item.points.map(point => point.period)))].sort((a, b) => quarterIndex(a) - quarterIndex(b));
  if (!periods.length) return '<p class="price-no-data">Belum ada observasi harga yang memenuhi cakupan.</p>';
  const width = 760, height = 300, left = 58, right = 18, top = 18, bottom = 44;
  const plotWidth = width - left - right, plotHeight = height - top - bottom;
  const maximum = Math.max(50000, Math.ceil(Math.max(...series.flatMap(item => item.points.map(point => point.value)), 0) / 50000) * 50000);
  const x = period => periods.length === 1 ? left + plotWidth / 2 : left + plotWidth * periods.indexOf(period) / (periods.length - 1);
  const y = value => top + plotHeight * (1 - value / maximum);
  const grid = Array.from({ length: 4 }, (_, i) => {
    const value = maximum * i / 3, yy = y(value);
    return `<line class="grid" x1="${left}" x2="${width-right}" y1="${yy}" y2="${yy}"/><text x="${left-10}" y="${yy+4}" text-anchor="end">${i === 0 ? '0' : `${Math.round(value/1000)}k`}</text>`;
  }).join('');
  const lines = series.map(item => {
    const paths = [];
    let lastIndex = -2, segment = [];
    const flush = () => { if (segment.length > 1) paths.push(`<path d="${segment.join(' ')}"/>`); segment = []; };
    item.points.forEach(point => {
      const index = periods.indexOf(point.period);
      if (index !== lastIndex + 1) flush();
      segment.push(`${segment.length ? 'L' : 'M'} ${x(point.period)} ${y(point.value)}`);
      lastIndex = index;
    });
    flush();
    return `<g class="overview-series" style="--series-color:${item.color}">${paths.join('')}${item.points.map(point => `<circle cx="${x(point.period)}" cy="${y(point.value)}" r="5"><title>${esc(item.type)} · ${esc(item.form === 'green' ? 'Green bean' : 'Roasted beans')} · ${esc(displayPeriod(point.period))} · ${formatIdr(point.value)} · ${point.count} observations</title></circle>`).join('')}</g>`;
  }).join('');
  const labels = periods.map(period => `<text x="${x(period)}" y="${height-12}" text-anchor="middle">${esc(compactPeriod(period))}${period === periods.at(-1) && period.endsWith('2026') && /^Q4/.test(period) ? '*' : ''}</text>`).join('');
  const latestCards = series.map(item => {
    const value = item.latest ? new Intl.NumberFormat('id-ID', { maximumFractionDigits: 1 }).format(item.latest.value / 1000) : '—';
    const label = `<span class="id-copy">${item.id}</span><span class="en-copy">${item.en}</span>`;
    const period = item.latest ? `<small>${esc(displayPeriod(item.latest.period))} · n=${item.latest.count}</small>` : '<small>Belum cukup data</small>';
    return `<div class="overview-price-key" style="--series-color:${item.color}"><span class="overview-price-label">${label}</span><strong>${value}</strong>${period}</div>`;
  }).join('');
  const chartYear = periods.at(-1).slice(-4);
  const detailRows = series.flatMap(item => item.points.map(point => `<tr><th scope="row">${esc(displayPeriod(point.period))}</th><td>${esc(item.type)}</td><td>${item.form === 'green' ? 'Green bean' : 'Roasted beans'}</td><td>${formatIdr(point.value)}</td><td>${point.count}</td></tr>`)).join('');
  return `<div class="price-overview-chart"><h3 class="price-overview-heading"><span class="id-copy">Pergerakan median harga listing ${chartYear}</span><span class="en-copy">Coffee listing median movement ${chartYear}</span></h3><p class="price-overview-subtitle"><span class="id-copy">Rp ribu per kg. Periode dengan observasi sedikit perlu ditafsirkan hati-hati.</span><span class="en-copy">Thousand rupiah per kg. Interpret periods with few observations cautiously.</span></p><div class="price-overview-keys">${latestCards}</div><div class="price-chart-wrap"><svg class="price-chart price-chart-combined" viewBox="0 0 ${width} ${height}" role="img" aria-labelledby="price-overview-title price-overview-desc"><title id="price-overview-title">Coffee price median by period</title><desc id="price-overview-desc">One compact line chart with four combined coffee type and bean form series. Only periods with at least ${MIN_PERIOD_OBSERVATIONS} eligible observations are shown. Values are thousand rupiah per kilogram.</desc>${grid}${lines}${labels}<text class="price-axis-title" x="${left}" y="12">Rp ribu/kg</text></svg></div><p class="price-chart-footnote"><span class="id-copy">Q4* adalah periode berjalan.</span><span class="en-copy">Q4* is the current, incomplete period.</span> <span class="id-copy">Nilai terbaru dan jumlah observasi ditampilkan pada label seri.</span><span class="en-copy">Latest value and observation count appear in each series label.</span></p><details class="price-overview-data"><summary><span class="id-copy">Lihat median dan observasi per periode</span><span class="en-copy">View period medians and observations</span></summary><div class="price-table-scroll"><table class="price-period-table"><thead><tr><th>Periode</th><th>Jenis</th><th>Bentuk</th><th>Median harga/kg</th><th>Observasi</th></tr></thead><tbody>${detailRows}</tbody></table></div></details></div>`;
};
const usdCount = (dataset.listings || []).filter(row => row && row.currency === 'USD' && quarterIndex(row.period) && Number.isFinite(Number(row.price_per_kg)) && Number(row.price_per_kg) > 0 && Boolean(row.type)).length;
const excludedFormCount = legacyChartRows.filter(row => row.formClass !== 'green' && row.formClass !== 'roasted').length;
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
const channelOf = row => isFieldRecord(row) ? 'customer'
  : /\bpetani\b|farm[ -]?gate/i.test(row.product || '') ? 'farmgate'
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
const removedTrendGroups = screenedPeriodSummaries.filter(group => group.excluded > 0).map(group => `<li><strong>${esc(group.type)} · ${esc(labelForm(group.formClass))} · ${esc(displayPeriod(group.period))}</strong>: <span class="id-copy">median berubah ${group.period_change_percent}% dibanding ${esc(displayPeriod(group.previous_period))}; rata-rata ${formatIdr(group.mean)}/kg; batas pencilan tinggi ${formatIdr(group.upper_limit)}/kg; ${group.excluded} dari ${group.total} observasi dikeluarkan.</span><span class="en-copy">median changed ${group.period_change_percent}% vs ${esc(displayPeriod(group.previous_period))}; mean ${formatIdr(group.mean)}/kg; high-outlier limit ${formatIdr(group.upper_limit)}/kg; ${group.excluded} of ${group.total} observations excluded.</span></li>`).join('');
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
const marketLevelLabel = key => ({
  farmgate: 'Tingkat petani / farm-gate', wholesale: 'Grosir / wholesale',
  retail: 'Eceran / retail', reseller: 'Reseller', customer: 'Harga konsumen / customer',
  unspecified: 'Tingkat harga tidak disebutkan',
}[key] || key);
const facetDimensions = [
  ['Jenis kopi', row => row.type || 'Tidak disebutkan'],
  ['Bentuk produk', row => row.formClass === 'green' ? 'Biji hijau' : row.formClass === 'roasted' ? 'Biji sangrai' : row.formClass === 'ground' ? 'Bubuk' : 'Tidak jelas'],
  ['Tingkat pasar', row => marketLevelLabel(channelOf(row) || 'unspecified')],
  ['Asal', row => String(row.origin || '').trim() || 'Asal tidak disebutkan'],
  ['Proses', row => String(row.process || '').trim() && !/^tidak disebut$/i.test(row.process) ? row.process.trim() : 'Proses tidak disebutkan'],
  ['Sumber', row => isFieldRecord(row) ? `${row.source || 'Sumber lapangan'} · ${row.source_detail || 'lapangan/OCR'}` : safeHttps(row.source_url) || row.source || 'Sumber tidak disebutkan'],
];
const facetTables = facetDimensions.map(([name, valueOf]) => {
  const counts = new Map();
  for (const row of chartableIdr) {
    const value = valueOf(row);
    counts.set(value, (counts.get(value) || 0) + 1);
  }
  const rows = [...counts].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'id'));
  const total = rows.reduce((sum, [, count]) => sum + count, 0);
  return `<details class="price-facet"><summary>${esc(name)} · ${rows.length} kategori · ${total.toLocaleString('id-ID')} listing</summary><div class="price-table-scroll"><table class="price-period-table"><thead><tr><th>${esc(name)}</th><th>Jumlah listing unik</th><th>Porsi</th></tr></thead><tbody>${rows.map(([value, count]) => `<tr><th scope="row">${esc(value)}</th><td>${count.toLocaleString('id-ID')}</td><td>${(count * 100 / total).toLocaleString('id-ID', { maximumFractionDigits: 1 })}%</td></tr>`).join('')}</tbody></table></div></details>`;
}).join('');
const filterFields = [
  ['type', 'Jenis kopi', row => row.type || 'Tidak disebutkan'],
  ['form', 'Bentuk produk', row => row.formClass === 'green' ? 'Biji hijau' : row.formClass === 'roasted' ? 'Biji sangrai' : row.formClass === 'ground' ? 'Bubuk' : 'Tidak jelas'],
  ['tier', 'Tingkat pasar', row => marketLevelLabel(channelOf(row) || 'unspecified')],
  ['origin', 'Asal', row => String(row.origin || '').trim() || 'Asal tidak disebutkan'],
  ['process', 'Proses', row => String(row.process || '').trim() && !/^tidak disebut$/i.test(row.process) ? row.process.trim() : 'Proses tidak disebutkan'],
  ['source', 'Sumber', row => isFieldRecord(row) ? `${row.source || 'Sumber lapangan'} · ${row.source_detail || 'lapangan/OCR'}` : safeHttps(row.source_url) || row.source || 'Sumber tidak disebutkan'],
];
const segmentRows = idr.map(row => ({ period:row.period, price:Number(row.price_per_kg), type:filterFields[0][2](row), form:filterFields[1][2](row), tier:filterFields[2][2](row), origin:filterFields[3][2](row), process:filterFields[4][2](row), source:filterFields[5][2](row), source_url:safeHttps(row.source_url) }));
const filterControls = filterFields.map(([key, label, valueOf]) => {
  const values = [...new Set(idr.map(valueOf))].sort((a,b)=>a.localeCompare(b,'id'));
  return `<label class="price-segment-filter">${esc(label)}<select data-price-filter="${key}"><option value="">Pilih ${esc(label.toLocaleLowerCase('id'))}</option>${values.map(value=>`<option value="${esc(value)}">${esc(value)}</option>`).join('')}</select></label>`;
}).join('');
const segmentPayload = JSON.stringify(segmentRows).replace(/</g, '\\u003c').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
const segmentExplorer = `<section class="price-segment-explorer" aria-labelledby="price-segment-title"><h4 id="price-segment-title"><span class="id-copy">Telusuri harga dalam segmen yang setara</span><span class="en-copy">Explore prices within a like-for-like segment</span></h4><p><span class="id-copy">Pilih semua dimensi agar median per periode tidak mencampur tingkat pasar, asal, proses, atau sumber yang berbeda. Pilihan lapangan sudah ditandai sebagai harga konsumen. Periode dengan kurang dari ${MIN_PERIOD_OBSERVATIONS} observasi unik disembunyikan.</span><span class="en-copy">Select every dimension so period medians do not pool different market tiers, origins, processes, or sources. Field records are marked as consumer prices. Periods with fewer than ${MIN_PERIOD_OBSERVATIONS} unique observations are omitted.</span></p><div class="price-segment-filters">${filterControls}</div><p class="price-segment-status" role="status" aria-live="polite">Pilih semua dimensi untuk melihat data.</p><div class="price-table-scroll"><table class="price-period-table price-segment-results"><thead><tr><th>Periode</th><th>Median harga/kg</th><th>Rentang harga/kg</th><th>Jumlah listing</th><th>Sumber</th></tr></thead><tbody><tr><td colspan="5">Pilih semua dimensi untuk melihat data.</td></tr></tbody></table></div><script type="application/json" id="price-segment-data">${segmentPayload}</script><script>(function(){const root=document.currentScript.parentElement;const data=JSON.parse(root.querySelector('#price-segment-data').textContent);const selects=[...root.querySelectorAll('[data-price-filter]')],tbody=root.querySelector('.price-segment-results tbody'),status=root.querySelector('.price-segment-status');const minimum=${MIN_PERIOD_OBSERVATIONS};const fmt=n=>'Rp'+new Intl.NumberFormat('id-ID',{maximumFractionDigits:0}).format(n);function render(){const chosen=selects.map(s=>s.value);if(chosen.some(v=>!v)){status.textContent='Pilih semua dimensi untuk melihat data.';tbody.innerHTML='<tr><td colspan="5">Pilih semua dimensi untuk melihat data.</td></tr>';return}const rows=data.filter(row=>selects.every(s=>row[s.dataset.priceFilter]===s.value));const groups=new Map();for(const row of rows){const a=groups.get(row.period)||[];a.push(row.price);groups.set(row.period,a)}const allPeriods=[...groups].sort((a,b)=>{const x=/^Q([1-4]) (\\d{4})$/.exec(a[0]),y=/^Q([1-4]) (\\d{4})$/.exec(b[0]);return x&&y?(+x[2]-+y[2])*10+(+x[1]-+y[1]):a[0].localeCompare(b[0])});const periods=allPeriods.filter(([,values])=>values.length>=minimum),omitted=allPeriods.length-periods.length;if(!periods.length){status.textContent='Ada '+allPeriods.length+' periode, tetapi tidak ada yang mencapai minimum '+minimum+' observasi unik.';tbody.innerHTML='<tr><td colspan="5">Tidak ada periode dengan observasi yang cukup.</td></tr>';return}status.textContent=periods.reduce((n,[,v])=>n+v.length,0).toLocaleString('id-ID')+' listing cocok pada '+periods.length+' periode. '+(omitted?omitted+' periode disembunyikan karena kurang dari '+minimum+' observasi unik. ':'')+'Median adalah harga listing, bukan transaksi.';tbody.innerHTML=periods.map(([period,values])=>{const s=[...values].sort((a,b)=>a-b),m=s.length>>1,median=s.length%2?s[m]:(s[m-1]+s[m])/2;const sourceUrl=rows.find(r=>r.period===period)?.source_url;return '<tr><th scope="row">'+period+'</th><td>'+fmt(median)+'</td><td>'+fmt(s[0])+' – '+fmt(s[s.length-1])+'</td><td>'+values.length.toLocaleString('id-ID')+'</td><td>'+(sourceUrl?'<a href="'+sourceUrl.replace(/&/g,'&amp;').replace(/"/g,'&quot;')+'" target="_blank" rel="noopener noreferrer">Buka sumber ↗</a>':'Catatan lapangan')+'</td></tr>'}).join('')}selects.forEach(s=>s.addEventListener('change',render))})();</script></section>`;
const outlierRows = [...wineExcludedRows, ...packageSizeExcludedRows, ...trendOutlierRows];
const lowSampleItems = lowSampleOverviewGroups.map(group => `<li>${esc(group.type)} · ${esc(labelForm(group.formClass))} · ${esc(displayPeriod(group.period))}: ${group.count} <span class="id-copy">observasi unik; dikecualikan karena kurang dari ${MIN_PERIOD_OBSERVATIONS}.</span><span class="en-copy">unique observations; omitted because fewer than ${MIN_PERIOD_OBSERVATIONS}.</span></li>`).join('');
const screenHtml = `<details class="price-screening"><summary><span class="id-copy">Pemeriksaan kualitas dan metode</span><span class="en-copy">Quality checks and method</span></summary><p><span class="id-copy">Setiap grafik menampilkan satu median gabungan per periode. Semua data harga yang lolos pemeriksaan dari seluruh sumber dihitung bersama; sumber dicantumkan untuk menunjukkan asal data, bukan sebagai seri atau kelompok harga terpisah. Titik hanya muncul bila sedikitnya ${MIN_PERIOD_OBSERVATIONS} observasi harga yang memenuhi syarat tersedia setelah pemeriksaan duplikasi, mata uang, proses Wine, dan ukuran kemasan.</span><span class="en-copy">Each chart shows one combined median per period. All eligible price data from every source are pooled; source names indicate provenance, not separate price series or groups. A point appears only when at least ${MIN_PERIOD_OBSERVATIONS} eligible price observations remain after duplicate, currency, Wine-process, and package-size checks.</span></p><p><span class="id-copy">Harga adalah acuan dari sumber yang dicantumkan, bukan transaksi resmi atau harga tingkat petani. Komposisi data dapat berbeda menurut periode sehingga median ini tidak otomatis menunjukkan perubahan harga pada kondisi yang setara. Proses Wine dikecualikan. Ukuran 1 kg dipilih; ukuran terdekat hanya digunakan bila ukuran tersebut tidak tersedia. Data USD tidak dikonversi.</span><span class="en-copy">Prices are references from the listed sources, not official transactions or farm-gate prices. Data composition may differ by period, so these medians do not automatically represent like-for-like price changes. Wine processing is excluded. 1 kg packs are selected; the nearest size is used only when unavailable. USD data are not converted.</span></p></details>`;
const chartHtml = buildOverviewChart();
const completeChartHtml = chartHtml;
const eligibleOverviewKeys = new Set([...overviewPeriodCounts].filter(([, count]) => count >= MIN_PERIOD_OBSERVATIONS).map(([key]) => key));
const displayedPanelAggregateCount = (respondentDataset.groups || []).filter(row => eligibleOverviewKeys.has([row.type, row.form, row.period].join('|'))).length;
const displayedChartObservationCount = displayedChartRows.length + displayedPanelAggregateCount;
const screening = { generated_at: new Date().toISOString(), method: { minimum_observations_per_period: MIN_PERIOD_OBSERVATIONS, minimum_rule: `A chart point is shown only when at least ${MIN_PERIOD_OBSERVATIONS} eligible observations are available for the same coffee type, bean form, and period after duplicate, currency, Wine-process, and package-size screening. Each respondent aggregate contributes one value per type/form/period.`, chart_policy: 'One combined period median from public listings, field/OCR records, and aggregated respondent data. Respondent identities, regions, products, and counts are not included in the public chart or screening report.' }, summary: { eligible_price_observations: displayedChartObservationCount, minimum_observations_per_period: MIN_PERIOD_OBSERVATIONS, included_period_type_form_groups: eligibleOverviewKeys.size, omitted_low_sample_period_groups: lowSampleOverviewGroups.length } };
fs.writeFileSync(path.join(ROOT, 'data', 'mevo_prices_screening.json'), `${JSON.stringify(screening, null, 2)}\n`);
const secureSource = value => { try { const url = new URL(String(value || '')); return url.protocol === 'https:' ? url.href : ''; } catch (_) { return ''; } };
// Keep every public source represented by the canonical JSON, including sources
// that currently provide only USD observations (even though charts are IDR-only).
const sourceMap = new Map();
for (const row of dataset.listings || []) {
    if (isFieldRecord(row)) {
    continue;
  }
  const url = secureSource(row?.source_url);
  if (url) sourceMap.set(`url:${url}`, { name: row?.source || url, type: 'url', url });
}
if ((respondentDataset.groups || []).length || (dataset.listings || []).some(isFieldRecord)) sourceMap.set('respondent-panel-aggregate', { name: 'Data responden', detail: '', type: 'respondent', url: '' });
const sources = [...sourceMap.values()].sort((a,b)=>a.name.localeCompare(b.name));
const sourceList = sources.map(source => source.type === 'respondent'
  ? `<li><strong><span class="id-copy">Data responden</span><span class="en-copy">Respondent data</span></strong> <span class="id-copy">· harga jual konsumen</span><span class="en-copy">· consumer sale prices</span></li>`
  : `<li><a href="${esc(source.url)}" target="_blank" rel="noopener noreferrer">${esc(source.name)}</a></li>`).join('');
const sourceCoverage = sources.length.toLocaleString('id-ID');
const rawUpdatedAt = Date.parse(dataset.generated_at || '');
const updatedAt = Number.isNaN(rawUpdatedAt)
  ? 'tanggal tidak tersedia / date unavailable'
  : `${new Intl.DateTimeFormat('id-ID', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Jakarta' }).format(rawUpdatedAt)} WIB`;
const sourceCount = displayedChartObservationCount.toLocaleString('id-ID');
const replaceRegion = (html, name, value) => {
  const start = `<!-- ${name}_START -->`, end = `<!-- ${name}_END -->`;
  const expression = new RegExp(`${start}[\\s\\S]*?${end}`, 'g');
  if (!html.includes(start) || !html.includes(end)) throw new Error(`Homepage is missing the ${name} render markers.`);
  return html.replace(expression, `${start}${value}${end}`);
};
for (const filename of ['index.html', 'kabar-kopi.html']) {
  const filePath = path.join(ROOT, filename);
  let html = fs.readFileSync(filePath, 'utf8');
  html = html.replace('<!-- DYNAMIC_PRICE_PILLAR_ID -->', pricePillarId)
    .replace('<!-- DYNAMIC_PRICE_PILLAR_EN -->', pricePillarEn);
  html = replaceRegion(html, 'PRICE_CHART', completeChartHtml);
  html = replaceRegion(html, 'PRICE_SCREENING', screenHtml);
  html = replaceRegion(html, 'PRICE_SOURCES', sourceList);
  html = replaceRegion(html, 'PRICE_SOURCE_COVERAGE', sourceCoverage);
  html = replaceRegion(html, 'PRICE_UPDATED', esc(updatedAt));
  html = replaceRegion(html, 'PRICE_COUNT', sourceCount);
  fs.writeFileSync(filePath, html);
}
console.log(`Prepared ${idr.length} segmented IDR observations; the four Arabica/Robusta overview charts use ${displayedChartRows.length}; ${uniqueIdr.filter(isFieldRecord).length} unique field/OCR IDR observations are classified as consumer prices; ${usdCount} USD observations remain separate.`);
