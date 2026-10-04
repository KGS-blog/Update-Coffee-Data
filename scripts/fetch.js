// QCO Data Pipeline — fetch.js — v2026.09.26-9
// Repo: KGS-blog/Update-Coffee-Data — dijalankan via GitHub Actions (.github/workflows/)
// Output:
//   data/market-data.json  -> format lama dipertahankan (arabica/robusta/idrUsd + history)
//   data/ekspor.json       -> validated BPS coffee trade records by HS code
// Sumber: Yahoo Finance v8 (KC=F, IDR=X), ICO daily Robustas indicator, dan BPS.
// ICO Robustas adalah indikator grup dalam US cents/lb, bukan kuotasi futures ICE.

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
function isGoogleNewsRedirect(value) {
  try { const host = new URL(String(value || "")).hostname.toLowerCase(); return host === "google.com" || host.endsWith(".google.com"); }
  catch (_) { return false; }
}
function headlineKey(article) {
  let title = String(article && (article.judul || article.title) || "").trim();
  const source = String(article && (article.sumber || article.source_name) || "").trim();
  if (source) {
    const suffix = " - " + source;
    if (title.toLowerCase().endsWith(suffix.toLowerCase())) title = title.slice(0, -suffix.length);
  }
  return title.normalize("NFKC").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
}
function decodeXmlText(value) {
  return String(value || "").replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").trim();
}
function xmlTag(block, name) {
  const match = String(block || "").match(new RegExp("<(?:[\\w.-]+:)?" + name + "(?:\\s[^>]*)?>([\\s\\S]*?)<\\/(?:[\\w.-]+:)?" + name + ">", "i"));
  return match ? decodeXmlText(match[1]) : "";
}
function isGoogleHost(value) {
  try { const host = new URL(String(value || "")).hostname.toLowerCase(); return host === "google.com" || host.endsWith(".google.com"); }
  catch (_) { return false; }
}
function htmlAttr(tag, name) {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = String(tag || "").match(new RegExp("\\b" + escaped + "\\s*=\\s*([\\\"'])(.*?)\\1", "i"));
  return match ? decodeXmlText(match[2]).replace(/&amp;/g, "&") : "";
}
async function resolveGoogleNewsPublisher(url) {
  try {
    const response = await fetch(url, { headers: UA, redirect: "follow", signal: AbortSignal.timeout(10000) });
    const finalUrl = response.url || url;
    if (!isGoogleHost(finalUrl)) return finalUrl;
    const html = (await response.text()).slice(0, 1200000);
    const linkTags = html.match(/<link\b[^>]*>/gi) || [];
    for (const tag of linkTags) {
      const rel = htmlAttr(tag, "rel").toLowerCase().split(/\s+/);
      const candidate = htmlAttr(tag, "href");
      if (rel.includes("canonical") && candidate && !isGoogleHost(candidate)) return candidate;
    }
    const metaTags = html.match(/<meta\b[^>]*>/gi) || [];
    for (const tag of metaTags) {
      const key = (htmlAttr(tag, "property") || htmlAttr(tag, "name")).toLowerCase();
      const candidate = htmlAttr(tag, "content");
      if (["og:url", "article:published_url"].includes(key) && candidate && !isGoogleHost(candidate)) return candidate;
    }
  } catch (_) {}
  return "";
}
async function getGoogleNewsCandidates() {
  const queries = ["kopi Indonesia", "coffee Indonesia arabica robusta"];
  const found = [];
  for (const query of queries) {
    try {
      const url = "https://news.google.com/rss/search?q=" + encodeURIComponent(query) + "&hl=id&gl=ID&ceid=ID:id";
      const response = await fetch(url, { headers: UA, signal: AbortSignal.timeout(12000) });
      if (!response.ok) throw new Error("HTTP " + response.status);
      const xml = await response.text();
      for (const block of xml.match(/<item\b[^>]*>[\s\S]*?<\/item>/gi) || []) {
        const title = xmlTag(block, "title");
        const link = xmlTag(block, "link");
        if (!title || !link || !/^https?:\/\//i.test(link)) continue;
        const sourceTag = (block.match(/<(?:[\w.-]+:)?source\b[^>]*>[\s\S]*?<\/(?:[\w.-]+:)?source>/i) || [""])[0];
        const source = decodeXmlText(sourceTag.replace(/^<[\s\S]*?>/, "").replace(/<\/[\s\S]*$/, ""));
        found.push({ judul: title, tautan: link, tanggal: xmlTag(block, "pubDate"), sumber: source || "Google News", asal: "google_news", aggregator: "Google News", link_type: "aggregator_redirect", resolution_status: "unresolved" });
      }
    } catch (error) {
      console.log("Google News discovery skipped:", error.message);
    }
  }
  const seen = new Set();
  return found.filter(item => { const key = headlineKey(item); if (!key || seen.has(key)) return false; seen.add(key); return true; }).slice(0, 6);
}

(async () => {
  const now = new Date().toISOString();
  const mPath = path.join(OUT, "market-data.json");
  let data;
  try { data = JSON.parse(fs.readFileSync(mPath, "utf8")); }
  catch (e) {
    data = {
      meta: { source: "Yahoo Finance via GitHub Actions", version: "2.0", historyNote: "Riwayat sebelum Sep 2026 adalah baseline ilustratif; data mulai Sep 2026 adalah data riil harian." },
      arabica: { symbol: "KC=F", name: "Arabica C-Market", unit: "cents/lb", history: [] },
      robusta: { symbol: "ICO-ROBUSTAS", name: "ICO Robustas Daily Indicator", unit: "USD/ton equivalent", history: [] },
      idrUsd: { symbol: "IDR=X", name: "IDR/USD", unit: "IDR/USD", history: [] }
    };
  }
  if (!data.meta) data.meta = {};
  data.meta.source = "Yahoo Finance (Arabica, IDR/USD) + International Coffee Organization (ICO Robustas daily indicator) via GitHub Actions";
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

  // --- ICO Robustas daily group indicator (US cents/lb -> USD/metric ton equivalent) ---
  try {
    const ico = await getJSON("https://data.ico.org/api/globe/icip");
    const daily = Array.isArray(ico && ico.daily) ? ico.daily : [];
    const points = daily.filter(x => x && /^\d{4}-\d{2}-\d{2}$/.test(x.date) && Number.isFinite(Number(x.ROBUSTAS)) && Number(x.ROBUSTAS) > 0).sort((a, b) => a.date.localeCompare(b.date));
    if (!points.length) throw new Error("ICO tidak mengirim nilai Robustas harian");
    const latest = points[points.length - 1];
    const sourceCentsLb = Number(latest.ROBUSTAS);
    // Convert cents/lb to USD per metric tonne: 1 cent/lb = 22.0462262185 USD/t.
    const p = Math.round(sourceCentsLb * 22.0462262185);
    const ageDays = (Date.now() - Date.parse(latest.date + "T00:00:00Z")) / 86400000;
    if (ageDays < -1 || ageDays > 7) throw new Error("data ICO terakhir terlalu lama: " + latest.date);
    const previous = points.length > 1 ? Number(points[points.length - 2].ROBUSTAS) : sourceCentsLb;
    const previousTon = Math.round(previous * 22.0462262185);
    data.robusta.symbol = "ICO-ROBUSTAS";
    data.robusta.name = "ICO Robustas Daily Indicator";
    data.robusta.unit = "USD/ton equivalent";
    data.robusta.current = Math.round(p);
    data.robusta.change = Math.round(p - previousTon);
    data.robusta.changePercent = previousTon ? round2((p - previousTon) / previousTon * 100) : 0;
    data.robusta.sourceValue = sourceCentsLb;
    data.robusta.sourceUnit = "US cents/lb";
    data.robusta.sourceDate = latest.date;
    data.robusta.sourceUrl = "https://www.ico.org/resources/public-market-information/";
    data.robusta.lastUpdated = now;
    data.robusta.history = []; // No synthetic or monthly-mean history presented as daily observations.
    data.robusta.stale = false;
    console.log("ICO Robustas:", sourceCentsLb, "US cents/lb (", data.robusta.current, "USD/t equivalent), date", latest.date);
  } catch (e) {
    errors.robusta = e.message;
    data.robusta.stale = true; // retain last successful value, never present it as current
    console.log("ICO Robustas unavailable -> stale:", e.message);
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

  // --- Berita kopi (tautan artikel penerbit sebagai prioritas) ---
  {
    const ND_KEY = process.env.NEWSDATA_KEY || "";
    const diag = {};
    let sumberBerita = "";
    const pool = [];
    // 0) ENGINE KGS — sumber utama, artikel terkurasi + ringkasan
    try {
      const je = await getJSON("https://kgs-blog.github.io/coffee-feed/berita.json");
      const arrE = (je && Array.isArray(je.artikel)) ? je.artikel : [];
      if (arrE.length) {
        pool.push.apply(pool, arrE.map(function (a) {
          return { judul: a.judul, tautan: a.tautan, tanggal: a.tanggal, sumber: a.sumber || "Engine KGS", ringkasan: a.ringkasan || a.deskripsi || "", asal: "engine", link_type: "publisher" };
        }));
        diag.engine = "sukses " + arrE.length;
      } else { diag.engine = "kosong"; }
    } catch (eE) { diag.engine = "ERR " + eE.message; }
    if (ND_KEY) {
      const enc = encodeURIComponent;
      // Free plan permits at most 10 results per request. Pull several focused
      // searches and retain the publisher's article URL from `link`.
      const searches = [
        "qInTitle=" + enc("kopi") + "&country=id&language=id",
        "q=" + enc("kopi indonesia") + "&country=id&language=id",
        "q=" + enc("arabica OR robusta") + "&language=id"
      ];
      async function newsDataGet(query) {
        const response = await fetch("https://newsdata.io/api/1/latest?apikey=" + ND_KEY + "&" + query + "&size=10", { headers: UA });
        const json = await response.json().catch(() => ({}));
        if (!response.ok) {
          const detail = json?.results?.message || json?.message || "permintaan ditolak";
          throw new Error("HTTP " + response.status + ": " + String(detail).slice(0, 140));
        }
        return json;
      }
      let collected = 0;
      for (const query of searches) {
        try {
          const jn = await newsDataGet(query);
          if (jn && jn.status === "success" && Array.isArray(jn.results) && jn.results.length) {
            const direct = jn.results.filter(a => /^https?:\/\//i.test(String(a.link || "")) && !/^(https?:\/\/)?(news\.google\.com|google\.com)\//i.test(String(a.link || "")));
            pool.push.apply(pool, direct.map(function (a) {
              return { judul: a.title, tautan: a.link, tanggal: a.pubDate, sumber: a.source_name || a.source_id || "", ringkasan: a.description || a.content || "", asal: "newsdata", link_type: "publisher" };
            }));
            collected += direct.length;
            diag.newsdata = "sukses " + collected + " tautan penerbit langsung";
          } else {
            diag.newsdata = "status=" + (jn && jn.status) + " " + String(jn && (jn.results?.message || jn.message) || "").slice(0, 120);
          }
        } catch (e2) { diag.newsdata = "ERR " + e2.message; }
      }
    } else {
      diag.newsdata = "key tidak di-set";
    }
    // Google News is a small discovery source only. Resolve its redirect to a
    // publisher URL when possible; unresolved items remain explicitly labeled.
    const rssCandidates = await getGoogleNewsCandidates();
    const resolvedCandidates = await Promise.all(rssCandidates.map(async function (item) {
      const publisherUrl = await resolveGoogleNewsPublisher(item.tautan);
      if (publisherUrl && !isGoogleHost(publisherUrl)) {
        return Object.assign({}, item, { tautan_google_news: item.tautan, tautan: publisherUrl, link_type: "publisher", resolution_status: "resolved" });
      }
      return item;
    }));
    const rssDirect = resolvedCandidates.filter(a => a.resolution_status === "resolved");
    const rssUnresolved = resolvedCandidates.filter(a => a.resolution_status !== "resolved");
    pool.push.apply(pool, rssDirect);
    diag.google_news_rss = "kandidat " + rssCandidates.length + "; URL penerbit terverifikasi " + rssDirect.length + "; tetap agregator " + rssUnresolved.length;
    const artikel = pool;
    if (artikel && artikel.length) {
      const KOPI_RX = /kopi|coffee|arabica|robusta/i;
      const seen = new Set();
      const seenTitles = new Set();
      const uniq = artikel.filter(function (a) {
        const href = String(a.tautan || "");
        if (!/^https?:\/\//i.test(href) || isGoogleNewsRedirect(href) || a.link_type === "aggregator_redirect") return false;
        const k = href || String(a.judul || "");
        if (seen.has(k)) return false;
        seen.add(k);
        const title = headlineKey(a);
        if (title && seenTitles.has(title)) return false;
        if (title) seenTitles.add(title);
        return true;
      });
      // Engine is curated; NewsData results must still mention coffee in title.
      const relevan = uniq.filter(function (a) { return a.asal === "engine" || KOPI_RX.test(String(a.judul || "")); });
      // Komposisi: engine terkurasi selalu hadir (maksimum 10), sisanya berita NewsData terbaru.
      const byDate = function (a, b) { return (Date.parse(b.tanggal) || 0) - (Date.parse(a.tanggal) || 0); };
      const eng = relevan.filter(function (a) { return a.asal === "engine"; }).sort(byDate).slice(0, 10);
      const lain = relevan.filter(function (a) { return a.asal !== "engine"; }).sort(byDate);
      const seenE = new Set(eng.map(function (a) { return String(a.tautan || a.judul); }));
      const directSimpan = eng.concat(lain.filter(function (a) { const k = String(a.tautan || a.judul); if (seenE.has(k)) return false; seenE.add(k); return true; })).slice(0, 25);
      const directTitles = new Set(directSimpan.map(headlineKey));
      const distinctUnresolved = rssUnresolved.filter(function (a) {
        const title = headlineKey(a);
        return title && !directTitles.has(title) && KOPI_RX.test(String(a.judul || ""));
      });
      // At most one aggregator item per nine direct stories, capped at two.
      // Thus Google News can never exceed 10% of the visible latest feed.
      const aggregatorCap = Math.min(2, Math.floor(directSimpan.length / 9));
      const aggregators = distinctUnresolved.sort(byDate).slice(0, aggregatorCap);
      const simpan = directSimpan.concat(aggregators);
      sumberBerita = "Engine KGS + NewsData (tautan penerbit)" + (aggregators.length ? " + Google News (agregator, " + aggregators.length + ")" : "");
      diag.google_news_published = aggregators.length + " dari maksimum " + aggregatorCap + " item agregator; porsi " + (simpan.length ? Math.round(aggregators.length / simpan.length * 100) : 0) + "%";
      console.log("berita relevan:", simpan.length, "dari", uniq.length, "| engine:", eng.length);
      if (!eng.length && !lain.length) diag.feed = "tidak ada berita dengan tautan artikel langsung";
      fs.writeFileSync(path.join(OUT, "berita.json"), JSON.stringify({ sumber: sumberBerita, artikel: simpan, diagnostik: diag, fetched: now }));
      // ARSIP BULANAN: kumulatif per bulan, dedupe by tautan
      try {
        const bln = now.slice(0, 7);
        const arsipPath = path.join(OUT, "arsip", "berita-" + bln + ".json");
        fs.mkdirSync(path.join(OUT, "arsip"), { recursive: true });
        let arsip = { bulan: bln, artikel: [] };
        try { arsip = JSON.parse(fs.readFileSync(arsipPath, "utf8")); } catch (e0) {}
        const byUrl = new Map((arsip.artikel || []).map(function (a) { return [String(a.tautan || a.judul), a]; }));
        simpan.forEach(function (a) {
          const k = String(a.tautan || a.judul), old = byUrl.get(k);
          if (!old) { arsip.artikel.push(a); byUrl.set(k, a); }
          else if (!old.ringkasan && a.ringkasan) old.ringkasan = a.ringkasan;
          if (!old && !isGoogleNewsRedirect(a.tautan)) {
            const key = headlineKey(a);
            const priorIndex = key ? arsip.artikel.findIndex(function (item) { return isGoogleNewsRedirect(item.tautan) && headlineKey(item) === key; }) : -1;
            if (priorIndex >= 0) {
              arsip.artikel[priorIndex] = Object.assign({}, arsip.artikel[priorIndex], a);
              byUrl.set(k, arsip.artikel[priorIndex]);
              arsip.artikel.pop();
            }
          }
        });
        fs.writeFileSync(arsipPath, JSON.stringify(arsip, null, 1));
        console.log("saved data/arsip/berita-" + bln + ".json:", arsip.artikel.length, "artikel terkumpul");
      } catch (eA) { console.log("arsip skip:", eA.message); }
      // MASTER KUMULATIF untuk tab Clustering: SELURUH relevan (bukan cuma top-25), dedupe, FIFO cap 500
      try {
        const ALL_PATH = path.join(OUT, "berita-all.json");
        let all = { artikel: [] };
        try { all = JSON.parse(fs.readFileSync(ALL_PATH, "utf8")); } catch (e0) {}
        // Keep the clustering/search master focused on publisher sources.
        // Unresolved aggregator records remain searchable in monthly archives.
        all.artikel = (all.artikel || []).filter(function (a) { return a.link_type !== "aggregator_redirect" && !isGoogleNewsRedirect(a.tautan || a.link); });
        // TERAPKAN override pengguna (klaster-final.json: [{tautan, klaster}])
        try {
          const ov = JSON.parse(fs.readFileSync(path.join(OUT, "klaster-final.json"), "utf8"));
          if (Array.isArray(ov)) {
            const map = {};
            ov.forEach(function (o) { map[String(o.tautan)] = o.klaster; });
            all.artikel = (all.artikel || []).map(function (a) {
              const k = String(a.tautan || a.judul);
              return map[k] ? Object.assign({}, a, { klaster_user: map[k] }) : a;
            });
          }
        } catch (eOv) {}
        const byUrl = new Map((all.artikel || []).map(function (a, idx) { return [String(a.tautan || a.judul), idx]; }));
        directSimpan.concat(aggregators).forEach(function (a) {
          const k = String(a.tautan || a.judul);
          if (!byUrl.has(k)) { all.artikel.push(a); byUrl.set(k, all.artikel.length - 1); }
          else {
            const old = all.artikel[byUrl.get(k)];
            if (!old.ringkasan && a.ringkasan) old.ringkasan = a.ringkasan;
            if (!old.sumber && a.sumber) old.sumber = a.sumber;
          }
          if (byUrl.has(k) && !isGoogleNewsRedirect(a.tautan)) {
            const index = byUrl.get(k);
            const key = headlineKey(a);
            const priorIndex = key ? all.artikel.findIndex(function (item, idx) { return idx !== index && isGoogleNewsRedirect(item.tautan) && headlineKey(item) === key; }) : -1;
            if (priorIndex >= 0) {
              all.artikel[priorIndex] = Object.assign({}, all.artikel[priorIndex], a);
              all.artikel.splice(index, 1);
              byUrl.clear();
              all.artikel.forEach(function (item, idx) { byUrl.set(String(item.tautan || item.judul), idx); });
            }
          }
        });
        all.artikel.sort(function (a, b) { return (Date.parse(b.tanggal) || 0) - (Date.parse(a.tanggal) || 0); });
        if (all.artikel.length > 500) all.artikel = all.artikel.slice(0, 500);
        all.fetched = now;
        fs.writeFileSync(ALL_PATH, JSON.stringify(all));
        console.log("saved data/berita-all.json:", all.artikel.length, "artikel kumulatif");
      } catch (eAll) { console.log("berita-all skip:", eAll.message); }
      console.log("saved data/berita.json:", simpan.length, "artikel dari", sumberBerita);
    } else {
      const pesan = JSON.stringify(diag);
      fs.writeFileSync(path.join(OUT, "berita.json"), JSON.stringify({ status: "Error", message: pesan, sumber: "-", artikel: [], fetched: now }));
      console.log("berita.json ditulis dengan status Error:", pesan);
      errors.berita = pesan;
    }
  }

  // --- USDA FAS PSD — v2026.09.26-9 ---
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
        if (!idn.length) {
          rows = null;
        }
        const pakai = idn;
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
        if (rows && flat.length) {
          fs.writeFileSync(path.join(OUT, "psd.json"), JSON.stringify({
            sumber: "USDA FAS PSD API",
            data: flat.map(function (row) { return { tahun: row.tahun, atribut: row.atribut, nilai: row.nilai, satuan: row.satuan, negara: "Indonesia" }; }),
            fetched: now
          }, null, 2));
          console.log("saved data/psd.json:", flat.length, "atribut");
        } else {
          const previous = (function () { try { return JSON.parse(fs.readFileSync(path.join(OUT, "psd.json"), "utf8")); } catch (_) { return { data: [] }; } })();
          fs.writeFileSync(path.join(OUT, "psd.json"), JSON.stringify({ status: "stale", sumber: "USDA FAS PSD API", message: "Pembaruan data gagal; nilai terakhir ditampilkan bila tersedia.", data: previous.data || [], fetched: previous.fetched || "", attempted_at: now }, null, 2));
          errors.psd = "USDA returned no attributable Indonesia records";
          console.log("psd.json stale: no attributable Indonesia records");
        }
      } else {
        const previous = (function () { try { return JSON.parse(fs.readFileSync(path.join(OUT, "psd.json"), "utf8")); } catch (_) { return { data: [] }; } })();
        fs.writeFileSync(path.join(OUT, "psd.json"), JSON.stringify({ status: "stale", sumber: "USDA FAS PSD API", message: "Pembaruan data gagal; nilai terakhir ditampilkan bila tersedia.", data: previous.data || [], fetched: previous.fetched || "", attempted_at: now }));
        console.log("psd.json stale:", coba.join(" | "));
        errors.psd = "kosong";
      }
    }
  }

  // --- maintenance arsip analisis: gabung analisis-berita.json terbaru ke arsip (FIFO 6 batch) ---
  try {
    const ARSIP_A = path.join(OUT, "analisis-arsip.json");
    let arsip = { batas_batch: 6, batches: [] };
    try { arsip = JSON.parse(fs.readFileSync(ARSIP_A, "utf8")); } catch (e0) {}
    let baru = null;
    try { baru = JSON.parse(fs.readFileSync(path.join(OUT, "analisis-berita.json"), "utf8")); } catch (e1) { console.log("arsip: analisis-berita.json tidak terbaca:", e1.message); }
    // terima dua format: batch tunggal ({grup:[...]}) atau arsip ({batches:[...]})
    const daftarBaru = [];
    if (baru && Array.isArray(baru.grup)) daftarBaru.push(baru);
    if (baru && Array.isArray(baru.batches)) baru.batches.forEach(function (b) { if (b && Array.isArray(b.grup)) daftarBaru.push(b); });
    daftarBaru.forEach(function (b) {
      const key = String(b.periode || b.dibuat || "");
      arsip.batches = (arsip.batches || []).filter(function (x) { return String(x.periode || x.dibuat || "") !== key; });
      arsip.batches.unshift({ dibuat: b.dibuat, periode: b.periode, jumlah_berita: b.jumlah_berita, grup: b.grup });
    });
    if (daftarBaru.length) console.log("arsip: batch dari analisis-berita.json:", daftarBaru.length);
    // impor file batch lama (analisis-batch-*.json) SELALU jalan (di luar penjagaan), lalu file dihapus
    try {
      const files = fs.readdirSync(OUT).filter(function (x) { return /^analisis-batch-.*\.json$/.test(x); });
      files.forEach(function (fn) {
        try {
          const b = JSON.parse(fs.readFileSync(path.join(OUT, fn), "utf8"));
          if (b && Array.isArray(b.grup)) {
            const key = String(b.periode || b.dibuat || fn);
            if (!arsip.batches.some(function (x) { return String(x.periode || x.dibuat || "") === key; })) {
              arsip.batches.unshift({ dibuat: b.dibuat, periode: b.periode, jumlah_berita: b.jumlah_berita, grup: b.grup });
              console.log("impor batch:", fn, "->", b.periode);
            }
            fs.unlinkSync(path.join(OUT, fn));
          }
        } catch (eB) { console.log("impor gagal", fn, eB.message); }
      });
    } catch (eScan) {}
    const cap = arsip.batas_batch || 6;
    arsip.batches = (arsip.batches || []).slice(0, cap);
    arsip.diperbarui = now;
    fs.writeFileSync(ARSIP_A, JSON.stringify(arsip, null, 1));
    console.log("saved data/analisis-arsip.json:", arsip.batches.length, "batch");
  } catch (eAr) { console.log("arsip analisis skip:", eAr.message); }

  data.meta.lastUpdated = now;
  data.meta.nextUpdate = "Auto: GitHub Actions";
  fs.writeFileSync(mPath, JSON.stringify(data, null, 2));
  console.log("saved data/market-data.json");

  // --- BPS coffee exports: read only the validated coffee trade-by-HS dataset ---
  {
    try {
      const jb = await getJSON("https://kgs-blog.github.io/coffee-feed/bps.json");
      const datasets = Array.isArray(jb && jb.datasets) ? jb.datasets : [];
      const tradeDataset = datasets.find(function (dataset) { return dataset && dataset.id === "bps_coffee_trade_hs"; });
      const records = tradeDataset && Array.isArray(tradeDataset.records) ? tradeDataset.records : [];
      const exportRecords = records.filter(function (row) {
        // This dataset is already coffee-only; its rows do not populate `commodity`.
        return row && row.trade_flow === "export" &&
          Number.isFinite(Number(row.year)) && Number.isFinite(Number(row.volume)) &&
          Number.isFinite(Number(row.value)) && Number.isFinite(Number(row.value_usd)) && Boolean(row.hs_code);
      }).map(function (row) {
        return {
          source: row.source || "BPS",
          year: Number(row.year),
          geography: row.geography || "Indonesia",
          trade_flow: row.trade_flow,
          hs_code: String(row.hs_code),
          hs_description_id: row.hs_description_id || "",
          volume: Number(row.volume),
          volume_unit: row.volume_unit || "ton",
          value: Number(row.value),
          value_unit: row.value_unit || "",
          value_usd: Number(row.value_usd),
          raw_volume: row.raw_volume || "",
          raw_value: row.raw_value || "",
          source_note: row.scope_note || "",
          publication_url: row.publication_url || "",
          publication_revised_at: row.publication_revised_at || "",
          table: row.table || "",
          validation: row.validation || ""
        };
      });
      const years = exportRecords.map(function (row) { return row.year; });
      const output = {
        status: exportRecords.length ? "success" : "no_data",
        sumber: "BPS via KGS Coffee Feed",
        dataset_id: tradeDataset ? tradeDataset.id : "bps_coffee_trade_hs",
        judul: tradeDataset ? tradeDataset.title : "Perdagangan kopi menurut kode HS",
        fetched: now,
        data: exportRecords,
        tahun: years.length ? { dari: Math.min.apply(null, years), hingga: Math.max.apply(null, years) } : null,
        catatan: tradeDataset ? (tradeDataset.usage_note || "") : "Dataset perdagangan kopi menurut kode HS belum ditemukan."
      };
      fs.writeFileSync(path.join(OUT, "ekspor.json"), JSON.stringify(output, null, 2));
      if (exportRecords.length) console.log("saved data/ekspor.json: BPS coffee exports", exportRecords.length, "records");
      else { errors.ekspor = "dataset BPS coffee trade HS belum memuat baris ekspor tervalidasi"; console.log("BPS coffee exports: no validated rows"); }
    } catch (eB) {
      fs.writeFileSync(path.join(OUT, "ekspor.json"), JSON.stringify({ status: "Error", message: "Engine BPS: " + eB.message, data: [], fetched: now }));
      console.log("engine bps error:", eB.message);
      errors.ekspor = eB.message;
    }
  }

  })();
