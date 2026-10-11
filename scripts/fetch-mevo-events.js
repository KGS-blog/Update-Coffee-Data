const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const SOURCE = 'https://raw.githubusercontent.com/KGS-blog/coffee-feed/main/mevo_events.json';
const OUTPUT = path.join(ROOT, 'data', 'mevo-events-calendar.json');
const OVERRIDES = path.join(ROOT, 'data', 'mevo-event-overrides.json');
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const CALENDAR_YEAR = 2026;
const yearStart = `${CALENDAR_YEAR}-01-01`;
const yearEnd = `${CALENDAR_YEAR}-12-31`;
const isHttpsUrl = value => {
  try { return new URL(String(value || '')).protocol === 'https:'; } catch (_) { return false; }
};

async function main() {
  try {
    const response = await fetch(SOURCE, { signal: AbortSignal.timeout(20000) });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const payload = await response.json();
    if (!payload || !Array.isArray(payload.events)) throw new Error('Payload tidak memiliki array events.');

    // Deliberately read only `events`; the separate `candidates` queue is not copied or rendered.
    // Reviewed local additions survive upstream refreshes. An override may also
    // replace one upstream record by ID when better research clarifies its identity.
    const overridePayload = fs.existsSync(OVERRIDES)
      ? JSON.parse(fs.readFileSync(OVERRIDES, 'utf8'))
      : {};
    const reviewedOverrides = Array.isArray(overridePayload.events) ? overridePayload.events : [];
    const replacements = new Map(reviewedOverrides
      .filter(event => typeof event.supersedes_id === 'string')
      .map(event => [event.supersedes_id, event]));
    const sourceEvents = [
      ...payload.events.map(event => {
        const replacement = replacements.get(event?.id);
        return replacement ? { ...event, ...replacement, id: event.id } : event;
      }),
      ...reviewedOverrides.filter(event => !event.supersedes_id)
    ];
    const seenEventKeys = new Set();
    const events = sourceEvents.filter(event =>
      event && typeof event.id === 'string' && typeof event.name === 'string' &&
      DATE.test(event.start_date || '') && DATE.test(event.end_date || '') &&
      Date.parse(`${event.start_date}T00:00:00Z`) <= Date.parse(`${event.end_date}T00:00:00Z`) &&
      event.start_date <= yearEnd && event.end_date >= yearStart &&
      !/NEEDS_REVIEW|CANDIDATE/i.test(String(event.date_status || ''))
    ).filter(event => {
      const key = `${String(event.name).normalize('NFKD').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()}|${event.start_date}|${event.end_date}`;
      if (seenEventKeys.has(key)) return false;
      seenEventKeys.add(key);
      return true;
    }).map(event => ({
      id: event.id,
      name: event.name,
      start_date: event.start_date,
      end_date: event.end_date,
      location: String(event.location || ''),
      country: String(event.country || ''),
      organizer: String(event.organizer || ''),
      category: String(event.category || ''),
      date_status: String(event.date_status || ''),
      note: String(event.note || ''),
      sources: (Array.isArray(event.sources) ? event.sources : [])
        .filter(source => isHttpsUrl(source?.url))
        .map(source => ({ url: source.url, kind: String(source.kind || 'source') }))
    }));

    if (events.length !== sourceEvents.length) {
      console.warn(`MEVO events: ${sourceEvents.length - events.length} invalid, under-review, outside ${CALENDAR_YEAR}, or duplicate; excluded.`);
    }
    fs.mkdirSync(path.dirname(OUTPUT), { recursive: true });
    fs.writeFileSync(OUTPUT, `${JSON.stringify({
      schema: 'kabar-kopi-events-calendar-v1',
      source: SOURCE,
      timezone: String(payload.timezone || 'Asia/Jakarta'),
      fetched_at: new Date().toISOString(),
      events
    }, null, 2)}\n`);
    console.log(`Saved ${events.length} approved events. Candidate records were ignored.`);
  } catch (error) {
    if (!fs.existsSync(OUTPUT)) {
      fs.mkdirSync(path.dirname(OUTPUT), { recursive: true });
      fs.writeFileSync(OUTPUT, `${JSON.stringify({ schema: 'kabar-kopi-events-calendar-v1', source: SOURCE, timezone: 'Asia/Jakarta', fetched_at: '', events: [] }, null, 2)}\n`);
    }
    console.warn(`MEVO event refresh skipped: ${error.message}. Existing event snapshot retained.`);
  }
}

main();
