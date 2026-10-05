// Put public, crawlable report previews into the initial HTML. The endpoint
// exposes titles and teasers only; complete report bodies remain member-only.
const fs = require("node:fs");
const path = require("node:path");
const root = path.join(__dirname, "..");
const escape = value => String(value || "").replace(/[&<>"']/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char]));

async function previews(language) {
  try {
    const response = await fetch(`https://blog-api.qcoid.com/api/member/mevo-report-previews?language=${language}`, { signal: AbortSignal.timeout(8000), cache: "no-store" });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const data = await response.json();
    return Array.isArray(data.reports) ? data.reports : [];
  } catch (error) {
    console.warn(`MEVO ${language.toUpperCase()} previews unavailable during static render: ${error.message}`);
    return [];
  }
}

function render(reports, language, compact = false) {
  if (!reports.length) return `<p>${language === "en" ? "A new MEVO report preview will appear here when one is published." : "Cuplikan report MEVO akan tampil di sini setelah laporan diterbitkan."}</p>`;
  return reports.map(report => {
    const published = Date.parse(report.published_at || "");
    const date = !compact && Number.isFinite(published) ? `<p class="source-line">${language === "en" ? "Published " : "Diterbitkan "}${escape(new Intl.DateTimeFormat(language === "en" ? "en-GB" : "id-ID", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }).format(new Date(published)))}</p>` : "";
    return `<article class="mevo-preview-item"><span class="mevo-preview-label">${language === "en" ? "MEVO member report" : "Report MEVO anggota"}</span><h3>${escape(String(report.title || "").slice(0, 240))}</h3><p>${escape(String(report.teaser || "").slice(0, 700))}</p>${date}</article>`;
  }).join("");
}

async function main() {
  const [id, en] = await Promise.all([previews("id"), previews("en")]);
  const searchBySlug = new Map();
  for (const [language, reports] of [["id", id], ["en", en]]) for (const report of reports) {
    const baseSlug = String(report.slug || "").replace(/-(?:id|en)$/i, "");
    if (!baseSlug) continue;
    const row = searchBySlug.get(baseSlug) || { slug: baseSlug };
    row[`title_${language}`] = String(report.title || "").slice(0, 240);
    row[`teaser_${language}`] = String(report.teaser || "").slice(0, 700);
    searchBySlug.set(baseSlug, row);
  }
  const searchIndex = JSON.stringify([...searchBySlug.values()]).replace(/</g, "\\u003c");
  const files = ["index.html", "kabar-kopi.html"];
  for (const filename of files) {
    const target = path.join(root, filename);
    let html = fs.readFileSync(target, "utf8");
    html = html.replace("<!-- STATIC_PUBLIC_MEVO_PREVIEW_ID -->", render(id.slice(0, 3), "id"));
    html = html.replace("<!-- STATIC_PUBLIC_MEVO_PREVIEW_EN -->", render(en.slice(0, 3), "en"));
    html = html.replace("<!-- STATIC_MEVO_SEARCH_INDEX -->", searchIndex);
    fs.writeFileSync(target, html);
  }
  const englishPath = path.join(root, "en/index.html");
  let english = fs.readFileSync(englishPath, "utf8");
  english = english.replace("<!-- STATIC_PUBLIC_MEVO_PREVIEW_EN -->", render(en, "en", true));
  fs.writeFileSync(englishPath, english);
  console.log(`Rendered public ID/EN MEVO previews into ${files.join(", ")} and en/index.html; full report content was not included.`);
}

main().catch(error => { console.error(error); process.exitCode = 1; });
