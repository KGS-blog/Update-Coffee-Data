const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const SOURCE = 'https://raw.githubusercontent.com/KGS-blog/Blog/main/articles.json';
const OUTPUT = path.join(ROOT, 'data/blog-pillar-articles.json');

async function main() {
  const response = await fetch(SOURCE, { headers: { 'user-agent': 'KabarKopi-pillar-import/1.0' }, signal: AbortSignal.timeout(30000) });
  if (!response.ok) throw new Error(`Blog articles fetch failed: HTTP ${response.status}`);
  const document = await response.json();
  if (!document || !Array.isArray(document.articles)) throw new Error('Blog article document has an invalid shape');

  const articles = document.articles.filter(article =>
    article && article.status === 'Published' &&
    ['data-tren', 'berita'].includes(article.kabar_pillar) &&
    Number.isFinite(Number(article.id)) && article.title_id && article.title_en &&
    article.desc_id && article.desc_en && article.content_id && article.content_en
  );
  const ids = new Set();
  for (const article of articles) {
    const id = String(article.id);
    if (ids.has(id)) throw new Error(`Duplicate published article ID: ${id}`);
    ids.add(id);
  }

  const output = { source: SOURCE, fetched_at: new Date().toISOString(), articles };
  fs.mkdirSync(path.dirname(OUTPUT), { recursive: true });
  fs.writeFileSync(OUTPUT, `${JSON.stringify(output, null, 2)}\n`);
  console.log(`Imported ${articles.length} published Blog articles marked for Kabar Kopi.`);
}

main().catch(error => { console.error(error.message); process.exitCode = 1; });
