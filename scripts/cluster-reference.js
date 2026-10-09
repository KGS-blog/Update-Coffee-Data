// Local, API-free nearest-neighbour suggestions for unassigned coffee news.
// Only explicit editor decisions are used as reference labels. AI and rule
// assignments never teach this reference layer.
const STOP = new Set((`yang dan atau dari untuk dengan pada dalam ini itu sebagai adalah akan telah oleh karena tentang agar saat setelah kepada terhadap antara sebuah para dari juga bagi lebih paling dapat tidak kopi coffee berita news indonesia indonesia's the a an and or of to for with in on at by is are was were from this that its their as into about after over across new how what why who when`).split(/\s+/));

const clean = value => String(value || "").toLowerCase()
  .normalize("NFKD").replace(/[\u0300-\u036f]/g, "")
  .replace(/<[^>]*>/g, " ").replace(/&nbsp;/gi, " ")
  .replace(/[^\p{L}\p{N}]+/gu, " ").trim();

const tokens = value => clean(value).split(/\s+/)
  .filter(word => word.length >= 3 && !STOP.has(word));

const titleTokens = article => [...new Set(tokens(article.judul || article.title))];
const contextOf = article => String(article.coffee_relevance_context || article.content_excerpt || article.ringkasan || article.deskripsi || article.description || "")
  .replace(/<[^>]*>/g, " ").replace(/&nbsp;/gi, " ").trim();

const tokenCounts = article => {
  const counts = new Map();
  const add = (list, weight) => list.forEach(token => counts.set(token, (counts.get(token) || 0) + weight));
  add(tokens(article.judul || article.title), 3);
  add(tokens(contextOf(article)).slice(0, 900), 1);
  return counts;
};

const trustedReference = article => (article.cluster_assignment === "editor"
  || (article.cluster_assignment === "editor_irrelevant" && article.cluster_id === "tidak-relevan"))
  && article.cluster_id
  && article.extraction_status === "extracted" && contextOf(article).length >= 80;

function makeIndex(referenceArticles, taxonomy) {
  const byId = new Map(taxonomy.map(cluster => [cluster.slug, cluster]));
  byId.set("lainnya", { slug: "lainnya", nama: "Lainnya", nama_en: "Other" });
  byId.set("tidak-relevan", { slug: "tidak-relevan", nama: "Tidak Relevan", nama_en: "Irrelevant" });
  const references = [];
  const seen = new Set();
  for (const article of referenceArticles) {
    if (!trustedReference(article) || !byId.has(article.cluster_id)) continue;
    const title = clean(article.judul || article.title);
    const key = title.replace(/\b\d{2,4}\b/g, "").trim();
    if (!key || seen.has(`${article.cluster_id}:${key}`)) continue;
    seen.add(`${article.cluster_id}:${key}`);
    references.push({ id: article.cluster_id, title: String(article.judul || article.title || "").slice(0, 240), reason: String(article.editor_cluster_reason || "").slice(0, 360), reason_type: String(article.editor_cluster_reason_type || "").slice(0, 60), counts: tokenCounts(article) });
  }
  const documentFrequency = new Map();
  for (const reference of references) for (const term of reference.counts.keys()) documentFrequency.set(term, (documentFrequency.get(term) || 0) + 1);
  const idf = new Map([...documentFrequency].map(([term, count]) => [term, Math.log(1 + references.length / (1 + count))]));
  const vectorize = counts => {
    const vector = new Map(); let norm = 0;
    for (const [term, count] of counts) {
      const weight = (1 + Math.log(count)) * (idf.get(term) || 0);
      if (!weight) continue;
      vector.set(term, weight); norm += weight * weight;
    }
    return { vector, norm: Math.sqrt(norm) || 1 };
  };
  const vectors = references.map(reference => ({ ...reference, ...vectorize(reference.counts) }));
  return { byId, references, vectors, vectorize };
}

function titleBodyGate(article) {
  const context = contextOf(article);
  if (article.extraction_status !== "extracted" || context.length < 80) return false;
  const headline = titleTokens(article);
  if (headline.length < 2) return false;
  const bodyTerms = new Set(tokens(context));
  const matched = headline.filter(term => bodyTerms.has(term)).length;
  return matched / headline.length >= 0.30 || matched >= 2;
}

function rankByReferences(article, index) {
  if (!titleBodyGate(article) || !index.references.length) return [];
  const query = index.vectorize(tokenCounts(article));
  const scores = index.vectors.map(reference => {
    let dot = 0;
    for (const [term, weight] of query.vector) dot += weight * (reference.vector.get(term) || 0);
    return { id: reference.id, score: dot / (query.norm * reference.norm), title: reference.title, reason: reference.reason, reason_type: reference.reason_type };
  }).sort((a, b) => b.score - a.score);
  const clusterScores = new Map();
  for (const candidate of scores) {
    const list = clusterScores.get(candidate.id) || [];
    if (list.length < 3) list.push(candidate);
    clusterScores.set(candidate.id, list);
  }
  return [...clusterScores].map(([id, list]) => ({
    id,
    score: list.length >= 2 ? list[0].score * 0.65 + list[1].score * 0.35 : list[0].score * 0.75,
    support: list.length,
    examples: list.slice(0, 2).map(item => ({ title: item.title, reason: item.reason, reason_type: item.reason_type, similarity: Number(item.score.toFixed(3)) }))
  })).sort((a, b) => b.score - a.score);
}

function applyHistoricalReferenceClusters(articles, taxonomy, referenceArticles = articles) {
  const index = makeIndex(referenceArticles, taxonomy);
  const { byId, references } = index;
  if (references.length < 20) return { references: references.length, assigned: 0, suggested: 0 };
  let assigned = 0, suggested = 0;
  for (const article of articles) {
    if (article.cluster_assignment !== "unassigned" || article.extraction_status !== "extracted") continue;
    const ranked = rankByReferences(article, index);
    const best = ranked[0], runnerUp = ranked[1];
    if (!best) continue;
    const margin = best.score - (runnerUp?.score || 0);
    const cluster = byId.get(best.id);
    // Calibration against editor decisions is still too small and uneven to
    // justify automatic placement. Historical similarity is a ranked hint;
    // contextual review or an editor decision remains the assignment gate.
    if (best.score >= 0.18) {
      article.cluster_relevance_review = {
        ...(article.cluster_relevance_review || {}),
        suggested_cluster_id: cluster.slug,
        review_queue_status: "historical_reference_suggested",
        reason: `Referensi historis paling dekat adalah ${cluster.nama} (skor ${best.score.toFixed(2)}); perlu tinjauan editor sebelum dipindahkan.`,
        historical_reference: { score: Number(best.score.toFixed(3)), margin: Number(margin.toFixed(3)), support: best.support, references: references.length, examples: best.examples },
        reviewed_at: new Date().toISOString()
      };
      suggested++;
    }
  }
  return { references: references.length, assigned, suggested };
}

function calibrateHistoricalReferenceClusters(articles, taxonomy, referenceArticles = articles) {
  const editorLabels = referenceArticles.filter(article => article.cluster_assignment === "editor" && trustedReference(article));
  const outcomes = [];
  for (const heldOut of editorLabels) {
    const heldTitle = clean(heldOut.judul || heldOut.title).replace(/\b\d{2,4}\b/g, "").trim();
    const training = referenceArticles.filter(article => article !== heldOut
      && clean(article.judul || article.title).replace(/\b\d{2,4}\b/g, "").trim() !== heldTitle);
    const index = makeIndex(training, taxonomy);
    const ranked = rankByReferences(heldOut, index);
    const best = ranked[0];
    if (best) outcomes.push({ title: heldOut.judul || heldOut.title || "", truth: heldOut.cluster_id, ...best, margin: best.score - (ranked[1]?.score || 0) });
  }
  const thresholds = [0.18, 0.22, 0.26, 0.30, 0.34, 0.38, 0.42];
  const margins = [0.04, 0.06, 0.08, 0.10, 0.12];
  const report = [];
  for (const threshold of thresholds) for (const margin of margins) {
    const accepted = outcomes.filter(row => row.score >= threshold && row.margin >= margin && row.support >= 2
      && !taxonomy.find(cluster => cluster.slug === row.id)?.human_review_only);
    const correct = accepted.filter(row => row.truth === row.id).length;
    report.push({ threshold, margin, evaluated: outcomes.length, assigned: accepted.length,
      precision: accepted.length ? Number((correct / accepted.length).toFixed(3)) : null,
      coverage: outcomes.length ? Number((accepted.length / outcomes.length).toFixed(3)) : 0,
      correct, incorrect: accepted.length - correct });
  }
  return { editor_examples: editorLabels.length, eligible_examples: outcomes.length,
    no_prediction: editorLabels.length - outcomes.length, report: report.sort((a, b) => (b.precision ?? -1) - (a.precision ?? -1) || b.assigned - a.assigned), outcomes };
}

module.exports = { applyHistoricalReferenceClusters, calibrateHistoricalReferenceClusters };
