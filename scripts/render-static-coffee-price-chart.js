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
const sourceIdentity = row => row.source_type === 'field'
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

// Compare period medians after Wine and pack-size handling. Only when the
// median changes by more than 30% versus the preceding observed period do we
// screen unusually high observations, defined as >30% above that period mean.
const trendGroups = new Map();
for (const row of sizeSelectedRows) {
  const key = [row.type, row.formClass, row.currency].join('|');
  const periods = trendGroups.get(key) || new Map();
  const values = periods.get(row.period) || [];
  values.push(row); periods.set(row.period, values); trendGroups.set(key, periods);
}
const significantMoves = new Map();
for (const [key, periods] of trendGroups) {
  const ordered = [...periods.entries()].sort((a,b) => quarterIndex(a[0]) - quarterIndex(b[0]));
  for (let i = 1; i < ordered.length; i++) {
    const [previousPeriod, previousRows] = ordered[i - 1];
    const [period, rows] = ordered[i];
    const previousMedian = median(previousRows.map(row => Number(row.price_per_kg)));
    const currentMedian = median(rows.map(row => Number(row.price_per_kg)));
    const change = previousMedian > 0 ? currentMedian / previousMedian - 1 : 0;
    if (Math.abs(change) > 0.30) significantMoves.set(`${key}|${period}`, { previous_period: previousPeriod, previous_median: previousMedian, current_median: currentMedian, change_percent: change * 100 });
  }
}
const trendOutlierRows = [];
const screenedPeriodSummaries = [];
const chartIncludedRows = new Set();
for (const [key, periods] of trendGroups) {
  for (const [period, rows] of periods) {
    const move = significantMoves.get(`${key}|${period}`);
    const mean = rows.reduce((sum,row) => sum + Number(row.price_per_kg), 0) / rows.length;
    const upper = mean * 1.3;
    let included = 0;
    for (const row of rows) {
      if (move && Number(row.price_per_kg) > upper) trendOutlierRows.push({ ...row, group_mean: Math.round(mean), upper_limit: Math.round(upper), period_change_percent: Number(move.change_percent.toFixed(1)), previous_period: move.previous_period, screening_method: 'Excluded high-price outlier: period median changed by over 30%; price is more than 30% above current-period mean' });
      else { chartIncludedRows.add(row); included++; }
    }
    const first = rows[0];
    screenedPeriodSummaries.push({ type:first.type, formClass:first.formClass, period, mean:Math.round(mean), previous_period:move?.previous_period || null, period_change_percent:move ? Number(move.change_percent.toFixed(1)) : null, total:rows.length, included, excluded:rows.length-included, upper_limit:move ? Math.round(upper) : null });
  }
}
const idr = sizeSelectedRows.filter(row => chartIncludedRows.has(row));
const formRows = {
  green: idr.filter(row => row.formClass === 'green'),
  roasted: idr.filter(row => row.formClass === 'roasted'),
};
const priceSeriesNames = {
  'Arabika|green': ['Arabika biji hijau', 'Arabica green beans'],
  'Arabika|roasted': ['Arabika biji sangrai', 'Arabica roasted beans'],
  'Robusta|green': ['Robusta biji hijau', 'Robusta green beans'],
  'Robusta|roasted': ['Robusta biji sangrai', 'Robusta roasted beans'],
};
const priceSeries = Object.entries(priceSeriesNames).map(([key, names]) => {
  const [type, form] = key.split('|');
  const periods = [...new Set(idr.filter(row => row.type === type && row.formClass === form).map(row => row.period))]
    .sort((a, b) => quarterIndex(a) - quarterIndex(b));
  const points = periods.map(period => {
    const rows = idr.filter(row => row.type === type && row.formClass === form && row.period === period);
    return { period, median: median(rows.map(row => Number(row.price_per_kg))), count: rows.length };
  });
  const current = points.at(-1), previous = points.at(-2);
  return current ? { names, current, previous, change: previous?.median > 0 ? (current.median / previous.median - 1) * 100 : null } : null;
}).filter(Boolean);
const idPeriod = period => { const match = /^(Q[1-4])\s+(\d{4})$/.exec(period || ''); return match ? `${match[1]} ${match[2]}` : period; };
const enPeriod = period => { const match = /^(Q[1-4])\s+(\d{4})$/.exec(period || ''); return match ? `${match[1]} ${match[2]}` : period; };
const idrText = value => `Rp${new Intl.NumberFormat('id-ID', { maximumFractionDigits: 0 }).format(value)}`;
const priceInsight = priceSeries.filter(item => Number.isFinite(item.change))
  .sort((a, b) => Math.abs(b.change) - Math.abs(a.change))[0];
const pricePillarId = priceInsight
  ? `Pada ${idPeriod(priceInsight.current.period)}, median listing ${priceInsight.names[0]} ${priceInsight.change >= 0 ? 'naik' : 'turun'} ${Math.abs(priceInsight.change).toLocaleString('id-ID', { maximumFractionDigits: 1 })}% menjadi ${idrText(priceInsight.current.median)} dibanding ${idPeriod(priceInsight.previous.period)}. Lihat pergerakan empat seri dan telusuri sumbernya.`
  : priceSeries.length
    ? `Periode terbaru yang tercatat adalah ${idPeriod(priceSeries.map(item => item.current.period).sort((a, b) => quarterIndex(a) - quarterIndex(b)).at(-1))}. Bandingkan median listing Arabika dan Robusta untuk biji hijau maupun sangrai, lalu telusuri sumbernya.`
    : 'Bandingkan median listing Arabika dan Robusta untuk biji hijau maupun sangrai per periode, lalu telusuri sumbernya.';
const pricePillarEn = priceInsight
  ? `In ${enPeriod(priceInsight.current.period)}, the median ${priceInsight.names[1]} listing ${priceInsight.change >= 0 ? 'rose' : 'fell'} ${Math.abs(priceInsight.change).toLocaleString('en-US', { maximumFractionDigits: 1 })}% to ${idrText(priceInsight.current.median)} from ${enPeriod(priceInsight.previous.period)}. Explore all four series and trace their sources.`
  : priceSeries.length
    ? `The latest recorded period is ${enPeriod(priceSeries.map(item => item.current.period).sort((a, b) => quarterIndex(a) - quarterIndex(b)).at(-1))}. Compare Arabica and Robusta listings for green and roasted beans, then trace their sources.`
    : 'Compare Arabica and Robusta listings for green and roasted beans by period, then trace their sources.';
const formatIdr = value => `Rp${new Intl.NumberFormat('id-ID', { maximumFractionDigits: 0 }).format(value)}`;
const displayPeriod = period => {
  const match = /^(Q[1-4])\s+(\d{4})$/.exec(period);
  return match ? `${match[2]} · ${match[1]}` : period;
};
const compactPeriod = period => {
  const match = /^(Q[1-4])\s+(\d{4})$/.exec(period);
  return match ? `${match[1]} ’${match[2].slice(-2)}` : period;
};
const chart = (rows, form, type) => {
  const records = rows.filter(row => row.type === type);
  const candidatePeriods = [...new Set(records.map(row => row.period))].sort((a, b) => quarterIndex(a) - quarterIndex(b));
  const points = candidatePeriods.map(period => {
    const observations = records.filter(row => row.period === period);
    return { period, median: median(observations.map(row => Number(row.price_per_kg))), count: observations.length };
  }).filter(point => Number.isFinite(point.median) && point.count > 0);
  const periods = points.map(point => point.period);
  const allPrices = points.map(point => point.median).filter(Number.isFinite);
  const maxPrice = Math.max(50000, Math.ceil(Math.max(...allPrices, 0) / 50000) * 50000);
  const width = 640, height = 230, left = 66, right = 16, top = 16, bottom = 38;
  const plotWidth = width - left - right, plotHeight = height - top - bottom;
  const x = period => periods.length <= 1 ? left + plotWidth / 2 : left + plotWidth * periods.indexOf(period) / (periods.length - 1);
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
  const dots = points.map(point => `<circle class="point ${cls}-point" cx="${x(point.period)}" cy="${y(point.median)}" r="5"><title>${esc(type)} · ${esc(displayPeriod(point.period))} · ${formatIdr(point.median)} · ${point.count} eligible price observations</title></circle>`).join('');
  const periodLabels = periods.map(period => `<text x="${x(period)}" y="${height-12}" text-anchor="middle">${esc(compactPeriod(period))}</text>`).join('');
  const table = `<div class="price-table-scroll"><table class="price-period-table"><thead><tr><th><span class="id-copy">Periode</span><span class="en-copy">Period</span></th><th><span class="id-copy">Median harga/kg</span><span class="en-copy">Median price/kg</span></th><th><span class="id-copy">Jumlah observasi harga</span><span class="en-copy">Price observations</span></th></tr></thead><tbody>${points.map(point => `<tr><th scope="row">${esc(displayPeriod(point.period))}</th><td>${Number.isFinite(point.median) ? formatIdr(point.median) : '<span class="id-copy">Tidak ada observasi harga yang memenuhi cakupan</span><span class="en-copy">No eligible price observations</span>'}</td><td class="count">${point.count.toLocaleString('id-ID')}</td></tr>`).join('')}</tbody></table></div>`;
  const formName = form === 'green' ? ['Green bean', 'Green beans'] : ['Roasted bean', 'Roasted beans'];
  const speciesName = type === 'Arabika' ? ['Arabika', 'Arabica'] : ['Robusta', 'Robusta'];
  const id = `${type.toLowerCase()}-${form}-chart`;
  const chartBody = points.length ? `<div class="price-chart-wrap"><svg class="price-chart" viewBox="0 0 ${width} ${height}" role="img" aria-labelledby="${id}-title ${id}-desc"><title id="${id}-title">${speciesName[1]} ${formName[1]} median listing prices per kilogram by period</title><desc id="${id}-desc">Median IDR listing prices for ${speciesName[1]} ${formName[1]}, with processing methods combined. Only periods with eligible observations are shown.</desc>${horizontalGrid}${line}${dots}${periodLabels}</svg></div>${table}` : `<p class="price-no-data"><span class="id-copy">Belum ada observasi harga yang memenuhi cakupan.</span><span class="en-copy">No eligible price observations are available.</span></p>`;
  return `<section class="price-form-panel" aria-labelledby="${id}-heading"><h3 id="${id}-heading"><span class="id-copy">${speciesName[0]} · ${form === 'green' ? 'Biji hijau (green bean)' : 'Biji sangrai (roasted beans)'}</span><span class="en-copy">${speciesName[1]} · ${formName[1]}</span></h3>${chartBody}<p class="price-count-note"><span class="id-copy">Jumlah menunjukkan observasi listing harga, bukan transaksi.</span><span class="en-copy">Counts show price-listing observations, not transactions.</span></p></section>`;
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
const outlierRows = [...wineExcludedRows, ...packageSizeExcludedRows, ...trendOutlierRows];
const screenHtml = `<details class="price-screening"><summary><span class="id-copy">Pemeriksaan kualitas data</span><span class="en-copy">Data quality screening</span></summary><p><span class="id-copy">${duplicateNote} ${currencyMismatchRows.length.toLocaleString('id-ID')} listing unik dari Indonesia Specialty Coffee tidak dihitung dalam grafik rupiah karena sumber menyatakan harganya dalam USD. Proses Wine dikeluarkan. Jika satu produk memiliki beberapa ukuran, grafik memilih kemasan tepat 1 kg/1.000 g; jika tidak tersedia, dipilih ukuran yang paling dekat ke 1 kg dan dinormalisasi ke harga/kg. Tidak ada ambang harga tetap. Pencilan harga tinggi hanya disaring ketika median berubah lebih dari 30% terhadap periode sebelumnya; saat itu harga yang lebih dari 30% di atas rata-rata periode dikeluarkan. Data sumber tetap tersimpan.</span><span class="en-copy">${duplicateRows.length} duplicate rows were detected and are not double-counted. ${currencyMismatchRows.length} unique Indonesia Specialty Coffee listings are excluded from IDR charts because the source quotes USD. Wine processing is excluded. When a product has multiple pack sizes, the chart selects exactly 1 kg/1,000 g; if unavailable, it selects the size nearest 1 kg and normalizes to price/kg. There is no fixed price band. High-price outliers are screened only when the median changes by more than 30% from the prior period; prices more than 30% above that period's mean are then excluded. Source records remain stored.</span></p><p><span class="id-copy">Cakupan terpisah: ${wineExcludedRows.length} listing proses Wine dan ${packageSizeExcludedRows.length} listing ukuran kemasan tidak terpilih dikeluarkan dari grafik.</span><span class="en-copy">Separate scope: ${wineExcludedRows.length} Wine-process listings and ${packageSizeExcludedRows.length} non-selected pack-size listings are excluded from charts.</span></p>${removedTrendGroups ? `<h4><span class="id-copy">Penyaringan saat perubahan periode &gt;30%</span><span class="en-copy">Screening after a &gt;30% period change</span></h4><ul>${removedTrendGroups}</ul>` : `<p><span class="id-copy">Tidak ada pencilan harga tinggi yang dikeluarkan berdasarkan aturan perubahan antarperiode.</span><span class="en-copy">No high-price outliers were excluded under the cross-period change rule.</span></p>`}${warningItems ? `<h4><span class="id-copy">Catatan perbandingan periode</span><span class="en-copy">Period comparison notes</span></h4><ul>${warningItems}</ul>` : ''}${levelItems ? `<h4><span class="id-copy">Campuran tingkat harga</span><span class="en-copy">Mixed price stages</span></h4><ul>${levelItems}</ul>` : ''}</details>`;
const chartHtml = `<div class="price-form-grid">${chart(formRows.green, 'green', 'Arabika')}${chart(formRows.roasted, 'roasted', 'Arabika')}${chart(formRows.green, 'green', 'Robusta')}${chart(formRows.roasted, 'roasted', 'Robusta')}</div><p class="price-form-coverage"><span class="id-copy"><strong>Cakupan: ${rawIdr.length.toLocaleString('id-ID')} observasi berlabel IDR diperiksa.</strong> ${currencyMismatchRows.length.toLocaleString('id-ID')} listing dikeluarkan karena mata uang sumber berbeda, ${duplicateRows.length.toLocaleString('id-ID')} duplikat tidak dihitung dua kali, ${wineExcludedRows.length.toLocaleString('id-ID')} proses Wine dikeluarkan, ${packageSizeExcludedRows.length.toLocaleString('id-ID')} ukuran kemasan nonpilihan dikeluarkan, dan ${trendOutlierRows.length.toLocaleString('id-ID')} pencilan harga tinggi disaring saat perubahan median antarperiode melebihi 30%. Grafik memakai ${idr.length.toLocaleString('id-ID')} observasi unik. Biji hijau: ${formRows.green.length.toLocaleString('id-ID')}; biji sangrai: ${formRows.roasted.length.toLocaleString('id-ID')}; kopi bubuk atau bentuk tak jelas tidak masuk grafik. ${usdCount.toLocaleString('id-ID')} listing berlabel USD tetap terpisah. Jumlah adalah listing, bukan transaksi.</span><span class="en-copy"><strong>Scope: ${rawIdr.length.toLocaleString('en-US')} IDR-labeled observations screened.</strong> ${currencyMismatchRows.length.toLocaleString('en-US')} source-currency mismatches excluded, ${duplicateRows.length.toLocaleString('en-US')} duplicates not double-counted, ${wineExcludedRows.length.toLocaleString('en-US')} Wine-process listings excluded, ${packageSizeExcludedRows.length.toLocaleString('en-US')} non-selected pack sizes excluded, and ${trendOutlierRows.length.toLocaleString('en-US')} high-price outliers screened when the period median moved by more than 30%. Charts use ${idr.length.toLocaleString('en-US')} unique observations. Green beans: ${formRows.green.length.toLocaleString('en-US')}; roasted beans: ${formRows.roasted.length.toLocaleString('en-US')}; ground or unclear forms are excluded. ${usdCount.toLocaleString('en-US')} USD-labeled listings remain separate. Counts are listings, not transactions.</span></p>`;
const screening = { generated_at: new Date().toISOString(), method: { duplicate_key: 'source identity + product + type + form + process + price level + currency + period + date + package grams + price_per_kg', source_currency_rule: 'Rows from specialtycoffee.id labeled IDR are excluded because the source states the prices are USD and no verified FX record exists', wine_rule: 'Rows whose process is Wine are excluded from chart calculations; source rows remain stored', package_size_rule: 'Prefer exact 1000 g package per source/product/type/form/process/price level/currency/period/date; if absent, select the available pack size nearest to 1000 g and normalize price to per kg; unknown sizes are retained only where no known size exists', outlier_rule: 'No fixed price band. Compare period medians within type/form/currency. If absolute change versus the previous observed period is greater than 30%, exclude current-period observations priced more than 30% above that period arithmetic mean', chart_policy: 'Source-currency mismatches, duplicates, Wine process, non-selected package sizes, and conditionally detected high-price outliers are excluded; canonical raw price listings remain stored' }, summary: { raw_idr_observations: rawIdr.length, unique_idr_observations: uniqueIdr.length, duplicate_rows: duplicateRows.length, source_currency_mismatch_rows: currencyMismatchRows.length, wine_process_excluded_rows: wineExcludedRows.length, package_size_excluded_rows: packageSizeExcludedRows.length, package_selection_groups: packageSelectionCounts, significant_period_moves: significantMoves.size, high_price_outliers_excluded: trendOutlierRows.length, chart_eligible_unique_idr_observations: idr.length }, duplicates: duplicateRows.map(row => ({ observation_id: row.observation_id, duplicate_of: row.duplicate_of, type: row.type, form: row.form, period: row.period, date: row.date, package_size: row.package_size || null, price_per_kg: row.price_per_kg, product: row.product, source: row.source, source_type: row.source_type || 'url', source_detail: row.source_detail || null, source_url: row.source_url || null, status: 'duplicate_excluded_from_chart' })), currency_mismatches: currencyMismatchRows.map(row => ({ observation_id: row.observation_id, type: row.type, form: row.form, period: row.period, date: row.date, imported_currency: row.currency, imported_price_per_kg: row.price_per_kg, source_currency: 'USD', product: row.product, source: row.source, source_type: row.source_type || 'url', source_detail: row.source_detail || null, source_url: row.source_url || null, status: 'excluded_from_idr_chart_currency_not_verified' })), excluded_wine: wineExcludedRows.map(row => ({ observation_id: row.observation_id, type: row.type, form: row.form, process: row.process, period: row.period, product: row.product, price_per_kg: row.price_per_kg, source: row.source, status: 'excluded_wine_process' })), excluded_package_sizes: packageSizeExcludedRows.map(row => ({ observation_id: row.observation_id, type: row.type, form: row.form, process: row.process, period: row.period, product: row.product, package_size: row.package_size || null, selected_package_grams: row.selected_package_grams, price_per_kg: row.price_per_kg, source: row.source, screening_method: row.screening_method, status: 'excluded_non_selected_pack_size' })), outliers: trendOutlierRows.map(row => ({ observation_id: row.observation_id, type: row.type, form: row.form, process: row.process, period: row.period, previous_period: row.previous_period, period_change_percent: row.period_change_percent, price_per_kg: row.price_per_kg, group_mean: row.group_mean, upper_limit: row.upper_limit, product: row.product, source: row.source, source_type: row.source_type || 'url', source_detail: row.source_detail || null, source_url: row.source_url || null, screening_method: row.screening_method, status: 'excluded_high_outlier_after_period_change_over_30_percent' })), period_summaries: screenedPeriodSummaries, comparison_warnings: comparisonWarnings, market_level_warnings: marketLevelWarnings };
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
  html = html.replace('<!-- DYNAMIC_PRICE_PILLAR_ID -->', pricePillarId)
    .replace('<!-- DYNAMIC_PRICE_PILLAR_EN -->', pricePillarEn);
  html = replaceRegion(html, 'PRICE_CHART', chartHtml);
  html = replaceRegion(html, 'PRICE_SCREENING', screenHtml);
  html = replaceRegion(html, 'PRICE_SOURCES', sourceList);
  html = replaceRegion(html, 'PRICE_SOURCE_COVERAGE', sourceCoverage);
  html = replaceRegion(html, 'PRICE_UPDATED', esc(updatedAt));
  html = replaceRegion(html, 'PRICE_COUNT', sourceCount);
  fs.writeFileSync(filePath, html);
}
console.log(`Rendered IDR charts from ${idr.length} price observations: ${formRows.green.length} green-bean, ${formRows.roasted.length} roasted-bean, and ${excludedFormCount} ground or unspecified-form observations excluded; ${usdCount} USD observations are not included in IDR charts.`);
