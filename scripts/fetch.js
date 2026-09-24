// QCO Data Pipeline — fetch.js — v2026.09.24-8
// Repo: KGS-blog/Update-Coffee-Data — dijalankan via GitHub Actions (.github/workflows/)
// Output:
//   data/market-data.json  -> format lama dipertahankan (arabica/robusta/idrUsd + history)
//   data/ekspor.json       -> BPS dataexim HS 0901 (butuh secret BPS_API_KEY)
// Sumber: Yahoo Finance v8 (KC=F, RM=F, IDR=X) + BPS. Tanpa dependency npm.
// Catatan: RM=F (Robusta London) tidak tersedia di Yahoo -> robusta ditandai stale,
// nilai terakhir dipertahankan agar tidak ada angka palsu yang mengaku live.

const fs = require("fs");
const path = require("path");

const BPS_KEY = process.env.BPS_API_KEY || "";
const OUT = path.join(__dirname, "..", "data");
fs.mkdirSync(OUT, { recursive: true });
const YEAR = process.env.FETCH_YEAR || String(new Date().getFullYear());
const UA = { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36" };

async function getJSON(url) {
  const r = await fetch(url, { headers: UA });
  if (!r.ok) throw new Error("HTTP " + r.status);
  return r.json();
}

// Yahoo v8 chart — kembalikan regularMarketPrice
async function yahoo(symbol) {
  const j = await getJSON("https://query1.finance.yahoo.com/v8/finance/chart/" + encodeURIComponent(symbol) + "?interval=1d&range=1d");
  const res = j && j.chart && j.chart.result && j.chart.result[0];
  if (!res || !res.meta) throw new Error("no data");
  const p = res.meta.regularMarketPrice;
  if (!p) throw new Error("no price");
  return p;
}

const MONTHS = ["Jan","Feb","Mar","Apr","Mei","Jun","Jul","Agu","Sep","Okt","Nov","Des"];
function monthLabel() { const n = new Date(); return MONTHS[n.getMonth()] + " " + n.getFullYear(); }
function upsertMonth(history, label, value) {
  const ex = history.find(h => h.month === label);
  if (ex) ex.value = value; else history.push({ month: label, value: value });
}
function round2(n) { return Math.round(n * 100) / 100; }

(async () => {
  const now = new Date().toISOString();
  const mPath = path.join(OUT, "market-data.json");
  let data;
  try { data = JSON.parse(fs.readFileSync(mPath, "utf8")); }
  catch (e) {
    data = {
      meta: { source: "Yahoo Finance via GitHub Actions", version: "2.0", historyNote: "Riwayat sebelum Sep 2026 adalah baseline ilustratif; data mulai Sep 2026 adalah data riil harian." },
      arabica: { symbol: "KC=F", name: "Arabica C-Market", unit: "cents/lb", history: [] },
      robusta: { symbol: "RM=F", name: "Robusta London", unit: "USD/ton", history: [] },
      idrUsd: { symbol: "IDR=X", name: "IDR/USD", unit: "IDR/USD", history: [] }
    };
  }
  if (!data.meta) data.meta = {};
  const label = monthLabel();
  const errors = {};

  // --- Arabika KC=F (cents/lb) ---
  try {
    let p = await yahoo("KC=F");
    if (p > 10 && p < 100) p = p * 100; // normalisasi kalau Yahoo mengirim USD/lb
    const prev = data.arabica.current || p;
    data.arabica.current = round2(p);
    data.arabica.change = round2(p - prev);
    data.arabica.changePercent = prev ? round2((p - prev) / prev * 100) : 0;
    data.arabica.stale = false;
    upsertMonth(data.arabica.history, label, data.arabica.current);
    console.log("Arabica:", data.arabica.current, "cents/lb");
  } catch (e) { errors.arabica = e.message; data.arabica.stale = true; }

  // --- Kurs IDR=X ---
  try {
    const p = await yahoo("IDR=X");
    const prev = data.idrUsd.current || p;
    data.idrUsd.current = Math.round(p);
    data.idrUsd.change = Math.round(p - prev);
    data.idrUsd.changePercent = prev ? round2((p - prev) / prev * 100) : 0;
    data.idrUsd.stale = false;
    upsertMonth(data.idrUsd.history, label, data.idrUsd.current);
    console.log("IDR/USD:", data.idrUsd.current);
  } catch (e) { errors.kurs = e.message; data.idrUsd.stale = true; }

  // --- Robusta RM=F (umumnya tidak tersedia di Yahoo -> jujur: stale) ---
  try {
    let p = await yahoo("RM=F");
    if (p < 1000) p = p * 1000;
    const prev = data.robusta.current || p;
    data.robusta.current = Math.round(p);
    data.robusta.change = Math.round(p - prev);
    data.robusta.changePercent = prev ? round2((p - prev) / prev * 100) : 0;
    data.robusta.stale = false;
    upsertMonth(data.robusta.history, label, data.robusta.current);
    console.log("Robusta:", data.robusta.current, "USD/ton");
  } catch (e) {
    errors.robusta = e.message;
    data.robusta.stale = true; // nilai terakhir dipertahankan, ditandai tidak segar
    console.log("Robusta: RM=F tidak tersedia -> stale (nilai terakhir dipertahankan)");
  }

  // --- Seri harian 6 bulan (untuk analisis deskriptif di blog) ---
  try {
    const j6 = await getJSON("https://query1.finance.yahoo.com/v8/finance/chart/KC=F?interval=1d&range=6mo");
    const r6 = j6 && j6.chart && j6.chart.result && j6.chart.result[0];
    const ts = r6 && r6.timestamp;
    const cl = r6 && r6.indicators && r6.indicators.quote && r6.indicators.quote[0].close;
    const seri = [];
    if (ts && cl) {
      for (let i = 0; i < ts.length; i++) {
        if (cl[i] == null) continue;
        let p = cl[i];
        if (p > 10 && p < 100) p = p * 100;
        seri.push([ts[i], round2(p)]);
      }
    }
    fs.writeFileSync(path.join(OUT, "harga-harian.json"), JSON.stringify({ simbol: "KC=F", unit: "cents/lb", jumlahTitik: seri.length, seri: seri, fetched: now }));
    console.log("saved data/harga-harian.json:", seri.length, "titik");
  } catch (e) { errors.harian = e.message; }

  data.meta.lastUpdated = now;
  data.meta.nextUpdate = "Auto: GitHub Actions";
  fs.writeFileSync(mPath, JSON.stringify(data, null, 2));
  console.log("saved data/market-data.json");

  // --- BPS ekspor HS 0901 ---
  if (BPS_KEY) {
    try {
      const j = await getJSON("https://webapi.bps.go.id/v1/api/dataexim/sumber/1/kodehs/09/jenishs/2/tahun/" + YEAR + "/periode/1/key/" + BPS_KEY);
      if (j && j.status === "Error") throw new Error(j.message);
      const arr = Array.isArray(j) ? j : (Array.isArray(j.data) ? j.data : []);
      // kopi murni: hanya HS yang diawali 0901 (0902=teh, 0903=mate -> dibuang)
      const kopi = arr.filter(function (d) { return String(d.kodehs || "").indexOf("0901") !== -1; });
      const perBulan = {};
      kopi.forEach(function (d) {
        const b = String(d.bulan || "??").trim();
        if (!perBulan[b]) perBulan[b] = { bulan: b, nilaiUSD: 0, nettoKg: 0 };
        perBulan[b].nilaiUSD += Number(d.value) || 0;
        perBulan[b].nettoKg += Number(d.netweight) || 0;
      });
      const bulanan = Object.values(perBulan).sort(function (a, b2) { return a.bulan.localeCompare(b2.bulan); });
      const total = bulanan.reduce(function (s, b2) { s.nilaiUSD += b2.nilaiUSD; s.nettoKg += b2.nettoKg; return s; }, { nilaiUSD: 0, nettoKg: 0 });
      fs.writeFileSync(path.join(OUT, "ekspor.json"), JSON.stringify({
        sumber: "BPS dataexim — HS 0901 kopi, periode bulanan",
        tahun: Number(YEAR),
        jumlahEntriKopi: kopi.length,
        bulanan: bulanan,
        totalTahun: total,
        fetched: now
      }, null, 2));
      console.log("saved data/ekspor.json");
    } catch (e) { errors.ekspor = e.message; }
  } else {
    errors.ekspor = "BPS_API_KEY tidak di-set";
  }

  console.log(JSON.stringify({ date: now, errors }, null, 2));
  process.exit(0); // jangan gagal total bila satu sumber error — file tetap ter-commit
})();
