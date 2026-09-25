// QCO Data Pipeline — fetch.js — v2026.09.25-1
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

  // --- Berita kopi (NewsData.io utama, fallback Google News RSS) — v2026.09.25-1 ---
  {
    const ND_KEY = process.env.NEWSDATA_KEY || "";
    const err = {};
    let artikel = null;
    let sumberBerita = "";
    const UA_BROWSER = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36";
    async function getTextUA(url) {
      const r = await fetch(url, { headers: { "User-Agent": UA_BROWSER, "Accept": "application/rss+xml,application/xml,text/html,*/*" } });
      if (!r.ok) throw new Error("HTTP " + r.status);
      return r.text();
    }
    if (ND_KEY) {
      const urls = [
        "https://newsdata.io/api/1/latest?apikey=" + ND_KEY + "&q=kopi&country=id&language=id&size=25",
        "https://newsdata.io/api/1/latest?apikey=" + ND_KEY + "&q=kopi&language=id&size=25"
      ];
      for (const url of urls) {
        try {
          const jn = await getJSON(url);
          if (jn && jn.status === "success" && Array.isArray(jn.results) && jn.results.length) {
            artikel = jn.results.map(function (a) {
              return { judul: a.title, tautan: a.link, tanggal: a.pubDate, sumber: a.source_name || a.source_id || "" };
            });
            sumberBerita = "NewsData.io";
            break;
          }
          err.newsdata = JSON.stringify(jn).slice(0, 200);
        } catch (e2) { err.newsdata = e2.message; }
      }
    } else {
      err.newsdata = "NEWSDATA_KEY tidak di-set sebagai secret";
    }
    if (!artikel) {
      try {
        const xml = await getTextUA("https://news.google.com/rss/search?q=kopi+indonesia&hl=id&gl=ID&ceid=ID:id");
        const items = xml.match(/<item>[\s\S]*?<\/item>/g) || [];
        if (!items.length) err.rss = "RSS merespons tapi 0 item (kemungkinan halaman consent Google)";
        const clean = function (s) { return String(s || "").replace(/<!\[CDATA\[|\]\]>/g, "").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'").trim(); };
        artikel = items.slice(0, 25).map(function (it) {
          const ti = (it.match(/<title>([\s\S]*?)<\/title>/) || [])[1] || "";
          const li = (it.match(/<link>([\s\S]*?)<\/link>/) || [])[1] || "";
          const pd = (it.match(/<pubDate>([\s\S]*?)<\/pubDate>/) || [])[1] || "";
          const sr = (it.match(/<source[^>]*>([\s\S]*?)<\/source>/) || [])[1] || "";
          return { judul: clean(ti), tautan: li.trim(), tanggal: pd, sumber: clean(sr) };
        });
        if (artikel.length) sumberBerita = "Google News RSS";
      } catch (e3) { err.rss = e3.message; }
    }
    if (artikel && artikel.length) {
      fs.writeFileSync(path.join(OUT, "berita.json"), JSON.stringify({ sumber: sumberBerita, artikel: artikel, fetched: now }));
      console.log("saved data/berita.json:", artikel.length, "artikel dari", sumberBerita);
    } else {
      const pesan = JSON.stringify(err);
      fs.writeFileSync(path.join(OUT, "berita.json"), JSON.stringify({ status: "Error", message: pesan, sumber: "-", artikel: [], fetched: now }));
      console.log("berita.json ditulis dengan status Error:", pesan);
      errors.berita = pesan;
    }
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

  // --- Berita kopi (NewsData.io utama, fallback Google News RSS) ---
  {
    const ND_KEY = process.env.NEWSDATA_KEY || "";
    let artikel = null;
    let sumberBerita = "Google News RSS";
    if (ND_KEY) {
      try {
        const jn = await getJSON("https://newsdata.io/api/1/latest?apikey=" + ND_KEY + "&q=kopi&country=id&language=id&size=8");
        if (jn && jn.status === "success" && Array.isArray(jn.results) && jn.results.length) {
          artikel = jn.results.map(function (a) {
            return { judul: a.title, tautan: a.link, tanggal: a.pubDate, sumber: a.source_name || a.source_id || "" };
          });
          sumberBerita = "NewsData.io";
        } else {
          console.log("NewsData.io tidak sukses:", JSON.stringify(jn).slice(0, 200));
        }
      } catch (e2) { console.log("NewsData.io error (fallback ke RSS):", e2.message); }
    }
    if (!artikel || !artikel.length) {
      try {
        const xml = await getText("https://news.google.com/rss/search?q=kopi+indonesia&hl=id&gl=ID&ceid=ID:id");
        const items = xml.match(/<item>[\s\S]*?<\/item>/g) || [];
        const clean = function (s) { return String(s || "").replace(/<!\[CDATA\[|\]\]>/g, "").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'").trim(); };
        artikel = items.slice(0, 8).map(function (it) {
          const ti = (it.match(/<title>([\s\S]*?)<\/title>/) || [])[1] || "";
          const li = (it.match(/<link>([\s\S]*?)<\/link>/) || [])[1] || "";
          const pd = (it.match(/<pubDate>([\s\S]*?)<\/pubDate>/) || [])[1] || "";
          const sr = (it.match(/<source[^>]*>([\s\S]*?)<\/source>/) || [])[1] || "";
          return { judul: clean(ti), tautan: li.trim(), tanggal: pd, sumber: clean(sr) };
        });
      } catch (e3) { errors.berita = e3.message; }
    }
    if (artikel && artikel.length) {
      fs.writeFileSync(path.join(OUT, "berita.json"), JSON.stringify({ sumber: sumberBerita, artikel: artikel, fetched: now }));
      console.log("saved data/berita.json:", artikel.length, "artikel dari", sumberBerita);
    } else {
      errors.berita = errors.berita || "kedua sumber kosong";
    }
  }

  // --- USDA FAS PSD — v2026.09.25-1 ---
  // Berdasarkan SDK terbukti (chhayly/usda-fas-sdk, April 2026):
  // host BARU api.fas.usda.gov, header X-Api-Key + Accept: application/json
  {
    const KEY = process.env.USDA_API_KEY || "";
    if (!KEY) {
      fs.writeFileSync(path.join(OUT, "psd.json"), JSON.stringify({ status: "Error", message: "USDA_API_KEY tidak di-set sebagai secret", data: [], fetched: now }));
    } else {
      const BASE = "https://api.fas.usda.gov";
      const coba = [];
      async function usdaGet(url) {
        const r = await fetch(url, { headers: { "X-Api-Key": KEY, "Accept": "application/json", "User-Agent": UA } });
        if (!r.ok) throw new Error("HTTP " + r.status);
        return r.json();
      }
      // 1) cari kode numerik Indonesia dari daftar negara
      let idCode = null;
      try {
        const cs = await usdaGet(BASE + "/api/psd/countries");
        const csArr = Array.isArray(cs) ? cs : [];
        const hit = csArr.filter(function (c) {
          return String(c.gencCode || c.genc || "").toUpperCase() === "ID" || /indonesia/i.test(String(c.name || c.countryName || ""));
        })[0];
        if (hit) idCode = String(hit.countryCode || hit.code || "");
        coba.push("countries:" + csArr.length + " id=" + idCode);
      } catch (e1) { coba.push("countries:ERR " + e1.message); }

      // 1b) cari kode komoditas KOPHI dari daftar komoditas (jangan menebak)
      let coffeeCode = "0711000";
      try {
        const cms = await usdaGet(BASE + "/api/psd/commodities");
        const cmArr = Array.isArray(cms) ? cms : [];
        const kopiHit = cmArr.filter(function (c) { return /coffee/i.test(String(c.commodityName || c.name || "")); });
        const green = kopiHit.filter(function (c) { return /green/i.test(String(c.commodityName || c.name || "")); })[0];
        const anyK = green || kopiHit[0];
        if (anyK) coffeeCode = String(anyK.commodityCode || anyK.code || coffeeCode);
        coba.push("commodities:" + cmArr.length + " kopi=" + JSON.stringify(kopiHit.slice(0, 4).map(function (c) { return (c.commodityCode || c.code) + ":" + (c.commodityName || c.name); })).slice(0, 220));
      } catch (e1b) { coba.push("commodities:ERR " + e1b.message); }

      // 2) ambil data PSD kopi Indonesia
      let rows = null;
      const years = [YEAR, String(Number(YEAR) - 1)];
      const tries = [];
      if (idCode) tries.push(function (yr) { return "/api/psd/commodity/" + coffeeCode + "/country/" + idCode + "/year/" + yr; });
      tries.push(function (yr) { return "/api/psd/commodity/" + coffeeCode + "/country/all/year/" + yr; });
      tries.push(function (yr) { return "/api/psd/commodity/" + coffeeCode + "/world/year/" + yr; });
      tries.push(function (yr) { return "/api/psd/commodity/" + coffeeCode + "/year/" + yr; });
      outer:
      for (const yr of years) {
        for (const t of tries) {
          try {
            const ju = await usdaGet(BASE + t(yr));
            const arr = Array.isArray(ju) ? ju : (Array.isArray(ju.data) ? ju.data : []);
            coba.push(t(yr) + " -> " + arr.length);
            if (arr.length) { rows = { arr: arr, sumber: t(yr) }; break outer; }
          } catch (e2) { coba.push(t(yr) + ":ERR " + e2.message); }
        }
      }

      if (rows && rows.arr.length) {
        // peta attributeId -> nama bila baris hanya punya ID
        let attrMap = {};
        try {
          const at = await usdaGet(BASE + "/api/psd/commodityAttributes");
          const atArr = Array.isArray(at) ? at : [];
          atArr.forEach(function (a) { attrMap[String(a.attributeId !== undefined ? a.attributeId : a.id)] = a.attributeName || a.attributeDescription || a.name || ""; });
          coba.push("attributes:" + atArr.length);
        } catch (e3) { coba.push("attributes:ERR " + e3.message); }
        const unitMap = {};
        try {
          const un = await usdaGet(BASE + "/api/psd/unitsOfMeasure");
          const unArr = Array.isArray(un) ? un : [];
          unArr.forEach(function (x) { unitMap[String(x.unitId !== undefined ? x.unitId : x.id)] = x.unitDescription || x.description || x.name || ""; });
          coba.push("units:" + unArr.length);
        } catch (e3b) { coba.push("units:ERR " + e3b.message); }

        const idn = rows.arr.filter(function (r) {
          const cc = String(r.countryCode !== undefined ? r.countryCode : "");
          const g = String(r.gencCode || r.genc || "").toUpperCase();
          const n = String(r.countryName || r.name || "").toUpperCase();
          return cc === idCode || cc === "536" || g === "ID" || n.indexOf("INDONESIA") !== -1;
        });
        const pakai = idn.length ? idn : rows.arr.slice(0, 50);
        const ambil = function () {
          for (let i = 0; i < arguments.length - 1; i++) {
            const v = arguments[i];
            if (v !== undefined && v !== null && v !== "") return v;
          }
          return "";
        };
        const flat = pakai.map(function (r) {
          return {
            tahun: ambil(r.marketYear, r.MarketYear, r.year, r.Year),
            atribut: ambil(r.attributeName, r.attributeDescription, r.publicAttributeName, r.attribute, (r.attributeId !== undefined ? attrMap[String(r.attributeId)] : ""), r.name),
            nilai: ambil(r.value, r.Value, r.Value1, r.val),
            satuan: ambil(unitMap[String(r.unitId)], r.unitDescription, r.unit, r.UnitDescription, r.unitName),
            negara: ambil(r.countryName, r.name, r.gencCode, r.country)
          };
        }).filter(function (r) { return String(r.atribut) !== ""; });
        fs.writeFileSync(path.join(OUT, "psd.json"), JSON.stringify({
          sumber: "USDA FAS PSD — " + rows.sumber,
          percobaan: coba,
          contohBaris: rows.arr[0],
          data: flat.length ? flat : pakai,
          fetched: now
        }, null, 2));
        console.log("saved data/psd.json:", flat.length, "atribut |", coba.join(" | "));
      } else {
        fs.writeFileSync(path.join(OUT, "psd.json"), JSON.stringify({ status: "Error", message: "Gagal semua varian: " + coba.join(" | "), data: [], fetched: now }));
        console.log("psd.json Error:", coba.join(" | "));
        errors.psd = "kosong";
      }
    }
  }

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
