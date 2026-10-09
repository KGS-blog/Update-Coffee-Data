// Stable cluster IDs are part of the editor decision contract. Keep legacy
// spellings readable while allowing canonical IDs to replace them safely.
const CLUSTER_ID_ALIASES = Object.freeze({
  'pendidikan-industri': 'edukasi-industri'
});

function canonicalClusterId(value) {
  const id = String(value || '');
  return CLUSTER_ID_ALIASES[id] || id;
}

function decisionKey(item) {
  return String(item?.url || item?.tautan || '');
}

function decisionTime(item) {
  const value = Date.parse(item?.decided_at || '');
  return Number.isFinite(value) ? value : 0;
}

function normalizeDecision(item) {
  if (!item || typeof item !== 'object') return item;
  const id = item.cluster_id || item.klaster;
  if (!id) return { ...item };
  return { ...item, cluster_id: canonicalClusterId(id) };
}

// Merge the Blog mirror and this repository's snapshot by article URL. A
// newer explicit decision wins; ties and missing timestamps favor the local
// snapshot so a stale mirror cannot silently undo a recently reviewed fix.
function mergeDecisionOverrides(localOverrides, remoteOverrides) {
  const byUrl = new Map();
  for (const item of localOverrides || []) {
    const normalized = normalizeDecision(item);
    const key = decisionKey(normalized);
    if (key) byUrl.set(key, normalized);
  }
  for (const item of remoteOverrides || []) {
    const normalized = normalizeDecision(item);
    const key = decisionKey(normalized);
    if (!key) continue;
    const local = byUrl.get(key);
    if (!local || decisionTime(normalized) > decisionTime(local)) byUrl.set(key, normalized);
  }
  return [...byUrl.values()];
}

module.exports = { canonicalClusterId, normalizeDecision, mergeDecisionOverrides };
