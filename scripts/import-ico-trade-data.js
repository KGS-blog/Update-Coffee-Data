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
    const rankMetrics = [
      ['exports', 'export_volume'], ['exportsValue', 'export_customs_value'],
      ['imports', 'import_volume'], ['importsValue', 'import_customs_value'],
      ['reexports', 'reexport_volume'], ['reexportsValue', 'reexport_customs_value'],
      ['production', 'production'], ['consumption', 'consumption']
    ];
    const rankings = Object.fromEntries(rankMetrics.map(([field, key]) => {
      const ranked = Object.entries(bundle.countries).map(([iso, row]) => ({ iso, value: Number(row[field]) || 0 }))
        .filter(row => row.value > 0).sort((a, b) => b.value - a.value);
      return [key, { rank: ranked.findIndex(row => row.iso === 'ID') + 1 || null, countries_count: ranked.length, indonesia_value: Number(indonesia[field]) || 0, top_five: ranked.slice(0, 5) }];
    }));
    const comboCatalog = new Map((bundle.comboCatalog || []).map(item => [item.code, item]));
    const composition = Object.fromEntries(['grs', 'procMix', 'comboMix'].map(key => [key, bundle[key]?.ID || {}]));
    composition.comboDetails = Object.entries(composition.comboMix).map(([code, share]) => ({ code, share, ...(comboCatalog.get(code) || {}) }));
    const flowForIndonesia = (bundle.flows || []).filter(row => row[0] === 'ID' || row[1] === 'ID').map(row => ({ origin_iso2: row[0], destination_iso2: row[1], bags_60kg: Number(row[2]) * 1e6, customs_value_usd: Number(row[3]) * 1e6, reported_by: row[4] || 'exporter' }));
    const snapshot = {
      status: 'success',
      source: 'International Coffee Organization (ICO), Coffee Trade Globe',
      source_url: `https://data.ico.org/globe/#m=flows&f=export&y=${year}&c=ID`,
      api_endpoint: `${API}/globe/bundle?year=${year}`,
      fetched_at: new Date().toISOString(),
      api_generated_at: bundle.meta?.generatedAt || meta.generatedAt || null,
      trade_window_through: bundle.meta?.tradeWindow?.through || meta.tradeWindow?.through || null,
      year,
      public_trade_year: year,
      api_trade_window_through: meta.tradeWindow?.through || null,
      public_year_access_note: `This public snapshot uses ICO's free complete year (${year}) where the API reports entitlement gating. Other bundle years returned HTTP 402 during the latest check.`,
      geography: 'Indonesia',
      units: { volume: '60-kg bags', volume_tonnes_conversion: 'one 60-kg bag = 0.06 metric tonnes', value: 'USD customs value' },
      exports: {
        bags_60kg: Number(indonesia.exports),
        tonnes: Number(indonesia.exports) * 0.06,
        value_usd: Number(indonesia.exportsValue),
      },
      trade: {
        exports_bags_60kg: Number(indonesia.exports), exports_value_usd: Number(indonesia.exportsValue),
        imports_bags_60kg: Number(indonesia.imports), imports_value_usd: Number(indonesia.importsValue),
        reexports_bags_60kg: Number(indonesia.reexports), reexports_value_usd: Number(indonesia.reexportsValue),
        partner_flows_available_in_public_bundle: flowForIndonesia
      },
      rankings: {
        metrics: rankings,
        ico_reported: { production: indonesia.prodRank || null, imports: indonesia.impRank || null, consumption: indonesia.consRank || null },
        ranking_note: 'Positions are calculated by descending values in this public ICO bundle for the selected year; ICO-supplied production, import, and consumption rank fields are retained separately.'
      },
      production: { bags_60kg: Number(indonesia.production), arabica_share: Number(indonesia.arabicaShare), series: indonesia.productionSeries || [] },
      consumption: { bags_60kg: Number(indonesia.consumption), per_capita_kg: Number(indonesia.perCap), series: indonesia.consumptionSeries || [] },
      export_composition: composition,
      top_destinations: (indonesia.topDest || []).slice(0, 10).map(([iso2, name, bags]) => ({ iso2, name, name_id: destinationNamesID[iso2] || name, bags_60kg: Number(bags), tonnes: Number(bags) * 0.06 })),
      top_import_origins: (indonesia.topOrig || []).slice(0, 10).map(([iso2, name, bags]) => ({ iso2, name, bags_60kg: Number(bags), tonnes: Number(bags) * 0.06 })),
      top_reexport_destinations: (indonesia.topReexDest || []).slice(0, 10).map(([iso2, name, bags]) => ({ iso2, name, bags_60kg: Number(bags), tonnes: Number(bags) * 0.06 })),
      notes: 'Annual calendar-year trade totals and destination partner rankings as provided by ICO. Destination rankings are based on export volume. The public bundle also supplies annual coffee-year production and consumption series, partner flows, import and re-export rankings, and Indonesia export composition by form and processing method. Kept separate from BPS figures because source coverage, classification, and compilation methods may differ.'
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
