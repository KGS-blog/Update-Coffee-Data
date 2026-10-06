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

// Classify only when the product text says the form explicitly. A processing
// method (Natural, Washed, Honey, etc.) does not tell us whether it is roasted.
const greenForm = /\bgreen\s*(?:bean|beans|coffee)\b|\bgreenbean\b|\bunroasted\b|\braw\s+coffee\b|kopi\s+mentah|biji\s+mentah/i;
const roastedForm = /\broast(?:ed|ing)?\b|\bsangrai\b/i;
const classifyForm = row => {
  const product = String(row.product || '');
  const green = greenForm.test(product), roasted = roastedForm.test(product);
  if (green && roasted) return 'unclear';
  if (green) return 'green';
  if (roasted) return 'roasted';
  return 'unspecified';
};
const idr = (dataset.listings || []).filter(row =>
  row && row.currency === 'IDR' && quarterIndex(row.period) &&
  Number.isFinite(Number(row.price_per_kg)) && Number(row.price_per_kg) > 0 &&
  (row.type === 'Arabika' || row.type === 'Robusta')
).map(row => ({ ...row, form: classifyForm(row) }));
const formRows = {
  green: idr.filter(row => row.form === 'green'),
  roasted: idr.filter(row => row.form === 'roasted'),
};
const median = values => {
  const sorted = values.slice().sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length ? (sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2) : null;
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
  const dots = points.map(point => `<circle class="point ${cls}-point" cx="${x(point.period)}" cy="${y(point.median)}" r="6"><title>${esc(type)} · ${esc(displayPeriod(point.period))} · ${formatIdr(point.median)} · ${point.count} listings</title></circle>`).join('');
  const periodLabels = periods.map(period => `<text x="${x(period)}" y="${height-16}" text-anchor="middle">${esc(displayPeriod(period))}</text>`).join('');
  const table = `<div class="price-table-scroll"><table class="price-period-table"><thead><tr><th><span class="id-copy">Periode</span><span class="en-copy">Period</span></th><th><span class="id-copy">Median harga/kg</span><span class="en-copy">Median price/kg</span></th><th><span class="id-copy">Jumlah listing</span><span class="en-copy">Listings recorded</span></th></tr></thead><tbody>${points.map(point => `<tr><th scope="row">${esc(displayPeriod(point.period))}</th><td>${formatIdr(point.median)}</td><td class="count">${point.count.toLocaleString('id-ID')}</td></tr>`).join('')}</tbody></table></div>`;
  const formName = form === 'green' ? ['Green bean', 'Green beans'] : ['Roasted bean', 'Roasted beans'];
  const speciesName = type === 'Arabika' ? ['Arabika', 'Arabica'] : ['Robusta', 'Robusta'];
  const id = `${type.toLowerCase()}-${form}-chart`;
  return `<section class="price-form-panel" aria-labelledby="${id}-heading"><h3 id="${id}-heading"><span class="id-copy">${speciesName[0]} · ${form === 'green' ? 'Biji hijau (green bean)' : 'Biji sangrai (roasted beans)'}</span><span class="en-copy">${speciesName[1]} · ${formName[1]}</span></h3><div class="price-chart-wrap"><svg class="price-chart" viewBox="0 0 ${width} ${height}" role="img" aria-labelledby="${id}-title ${id}-desc"><title id="${id}-title">${speciesName[1]} ${formName[1]} median listing prices per kilogram by period</title><desc id="${id}-desc">Median IDR listing prices for ${speciesName[1]} ${formName[1]}, with processing methods combined.</desc>${horizontalGrid}${line}${dots}${periodLabels}</svg></div>${table}<p class="price-count-note"><span class="id-copy">Median menggabungkan listing semua proses untuk jenis dan bentuk biji ini.</span><span class="en-copy">Median combines listings across all processing methods for this type and bean form.</span></p></section>`;
};
const chartHtml = `<div class="price-form-grid">${chart(formRows.green, 'green', 'Arabika')}${chart(formRows.roasted, 'roasted', 'Arabika')}${chart(formRows.green, 'green', 'Robusta')}${chart(formRows.roasted, 'roasted', 'Robusta')}</div><p class="price-form-coverage"><span class="id-copy"><strong>Cakupan bentuk:</strong> ${formRows.green.length.toLocaleString('id-ID')} listing biji hijau · ${formRows.roasted.length.toLocaleString('id-ID')} listing biji sangrai · ${(idr.length - formRows.green.length - formRows.roasted.length).toLocaleString('id-ID')} listing tanpa bentuk yang jelas atau berupa kopi bubuk tidak dimasukkan ke keempat grafik.</span><span class="en-copy"><strong>Form coverage:</strong> ${formRows.green.length.toLocaleString('en-US')} green-bean listings · ${formRows.roasted.length.toLocaleString('en-US')} roasted-bean listings · ${(idr.length - formRows.green.length - formRows.roasted.length).toLocaleString('en-US')} listings with unclear form or ground coffee are excluded from all four charts.</span></p>`;
const secureSource = value => { try { const url = new URL(String(value || '')); return url.protocol === 'https:' ? url.href : ''; } catch (_) { return ''; } };
const sources = [...new Map(idr.map(row => [secureSource(row.source_url), row.source || row.source_url]).filter(([url]) => url)).entries()].sort((a,b)=>a[1].localeCompare(b[1]));
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
  html = replaceRegion(html, 'PRICE_SOURCES', sourceList);
  html = replaceRegion(html, 'PRICE_UPDATED', esc(updatedAt));
  html = replaceRegion(html, 'PRICE_COUNT', sourceCount);
  fs.writeFileSync(filePath, html);
}
console.log(`Rendered separate green-bean (${formRows.green.length}) and roasted-bean (${formRows.roasted.length}) IDR charts; left ${idr.length - formRows.green.length - formRows.roasted.length} listings outside form comparisons because bean form is unspecified or the product is ground coffee.`);
