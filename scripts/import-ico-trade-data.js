// Save the ICO Coffee Trade Globe public annual export snapshot for Indonesia.
// ICO reports coffee trade volume in 60-kg bags and declared customs value in USD.
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const OUT = path.join(ROOT, 'data/ico-trade-data.json');
const API = 'https://data.ico.org/globe/api/v1';

async function getJson(url) {
  const response = await fetch(url, { headers: { accept: 'application/json' }, signal: AbortSignal.timeout(30000) });
  if (!response.ok) throw new Error(`ICO API returned HTTP ${response.status} for ${url}`);
  return response.json();
}

async function main() {
  let previous;
  if (fs.existsSync(OUT)) previous = JSON.parse(fs.readFileSync(OUT, 'utf8'));
  try {
    const meta = await getJson(`${API}/meta`);
    const latest = meta.flows?.export?.latest;
    const lastCompleteYear = latest ? (Number(latest.month) === 12 ? Number(latest.year) : Number(latest.year) - 1) : Number(meta.balance?.latestCompleteYear);
    const publicYear = Number(meta.entitlement?.freeYear) || lastCompleteYear;
    const year = Math.min(lastCompleteYear, publicYear);
    if (!Number.isInteger(year) || year < 1963) throw new Error('ICO metadata does not identify an available complete public export year.');

    const bundle = await getJson(`${API}/globe/bundle?year=${year}`);
    const indonesia = bundle.countries?.ID;
    if (!indonesia || !(Number(indonesia.exports) > 0) || !(Number(indonesia.exportsValue) > 0)) {
      throw new Error(`ICO bundle has no valid Indonesia export totals for ${year}.`);
    }

    const destinationNamesID = { PH: 'Filipina', US: 'Amerika Serikat', BE: 'Belgia', EG: 'Mesir', MY: 'Malaysia', DZ: 'Aljazair', DE: 'Jerman', GB: 'Britania Raya', RU: 'Rusia', IN: 'India' };
    const snapshot = {
      status: 'success',
      source: 'International Coffee Organization (ICO), Coffee Trade Globe',
      source_url: `https://data.ico.org/globe/#m=flows&f=export&y=${year}&c=ID`,
      api_endpoint: `${API}/globe/bundle?year=${year}`,
      fetched_at: new Date().toISOString(),
      api_generated_at: bundle.meta?.generatedAt || meta.generatedAt || null,
      trade_window_through: bundle.meta?.tradeWindow?.through || meta.tradeWindow?.through || null,
      year,
      geography: 'Indonesia',
      units: { volume: '60-kg bags', volume_tonnes_conversion: 'one 60-kg bag = 0.06 metric tonnes', value: 'USD customs value' },
      exports: {
        bags_60kg: Number(indonesia.exports),
        tonnes: Number(indonesia.exports) * 0.06,
        value_usd: Number(indonesia.exportsValue),
      },
      top_destinations: (indonesia.topDest || []).slice(0, 10).map(([iso2, name, bags]) => ({ iso2, name, name_id: destinationNamesID[iso2] || name, bags_60kg: Number(bags), tonnes: Number(bags) * 0.06 })),
      notes: 'Annual calendar-year trade totals and destination partner rankings as provided by ICO. Destination rankings are based on export volume. Kept separate from BPS figures because source coverage, classification, and compilation methods may differ.'
    };
    fs.writeFileSync(OUT, `${JSON.stringify(snapshot, null, 2)}\n`);
    console.log(`Saved ICO Indonesia coffee export snapshot for ${year}: ${snapshot.exports.bags_60kg.toLocaleString()} 60-kg bags.`);
  } catch (error) {
    if (previous) {
      console.warn(`ICO refresh failed; retaining previous snapshot (${previous.year}): ${error.message}`);
      return;
    }
    throw error;
  }
}

main().catch(error => { console.error(error); process.exitCode = 1; });
