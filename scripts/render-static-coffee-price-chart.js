// Render a crawlable quarterly price chart from Kabar Kopi's locally saved data.
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
const idr = (dataset.listings || []).filter(row =>
  row && row.currency === 'IDR' && quarterIndex(row.period) &&
  Number.isFinite(Number(row.price_per_kg)) && Number(row.price_per_kg) > 0 &&
  (row.type === 'Arabika' || row.type === 'Robusta')
);
const periods = [...new Set(idr.map(row => row.period))].sort((a, b) => quarterIndex(a) - quarterIndex(b));
const types = ['Arabika', 'Robusta'];
const median = values => {
  const sorted = values.slice().sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length ? (sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2) : null;
};
const points = Object.fromEntries(types.map(type => [type, periods.map(period => {
  const observations = idr.filter(row => row.type === type && row.period === period);
  return { period, median: median(observations.map(row => Number(row.price_per_kg))), count: observations.length };
})]));
const formatIdr = value => `Rp${new Intl.NumberFormat('id-ID', { maximumFractionDigits: 0 }).format(value)}`;
const allPrices = Object.values(points).flat().map(point => point.median).filter(Number.isFinite);
const maxPrice = Math.max(50000, Math.ceil(Math.max(...allPrices) / 50000) * 50000);
const width = 900, height = 330, left = 88, right = 24, top = 24, bottom = 50;
const plotWidth = width - left - right, plotHeight = height - top - bottom;
const quarterSpan = Math.max(1, quarterIndex(periods.at(-1)) - quarterIndex(periods[0]));
const x = period => left + plotWidth * (quarterIndex(period) - quarterIndex(periods[0])) / quarterSpan;
const y = value => top + plotHeight * (1 - value / maxPrice);
const horizontalGrid = Array.from({ length: 5 }, (_, i) => {
  const value = maxPrice * i / 4, yy = y(value);
  return `<line class="grid" x1="${left}" x2="${width-right}" y1="${yy}" y2="${yy}"/><text x="${left-10}" y="${yy+4}" text-anchor="end">${i === 0 ? '0' : `${Math.round(value/1000)}k`}</text>`;
}).join('');
const lines = types.map(type => {
  const present = points[type].filter(point => point.median !== null);
  const cls = type === 'Arabika' ? 'arabica' : 'robusta';
  const pathD = present.map((point, i) => `${i ? 'L' : 'M'} ${x(point.period)} ${y(point.median)}`).join(' ');
  const dots = present.map(point => `<circle class="point ${cls}-point" cx="${x(point.period)}" cy="${y(point.median)}" r="5"><title>${esc(type)} · ${esc(point.period)} · ${formatIdr(point.median)} · n=${point.count}</title></circle>`).join('');
  return `<path class="${cls}" d="${pathD}"/>${dots}`;
}).join('');
const periodLabels = periods.map(period => `<text x="${x(period)}" y="${height-16}" text-anchor="middle">${esc(period)}</text>`).join('');
const svg = `<div class="price-legend"><span><i class="arabica-key"></i><span class="id-copy">Arabika</span><span class="en-copy">Arabica</span></span><span><i class="robusta-key"></i>Robusta</span></div><svg class="price-chart" viewBox="0 0 ${width} ${height}" role="img" aria-labelledby="coffee-price-svg-title coffee-price-svg-desc"><title id="coffee-price-svg-title">Median price listings by quarter</title><desc id="coffee-price-svg-desc">Median listed coffee prices per kilogram in Indonesian rupiah, with Arabica and Robusta shown separately.</desc>${horizontalGrid}${lines}${periodLabels}</svg><div class="price-table-scroll"><table class="price-period-table"><thead><tr><th><span class="id-copy">Periode</span><span class="en-copy">Period</span></th><th><span class="id-copy">Arabika · median/kg</span><span class="en-copy">Arabica · median/kg</span></th><th><span class="id-copy">Jumlah</span><span class="en-copy">Count</span></th><th>Robusta · median/kg</th><th><span class="id-copy">Jumlah</span><span class="en-copy">Count</span></th></tr></thead><tbody>${periods.map(period => { const a = points.Arabika.find(p => p.period === period), r = points.Robusta.find(p => p.period === period); return `<tr><th scope="row">${esc(period)}</th><td>${a.median === null ? '—' : formatIdr(a.median)}</td><td class="count">${a.count.toLocaleString('id-ID')}</td><td>${r.median === null ? '—' : formatIdr(r.median)}</td><td class="count">${r.count.toLocaleString('id-ID')}</td></tr>`; }).join('')}</tbody></table></div>`;
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
  html = replaceRegion(html, 'PRICE_CHART', svg);
  html = replaceRegion(html, 'PRICE_SOURCES', sourceList);
  html = replaceRegion(html, 'PRICE_UPDATED', esc(updatedAt));
  html = replaceRegion(html, 'PRICE_COUNT', sourceCount);
  fs.writeFileSync(filePath, html);
}
console.log(`Rendered a static quarterly IDR chart from ${idr.length} observations across ${periods.length} periods; linked ${sources.length} source URLs.`);
