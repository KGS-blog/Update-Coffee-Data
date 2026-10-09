// Prevent static SEO counts and interactive portal clustering from diverging.
const fs = require('node:fs');
const path = require('node:path');
const { BERITA_KLASTER, clusterBerita } = require('../BERITA_KLASTER_FINAL.js');

const root = path.join(__dirname, '..');
const readJson = (file, fallback) => {
  const fullPath = path.join(root, file);
  return fs.existsSync(fullPath) ? JSON.parse(fs.readFileSync(fullPath, 'utf8')) : fallback;
};
const feed = readJson('data/berita-all.json', { artikel: [] });
const decisions = readJson('data/cluster-decisions.json', { overrides: [] });
const catalog = readJson('data/cluster-catalog.json', { clusters: BERITA_KLASTER });
const definitions = Array.isArray(catalog.clusters) && catalog.clusters.length ? catalog.clusters : BERITA_KLASTER;
const overrides = new Map((decisions.overrides || []).map(item => [String(item.url || item.tautan || ''), item]));
const validOverrideIds = new Set([...definitions.map(cluster => cluster.slug), 'lainnya', 'other', 'tidak-relevan']);
for (const [url, override] of overrides) {
  const chosen = String(override.cluster_id || override.klaster || '');
  if (chosen && !validOverrideIds.has(chosen)) throw new Error(`${url}: editor decision refers to unknown cluster ID “${chosen}”`);
}
const ineligible = article => {
  const key = String(article.tautan || article.link || '');
  const override = overrides.get(key);
  return article.cluster_assignment === 'editor_irrelevant'
    || override?.decision === 'irrelevant'
    || String(override?.cluster_id || '').toLowerCase() === 'tidak-relevan'
    || article.link_type === 'aggregator_redirect'
    || /^(https?:\/\/)?(news\.google\.com|google\.com)\//i.test(key);
};
const eligible = (feed.artikel || []).filter(article => !ineligible(article)).map(article => {
  const override = overrides.get(String(article.tautan || article.link || ''));
  const chosen = override?.cluster_id || override?.klaster;
  if (chosen && article.cluster_id !== chosen) {
    throw new Error(`${article.tautan || article.link}: saved editor override (${chosen}) conflicts with feed assignment (${article.cluster_id || 'none'})`);
  }
  return chosen ? { ...article, cluster_id: chosen, cluster_assignment: 'editor_override' } : article;
});
global.window = { BERITA_KLASTER: definitions };
const result = clusterBerita(eligible);
delete global.window;

const expected = new Map();
for (const cluster of result.klaster || []) expected.set(cluster.nama, cluster.items.length);
if (result.lainnya_items?.length) expected.set('Lainnya', result.lainnya_items.length);
if (result.unclassified_items?.length) expected.set('Belum diklasifikasikan', result.unclassified_items.length);
const actual = new Map();
for (const name of ['index.html', 'kabar-kopi.html']) {
  const html = fs.readFileSync(path.join(root, name), 'utf8');
  const section = html.match(/<div id="topic-counts">([\s\S]*?)<\/div><\/div><div class="sidebar-block">/)?.[1];
  if (!section) throw new Error(`${name}: static topic counts container missing`);
  const rows = [...section.matchAll(/<div class="topic-row">(?:<button[^>]*>([^<]+)<\/button>|<span>([^<]+)<\/span>)<span>([\d,.]+) berita<\/span><\/div>/g)];
  const parsed = new Map(rows.map(row => [(row[1] || row[2]).replace(/&amp;/g, '&'), Number(String(row[3]).replace(/[,.]/g, ''))]));
  const expectedVisible = [...expected.entries()].sort((a, b) => b[1] - a[1]);
  for (const [label, count] of expectedVisible) {
    if ((parsed.get(label) || 0) !== count) throw new Error(`${name}: ${label} shows ${parsed.get(label) || 0}, expected ${count}`);
  }
  const unclassified = parsed.get('Belum diklasifikasikan') || 0;
  if (unclassified !== (result.unclassified_items || []).length) {
    throw new Error(`${name}: unclassified snapshot does not match the current feed`);
  }
  if (html.includes('317 berita')) throw new Error(`${name}: stale “317 berita” snapshot remains`);
  if (!html.includes('portalClusterResult') || html.includes('if(window.BERITA_HASIL_CLUSTERING&&feedFetched)')) {
    throw new Error(`${name}: portal clustering can be overwritten by another global clustering run`);
  }
  actual.set(name, html);
}
if (actual.get('index.html') !== actual.get('kabar-kopi.html')) {
  throw new Error('index.html and kabar-kopi.html differ');
}
const total = [...(result.klaster || []).flatMap(cluster => cluster.items || []), ...(result.lainnya_items || []), ...(result.unclassified_items || [])].length;
if (total !== eligible.length) throw new Error(`classification totals ${total} do not reconcile with ${eligible.length} eligible articles`);
console.log(`Clustering consistency OK: ${eligible.length} eligible stories; ${result.unclassified_items.length} unclassified; static and runtime rules aligned.`);
