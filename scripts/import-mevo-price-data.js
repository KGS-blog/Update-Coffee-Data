// Keep a source copy of MEVO's documented coffee-price observations in Kabar Kopi.
// If the upstream endpoint is temporarily unavailable, preserve the last good snapshot.
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const SOURCE_URL = 'https://kgs-blog.github.io/coffee-prices/mevo_prices.json';
const OUTPUT = path.join(ROOT, 'data', 'mevo_prices.json');

async function main() {
  try {
    const response = await fetch(SOURCE_URL, { headers: { accept: 'application/json' } });
    if (!response.ok) throw new Error(`Upstream returned HTTP ${response.status}`);
    const dataset = await response.json();
    if (!dataset || !Array.isArray(dataset.listings) || !Array.isArray(dataset.summary) || !dataset.totals) {
      throw new Error('The JSON did not match the expected MEVO price dataset shape.');
    }
    const validListings = dataset.listings.filter(row => {
      let sourceIsSecure = false;
      try { sourceIsSecure = new URL(row?.source_url).protocol === 'https:'; } catch (_) {}
      return row && typeof row.type === 'string' && typeof row.period === 'string' &&
        typeof row.currency === 'string' && Number.isFinite(Number(row.price_per_kg)) &&
        Number(row.price_per_kg) > 0 && sourceIsSecure;
    });
    if (!validListings.length) throw new Error('No valid price observations were found.');
    fs.mkdirSync(path.dirname(OUTPUT), { recursive: true });
    fs.writeFileSync(OUTPUT, `${JSON.stringify(dataset, null, 2)}\n`);
    console.log(`Saved ${validListings.length} MEVO price observations to data/mevo_prices.json (source generated ${dataset.generated_at || 'date unavailable'}).`);
  } catch (error) {
    if (fs.existsSync(OUTPUT)) {
      console.warn(`MEVO price import skipped; keeping the last saved Kabar Kopi copy. ${error.message}`);
      return;
    }
    throw error;
  }
}

main().catch(error => { console.error(error); process.exitCode = 1; });
