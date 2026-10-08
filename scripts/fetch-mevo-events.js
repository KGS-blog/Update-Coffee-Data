const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const SOURCE = 'https://raw.githubusercontent.com/KGS-blog/coffee-feed/main/mevo_events.json';
const OUTPUT = path.join(ROOT, 'data', 'mevo-events-calendar.json');
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
    const events = payload.events.filter(event =>
      event && typeof event.id === 'string' && typeof event.name === 'string' &&
      DATE.test(event.start_date || '') && DATE.test(event.end_date || '') &&
      Date.parse(`${event.start_date}T00:00:00Z`) <= Date.parse(`${event.end_date}T00:00:00Z`) &&
      event.start_date <= yearEnd && event.end_date >= yearStart &&
      !/NEEDS_REVIEW|CANDIDATE/i.test(String(event.date_status || ''))
    ).map(event => ({
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

    if (events.length !== payload.events.length) {
      console.warn(`MEVO events: ${payload.events.length - events.length} invalid, under-review, or outside ${CALENDAR_YEAR}; excluded.`);
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
