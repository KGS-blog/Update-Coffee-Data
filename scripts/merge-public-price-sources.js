// Add dated snapshots from public coffee price catalogues and manually approved admin OCR rows.
// Listing snapshots are quarter-deduplicated to avoid counting the same unchanged offer every run.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const ROOT = path.resolve(__dirname, '..');
const DATA_PATH = path.join(ROOT, 'data', 'mevo_prices.json');
const SUPPLEMENT_PATH = path.join(ROOT, 'data', 'public-price-supplement.json');
const sources = [
  { name: 'ASKI B2B Marketplace', url: 'https://www.aski.coffee/marketplace', kind: 'aski' },
  { name: 'Willkin Green Coffee', url: 'https://willkingreencoffee.com/katalog-lokal/', kind: 'willkin' },
];
const now = new Date();
const dateISO = now.toISOString().slice(0, 10);
const period = `Q${Math.floor(now.getUTCMonth() / 3) + 1} ${now.getUTCFullYear()}`;
const quarterForDate = value => { const d = new Date(`${value}T00:00:00Z`); return Number.isNaN(d.valueOf()) ? period : `Q${Math.floor(d.getUTCMonth() / 3) + 1} ${d.getUTCFullYear()}`; };
const clean = value => String(value || '').replace(/<[^>]*>/g, ' ').replace(/&nbsp;|&#160;/gi, ' ').replace(/&amp;/gi, '&').replace(/&#<!-- -->/g, '').replace(/\s+/g, ' ').trim();
const decode = value => clean(value).replace(/&quot;/gi, '"').replace(/&#39;|&apos;/gi, "'").replace(/&lt;/gi, '<').replace(/&gt;/gi, '>');
const number = value => { const digits = String(value || '').replace(/[^0-9]/g, ''); return digits ? Number(digits) : null; };
const sha = value => crypto.createHash('sha256').update(value).digest('hex');
function cards(html, marker, endMarker) {
  const starts = [...html.matchAll(marker)].map(match => match.index);
  return starts.map((start, index) => html.slice(start, starts[index + 1] || html.length));
}
function parsePublicListings(kind, html, source) {
  const output = [];
  if (kind === 'aski') {
    const blocks = cards(html, /<div class="glass-card p-6 rounded-3xl/g, null);
    for (const block of blocks) {
      const title = decode(block.match(/<h3[^>]*>([\s\S]*?)<\/h3>/i)?.[1]);
      const priceText = decode(block.match(/<span class="font-mono text-sm font-bold[^\"]*">([\s\S]*?)<\/span>/i)?.[1]);
      const price = number(priceText);
      const origin = decode(block.match(/<p class="text-xs text-\[#64748B\] mb-2">([\s\S]*?)<\/p>/i)?.[1]).replace(/^📍\s*/, '');
      if (!title || !price || !/\/\s*kg\b/i.test(priceText)) continue;
      const type = /fine robusta cupping:|robusta cupping:/i.test(block) || /robusta/i.test(title) ? 'Robusta' : /arabika cupping:|arabika|arabica/i.test(block + title) ? 'Arabika' : '';
      if (!type) continue;
      output.push({ source, source_url: sources.find(item => item.kind === kind).url, product: title, type, form: 'Biji kopi mentah', process: title.match(/\b(natural|washed|wash|honey|wine|anaerob|semi[- ]?wash)\b/i)?.[0] || 'Tidak disebut', origin, currency: 'IDR', price, price_min: null, price_max: null, amount: 1, unit: 'kg', quality_status: 'Estimasi harga marketplace · tanggal diamati Kabar Kopi' });
    }
  } else {
    const blocks = cards(html, /<div class="product-card">/g, null);
    for (const block of blocks) {
      const title = decode(block.match(/<h3 class="card-title">([\s\S]*?)<\/h3>/i)?.[1]);
      const priceText = decode(block.match(/<span class="prc">([\s\S]*?)<\/span>/i)?.[1]);
      const matches = [...priceText.matchAll(/Rp\s*([\d.,]+)\s*[–-]\s*(?:Rp\s*)?([\d.,]+)/gi)];
      const range = matches[0];
      if (!title || !range) continue;
      const low = number(range[1]), high = number(range[2]);
      if (!low || !high) continue;
      const type = /robusta/i.test(title) ? 'Robusta' : /arabika|arabica/i.test(title) ? 'Arabika' : '';
      if (!type) continue;
      const process = title.match(/\b(natural|washed|wash|honey|wine|anaerob|semi[- ]?wash)\b/i)?.[0] || 'Tidak disebut';
      output.push({ source, source_url: sources.find(item => item.kind === kind).url, product: title, type, form: 'Biji kopi mentah', process, origin: decode(block.match(/<div class="card-origin">([\s\S]*?)<\/div>/i)?.[1]), currency: 'IDR', price: (low + high) / 2, price_min: low, price_max: high, amount: 1, unit: 'kg', quality_status: 'Rentang harga katalog · titik tengah dipakai untuk ringkasan · tanggal diamati Kabar Kopi' });
      const usdMatch = priceText.match(/USD\s*([\d.]+)\s*[–-]\s*([\d.]+)\s*\/\s*kg/i);
      if (usdMatch) {
        const lowUsd = Number(usdMatch[1]), highUsd = Number(usdMatch[2]);
        if (lowUsd > 0 && highUsd > 0) output.push({ source, source_url: sources.find(item => item.kind === kind).url, product: title, type, form: 'Biji kopi mentah', process, origin: decode(block.match(/<div class="card-origin">([\s\S]*?)<\/div>/i)?.[1]), currency: 'USD', price: (lowUsd + highUsd) / 2, price_min: lowUsd, price_max: highUsd, amount: 1, unit: 'kg', quality_status: 'Published USD range · midpoint used for summaries · observed by Kabar Kopi' });
      }
    }
  }
  return output;
}
function canonicalRow(item, sourceDate = dateISO, basis = 'Tanggal diamati Kabar Kopi') {
  const currency = item.currency;
  const priceMin = Number(item.price_min), priceMax = Number(item.price_max);
  const rawPrice = Number(item.price);
  const numeric = rawPrice > 0 ? rawPrice : priceMin > 0 && priceMax >= priceMin ? (priceMin + priceMax) / 2 : NaN;
  if (!item.product || !['Arabika', 'Robusta'].includes(item.type) || !['Biji kopi mentah', 'Biji kopi sangrai', 'Kopi bubuk'].includes(item.form) || !['IDR', 'USD'].includes(currency) || !(numeric > 0) || !item.source_url?.startsWith('https://')) return null;
  const amount = Number(item.amount || 1);
  const unit = String(item.unit || 'kg').toLowerCase();
  const amountKg = unit === 'kg' ? amount : ['g', 'gram', 'gr'].includes(unit) ? amount / 1000 : null;
  if (!amountKg || amountKg <= 0) return null;
  const rowPeriod = quarterForDate(sourceDate);
  const pricePerKg = Math.round(numeric / amountKg * 100) / 100;
  const productKey = `${item.source_url}|${String(item.product).toLowerCase().replace(/\s+/g, ' ')}|${currency}|${rowPeriod}`;
  const id = sha(productKey);
  return { 
    observation_id: id, type: item.type, form: item.form, process: item.process || 'Tidak disebut', period: rowPeriod,
    date: sourceDate, date_basis: basis, currency, original_price: numeric, price_per_package: numeric,
    ...(priceMin > 0 && priceMax >= priceMin ? { price_range_per_kg: [Math.round(priceMin / amountKg), Math.round(priceMax / amountKg)] } : {}),
    package_size: { amount: amountKg * 1000, unit: 'g' }, price_per_kg: pricePerKg,
    scale_100_to_999_applied: false, product: item.product, source: item.source, source_url: item.source_url,
    product_url: item.source_url, quality_status: item.quality_status || null,
    ...(item.origin ? { origin: item.origin } : {})
  };
}
async function fetchApprovedManualRows() {
  const secret = process.env.MEVO_SYNC_SECRET;
  if (!secret) return { records: [], ids: [] };
  try {
    const response = await fetch('https://blog-api.qcoid.com/api/internal/price-list-imports', { headers: { Authorization: `Bearer ${secret}`, Accept: 'application/json' } });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const data = await response.json();
    return { records: (data.listings || []).flatMap(entry => entry.listings.map(row => ({ ...row, source: row.source, source_url: row.source_url, uploadId: entry.id }))), ids: (data.listings || []).map(entry => entry.id) };
  } catch (error) { console.warn(`Could not read approved admin price imports: ${error.message}`); return { records: [], ids: [] }; }
}
async function main() {
  const dataset = JSON.parse(fs.readFileSync(DATA_PATH, 'utf8'));
  let supplement = { version: 1, listings: [] };
  try { supplement = JSON.parse(fs.readFileSync(SUPPLEMENT_PATH, 'utf8')); } catch (_) {}
  if (!Array.isArray(supplement.listings)) supplement.listings = [];
  const records = [];
  for (const source of sources) {
    try {
      const response = await fetch(source.url, { headers: { 'user-agent': 'KabarKopiPriceMonitor/1.0 (+https://kabarkopi.qcoid.com)', accept: 'text/html' }, signal: AbortSignal.timeout(20000) });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const found = parsePublicListings(source.kind, await response.text(), source.name);
      if (!found.length) throw new Error('No clearly priced listings parsed; preserving existing dataset.');
      console.log(`${source.name}: fetched ${found.length} public price observations.`);
      records.push(...found);
    } catch (error) { console.warn(`${source.name}: source skipped for this run (${error.message}).`); }
  }
  const approved = await fetchApprovedManualRows();
  records.push(...approved.records);
  const supplementById = new Map(supplement.listings.map(row => [row.observation_id, row]));
  let added = 0;
  for (const item of records) {
    const sourceDate = /^\d{4}-\d{2}-\d{2}$/.test(String(item.source_date || '')) ? item.source_date : dateISO;
    const basis = sourceDate === dateISO ? 'Tanggal diamati Kabar Kopi' : 'Tanggal sumber';
    const row = canonicalRow(item, sourceDate, basis);
    if (!row) continue;
    if (!supplementById.has(row.observation_id)) added++;
    // One source/product/currency snapshot per quarter: refresh the active quarter,
    // retain earlier quarters as historical observations.
    supplementById.set(row.observation_id, row);
  }
  supplement = { version: 1, updated_at: now.toISOString(), listings: [...supplementById.values()] };
  fs.writeFileSync(SUPPLEMENT_PATH, `${JSON.stringify(supplement, null, 2)}\n`);
  const byId = new Map((dataset.listings || []).map(row => [row.observation_id, row]));
  for (const row of supplement.listings) byId.set(row.observation_id, row);
  dataset.listings = [...byId.values()];
  dataset.listings.sort((a, b) => String(a.date || '').localeCompare(String(b.date || '')) || String(a.product || '').localeCompare(String(b.product || '')));
  const currencies = new Set(dataset.listings.map(row => row.currency));
  const groups = new Map();
  for (const row of dataset.listings) {
    const key = [row.type, row.form, row.process, row.period, row.currency].join('|');
    const group = groups.get(key) || { type: row.type, form: row.form, process: row.process, period: row.period, currency: row.currency, listing_count: 0, source_urls: new Set(), prices: [] };
    group.listing_count++; group.source_urls.add(row.source_url); group.prices.push(Number(row.price_per_kg)); groups.set(key, group);
  }
  const median = values => { values.sort((a,b)=>a-b); const m=Math.floor(values.length/2); return values.length%2 ? values[m] : (values[m-1]+values[m])/2; };
  dataset.summary = [...groups.values()].map(group => ({ type: group.type, form: group.form, process: group.process, period: group.period, currency: group.currency, listing_count: group.listing_count, source_count: group.source_urls.size, median_price_per_kg: median(group.prices), minimum_price_per_kg: Math.min(...group.prices), maximum_price_per_kg: Math.max(...group.prices), source_urls: [...group.source_urls] }));
  dataset.totals = { listings: dataset.listings.length, groups: dataset.summary.length, types: { Arabika: dataset.listings.filter(row => row.type === 'Arabika').length, Robusta: dataset.listings.filter(row => row.type === 'Robusta').length } };
  dataset.public_price_sources_checked_at = now.toISOString();
  fs.writeFileSync(DATA_PATH, `${JSON.stringify(dataset, null, 2)}\n`);
  console.log(`Merged ${added} new deduplicated public/admin listings; ${dataset.listings.length} total. Currencies: ${[...currencies].join(', ')}.`);
  if (approved.ids.length && process.env.MEVO_SYNC_SECRET) {
    const response = await fetch('https://blog-api.qcoid.com/api/internal/price-list-imports', { method: 'POST', headers: { Authorization: `Bearer ${process.env.MEVO_SYNC_SECRET}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ ids: approved.ids }) });
    if (!response.ok) console.warn(`Could not mark approved price imports as consumed (${response.status}).`);
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
