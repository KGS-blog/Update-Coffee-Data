// Render the same crawlable direct-publisher headlines into both Kabar Kopi entrypoints.
// generate-editorial-pages.js creates index.html and kabar-kopi.html from one template;
// keep their homepage snapshots identical so the root URL cannot fall behind.
const fs = require("node:fs");
const path = require("node:path");
const root = path.join(__dirname, "..");
const feedPath = path.join(root, "data", "berita-all.json");
const escape = value => String(value || "").replace(/[&<>"']/g, ch => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch]));
const dateValue = article => Date.parse(article.tanggal || article.pubDate || "") || 0;
const isDirectPublisherUrl = value => {
  try {
    const url = new URL(String(value || ""));
    return url.protocol === "https:" && !/(^|\.)google\.com$/i.test(url.hostname) && !/(^|\.)news\.google\.com$/i.test(url.hostname);
  } catch (_) { return false; }
};
const feed = JSON.parse(fs.readFileSync(feedPath, "utf8"));
const articles = (Array.isArray(feed.artikel) ? feed.artikel : [])
  .filter(article => article.cluster_assignment !== "editor_irrelevant" && isDirectPublisherUrl(article.tautan || article.link))
  .sort((a, b) => dateValue(b) - dateValue(a))
  .slice(0, 6);
const formatDate = article => {
  const date = new Date(dateValue(article));
  if (Number.isNaN(date.getTime())) return "";
  const precision = article.publication_date_precision || "day";
  const options = precision === "year" ? { year: "numeric" }
    : precision === "month" ? { month: "long", year: "numeric" }
    : { day: "numeric", month: "short", year: "numeric" };
  return new Intl.DateTimeFormat("id-ID", { ...options, timeZone: "Asia/Jakarta" }).format(date);
};
const sourceOf = article => article.sumber || article.source_name || "Sumber penerbit";
const categoryOf = article => article.cluster_name && article.cluster_name !== "Lainnya" ? article.cluster_name : "Berita kopi";
const linkOf = article => article.tautan || article.link;
const lead = articles.length ? `<article id="lead-story" class="home-feature-card feed-feature"><div class="eyebrow"><span class="id-copy">Pilar 5 · Berita terkini</span><span class="en-copy">Pillar 5 · Latest news</span></div><p class="feature-topic">${escape(categoryOf(articles[0]))}</p><a class="lead-link" href="${escape(linkOf(articles[0]))}" target="_blank" rel="noopener noreferrer"><h2>${escape(articles[0].judul || articles[0].title)}</h2></a><p>${escape(sourceOf(articles[0]))} · ${escape(formatDate(articles[0]))} · <span class="id-copy">Sumber artikel langsung</span><span class="en-copy">Direct publisher source</span></p><a class="home-feature-link id-copy" href="/berita-kopi/">Jelajahi berita terkini →</a><a class="home-feature-link en-copy" href="/en/coffee-news/">Explore latest news →</a></article>` : `<article id="lead-story" class="home-feature-card feed-feature"><div class="eyebrow"><span class="id-copy">Pilar 5 · Berita terkini</span><span class="en-copy">Pillar 5 · Latest news</span></div><h2>Berita kopi terbaru sedang dimuat</h2><p>Daftar berita akan tampil setelah feed diperbarui.</p><a class="home-feature-link id-copy" href="/berita-kopi/">Jelajahi berita terkini →</a><a class="home-feature-link en-copy" href="/en/coffee-news/">Explore latest news →</a></article>`;
const latest = articles.slice(1).map(article => `<li><a href="${escape(linkOf(article))}" target="_blank" rel="noopener noreferrer">${escape(article.judul || article.title)}</a><div class="meta">${escape(sourceOf(article))} <i class="dot"></i> ${escape(formatDate(article))} · Sumber artikel langsung</div></li>`).join("");
const targets = ["index.html", "kabar-kopi.html"];
for (const filename of targets) {
  const htmlPath = path.join(root, filename);
  const html = fs.readFileSync(htmlPath, "utf8");
  const updated = html
    .replace(/<article id="lead-story" class="(?:lead|home-feature-card feed-feature)">[\s\S]*?<\/article>/, lead)
    .replace(/(<ul id="home-latest" class="side-list">)[\s\S]*?(<\/ul>)/, `$1${latest}$2`);
  if (updated === html) throw new Error(`Homepage markup not found or unchanged in ${filename}.`);
  fs.writeFileSync(htmlPath, updated);
}
console.log(`Rendered ${articles.length} direct-publisher headlines into ${targets.join(" and ")}.`);
