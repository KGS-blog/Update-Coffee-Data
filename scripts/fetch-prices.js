const axios = require('axios');
const fs = require('fs');
const path = require('path');

const DATA_PATH = path.join(__dirname, '..', 'data', 'market-data.json');

// Yahoo Finance v8 chart endpoint (no auth required, public API)
async function fetchYahooFinance(symbol) {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${symbol}?interval=1d&range=1d`;
  try {
    const response = await axios.get(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
      },
      timeout: 10000
    });

    const result = response.data.chart.result;
    if (!result || !result[0]) {
      console.warn(`No data for ${symbol}`);
      return null;
    }

    const meta = result[0].meta;
    const quote = result[0].indicators.quote[0];
    const timestamps = result[0].timestamp;

    // Get last valid close price
    const closes = quote.close.filter(c => c !== null);
    const lastClose = closes[closes.length - 1];

    return {
      price: lastClose,
      currency: meta.currency,
      regularMarketPrice: meta.regularMarketPrice,
      previousClose: meta.previousClose || meta.chartPreviousClose
    };
  } catch (err) {
    console.error(`Error fetching ${symbol}:`, err.message);
    return null;
  }
}

function getCurrentMonthLabel() {
  const now = new Date();
  const months = ["Jan","Feb","Mar","Apr","Mei","Jun","Jul","Agu","Sep","Okt","Nov","Des"];
  return `${months[now.getMonth()]} ${now.getFullYear()}`;
}

async function updateData() {
  console.log('📡 Fetching market data...');

  // Load existing data
  let data;
  try {
    data = JSON.parse(fs.readFileSync(DATA_PATH, 'utf8'));
  } catch (err) {
    console.error('Failed to read existing data, creating new:', err.message);
    data = {
      meta: { source: "Yahoo Finance via GitHub Actions", version: "1.0" },
      arabica: { symbol: "KC=F", name: "Arabica C-Market", unit: "cents/lb", history: [] },
      robusta: { symbol: "RM=F", name: "Robusta London", unit: "USD/ton", history: [] },
      idrUsd: { symbol: "IDR=X", name: "IDR/USD", unit: "IDR/USD", history: [] }
    };
  }

  // Fetch all three
  const [arabica, robusta, idr] = await Promise.all([
    fetchYahooFinance('KC=F'),
    fetchYahooFinance('RM=F'),
    fetchYahooFinance('IDR=X')
  ]);

  const currentMonth = getCurrentMonthLabel();
  const now = new Date().toISOString();

  // Update Arabica
  if (arabica && arabica.price) {
    let price = arabica.price;
    // KC=F is in cents if < 10, otherwise dollars. Normalize to cents/lb.
    if (price > 100) price = price; // Already in cents (unlikely)
    else if (price > 10) price = price * 100; // In dollars, convert to cents

    const prev = data.arabica.current || price;
    data.arabica.current = parseFloat(price.toFixed(2));
    data.arabica.change = parseFloat((price - prev).toFixed(2));
    data.arabica.changePercent = parseFloat(((price - prev) / prev * 100).toFixed(2));

    // Update or append history for current month
    const existing = data.arabica.history.find(h => h.month === currentMonth);
    if (existing) {
      existing.value = data.arabica.current;
    } else {
      data.arabica.history.push({ month: currentMonth, value: data.arabica.current });
    }
    console.log(`✅ Arabica: ${data.arabica.current} ¢/lb`);
  }

  // Update Robusta
  if (robusta && robusta.price) {
    let price = robusta.price;
    // RM=F is in USD/metric ton. Sometimes quoted in different units.
    if (price < 1000) price = price * 1000; // If in thousands

    const prev = data.robusta.current || price;
    data.robusta.current = Math.round(price);
    data.robusta.change = parseFloat((price - prev).toFixed(2));
    data.robusta.changePercent = parseFloat(((price - prev) / prev * 100).toFixed(2));

    const existing = data.robusta.history.find(h => h.month === currentMonth);
    if (existing) {
      existing.value = data.robusta.current;
    } else {
      data.robusta.history.push({ month: currentMonth, value: data.robusta.current });
    }
    console.log(`✅ Robusta: $${data.robusta.current}/ton`);
  }

  // Update IDR/USD
  if (idr && idr.price) {
    // IDR=X is IDR per 1 USD
    const price = idr.price;
    const prev = data.idrUsd.current || price;
    data.idrUsd.current = Math.round(price);
    data.idrUsd.change = Math.round(price - prev);
    data.idrUsd.changePercent = parseFloat(((price - prev) / prev * 100).toFixed(2));

    const existing = data.idrUsd.history.find(h => h.month === currentMonth);
    if (existing) {
      existing.value = data.idrUsd.current;
    } else {
      data.idrUsd.history.push({ month: currentMonth, value: data.idrUsd.current });
    }
    console.log(`✅ IDR/USD: ${data.idrUsd.current}`);
  }

  // Update meta
  data.meta.lastUpdated = now;
  data.meta.nextUpdate = "Auto: every 6 hours via GitHub Actions";

  // Save
  fs.writeFileSync(DATA_PATH, JSON.stringify(data, null, 2));
  console.log(`\n💾 Data saved to ${DATA_PATH}`);
  console.log(`📅 Last updated: ${now}`);
}

updateData().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
