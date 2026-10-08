const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const DATA_PATH = path.join(ROOT, 'data', 'mevo-events-calendar.json');
const SITE = 'https://kabarkopi.qcoid.com';
const CALENDAR_YEAR = 2026;
const snapshot = fs.existsSync(DATA_PATH) ? JSON.parse(fs.readFileSync(DATA_PATH, 'utf8')) : { events: [], timezone: 'Asia/Jakarta' };
const events = Array.isArray(snapshot.events) ? snapshot.events : [];
const timezone = snapshot.timezone || 'Asia/Jakarta';
const today = new Date().toLocaleDateString('en-CA', { timeZone: timezone });
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]));
const valid = event => event && typeof event.name === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(event.start_date || '') && /^\d{4}-\d{2}-\d{2}$/.test(event.end_date || '') && !/NEEDS_REVIEW|CANDIDATE/i.test(String(event.date_status || ''));
const dateLabel = (value, locale) => new Intl.DateTimeFormat(locale, { day:'numeric', month:'long', year:'numeric', timeZone:timezone }).format(new Date(`${value}T12:00:00`));
const dateRange = (event, locale) => event.start_date === event.end_date ? dateLabel(event.start_date, locale) : `${dateLabel(event.start_date, locale)} – ${dateLabel(event.end_date, locale)}`;
const eventState = event => event.end_date < today ? 'past' : event.start_date <= today ? 'live' : 'upcoming';
const stateLabel = (event, lang) => {
  const state = eventState(event);
  return lang === 'en' ? ({ past:'Completed', live:'Happening now', upcoming:'Upcoming' }[state]) : ({ past:'Selesai', live:'Sedang berlangsung', upcoming:'Akan datang' }[state]);
};
const eventUrl = event => (Array.isArray(event.sources) ? event.sources : []).find(source => /^https:\/\//i.test(source.url || ''))?.url || '';
const sortedEvents = events.filter(event => valid(event) && event.start_date <= `${CALENDAR_YEAR}-12-31` && event.end_date >= `${CALENDAR_YEAR}-01-01`)
  .sort((a,b) => a.start_date.localeCompare(b.start_date) || a.name.localeCompare(b.name));
const upcomingEvents = sortedEvents.filter(event => eventState(event) !== 'past');
const completedEvents = sortedEvents.filter(event => eventState(event) === 'past');
function card(event, lang, compact = false) {
  const url = eventUrl(event);
  const date = dateRange(event, lang === 'en' ? 'en-GB' : 'id-ID');
  const sourceLabel = event.sources?.[0]?.kind === 'official'
    ? (lang === 'en' ? 'Official source' : 'Sumber resmi')
    : (lang === 'en' ? 'Source' : 'Sumber');
  return `<article class="coffee-event-card${compact ? ' compact' : ''}"><div class="coffee-event-date">${esc(date)}</div><div class="coffee-event-body"><div class="coffee-event-status ${eventState(event)}">${esc(stateLabel(event, lang))}</div><h3>${url ? `<a href="${esc(url)}" target="_blank" rel="noopener noreferrer">${esc(event.name)}</a>` : esc(event.name)}</h3><p class="coffee-event-meta">${esc([event.category, event.location, event.country].filter(Boolean).join(' · '))}</p>${event.organizer ? `<p class="coffee-event-organizer"><strong>${lang === 'en' ? 'Organizer:' : 'Penyelenggara:'}</strong> ${esc(event.organizer)}</p>` : ''}${event.note ? `<p class="coffee-event-note">${esc(event.note)}</p>` : ''}${url ? `<a class="coffee-event-source" href="${esc(url)}" target="_blank" rel="noopener noreferrer">${sourceLabel} →</a>` : ''}</div></article>`;
}
function render(lang, compact) {
  const empty = lang === 'en' ? `No upcoming ${CALENDAR_YEAR} coffee events are listed yet.` : `Belum ada event kopi mendatang untuk ${CALENDAR_YEAR}.`;
  if (compact) {
    const list = upcomingEvents.slice(0, 2);
    return list.length
      ? `<h3 class="coffee-events-group-title">${lang === 'en' ? `Upcoming · ${CALENDAR_YEAR}` : `Akan datang · ${CALENDAR_YEAR}`}</h3>${list.map(event => card(event, lang, true)).join('')}`
      : `<p class="coffee-events-empty">${esc(empty)}</p>`;
  }
  const upcomingTitle = lang === 'en' ? `Upcoming · ${CALENDAR_YEAR}` : `Akan datang · ${CALENDAR_YEAR}`;
  const completedTitle = lang === 'en' ? `Completed · ${CALENDAR_YEAR}` : `Selesai · ${CALENDAR_YEAR}`;
  const upcoming = upcomingEvents.length ? upcomingEvents.map(event => card(event, lang)).join('') : `<p class="coffee-events-empty">${esc(empty)}</p>`;
  const completed = completedEvents.length ? completedEvents.map(event => card(event, lang)).join('') : `<p class="coffee-events-empty">${lang === 'en' ? `No completed events for ${CALENDAR_YEAR} yet.` : `Belum ada event yang selesai pada ${CALENDAR_YEAR}.`}</p>`;
  return `<section class="coffee-events-group" aria-labelledby="coffee-events-upcoming"><h2 id="coffee-events-upcoming" class="coffee-events-group-title">${upcomingTitle}</h2>${upcoming}</section><section class="coffee-events-group completed" aria-labelledby="coffee-events-completed"><h2 id="coffee-events-completed" class="coffee-events-group-title">${completedTitle}</h2>${completed}</section>`;
}

function renderSeoPage(lang) {
  const en = lang === 'en';
  const pagePath = en ? '/en/coffee-events-calendar/' : '/kalender-event-kopi/';
  const canonical = `${SITE}${pagePath}`;
  const opposite = `${SITE}${en ? '/kalender-event-kopi/' : '/en/coffee-events-calendar/'}`;
  const title = en ? `Coffee Events Calendar Indonesia ${CALENDAR_YEAR}` : `Kalender Event Kopi Indonesia ${CALENDAR_YEAR}`;
  const description = en
    ? `Find ${CALENDAR_YEAR} coffee expos, festivals, competitions, and industry events in Indonesia with published dates, locations, organizers, and source links.`
    : `Temukan pameran, festival, kompetisi, dan agenda industri kopi Indonesia ${CALENDAR_YEAR} beserta tanggal, lokasi, penyelenggara, dan tautan sumber.`;
  const locale = en ? 'en-GB' : 'id-ID';
  const pageEvents = sortedEvents.map((event, index) => {
    const source = eventUrl(event);
    const location = [event.location, event.country].filter(Boolean).join(', ');
    const schema = {
      '@type': 'Event',
      name: event.name,
      startDate: event.start_date,
      endDate: event.end_date,
      inLanguage: en ? 'en' : 'id',
      organizer: event.organizer ? { '@type': 'Organization', name: event.organizer } : undefined,
      location: location ? { '@type': 'Place', name: location, address: { '@type': 'PostalAddress', addressCountry: event.country || undefined } } : undefined,
      url: source || undefined,
      eventStatus: eventState(event) === 'past' ? undefined : 'https://schema.org/EventScheduled'
    };
    Object.keys(schema).forEach(key => schema[key] === undefined && delete schema[key]);
    return { event, source, schema, index };
  });
  const renderSeoCard = ({ event, source }) => {
    const state = eventState(event);
    const stateText = stateLabel(event, lang);
    return `<article class="event"><div class="date"><time datetime="${esc(event.start_date)}">${esc(dateRange(event, locale))}</time><span class="status ${state}">${esc(stateText)}</span></div><div><h2>${source ? `<a href="${esc(source)}" rel="noopener noreferrer">${esc(event.name)}</a>` : esc(event.name)}</h2><p class="meta">${esc([event.category, event.location, event.country].filter(Boolean).join(' · '))}</p>${event.organizer ? `<p>${en ? 'Organizer' : 'Penyelenggara'}: ${esc(event.organizer)}</p>` : ''}${event.note ? `<p>${esc(event.note)}</p>` : ''}${source ? `<p><a href="${esc(source)}" rel="noopener noreferrer">${en ? 'Check event source' : 'Periksa sumber acara'} →</a></p>` : ''}</div></article>`;
  };
  const renderSeoGroup = (items, heading, empty) => `<section aria-label="${esc(heading)}"><h2>${esc(heading)}</h2>${items.length ? items.map(renderSeoCard).join('') : `<p>${esc(empty)}</p>`}</section>`;
  const upcomingCards = pageEvents.filter(item => eventState(item.event) !== 'past');
  const completedCards = pageEvents.filter(item => eventState(item.event) === 'past');
  const cards = `${renderSeoGroup(upcomingCards, en ? `Upcoming · ${CALENDAR_YEAR}` : `Akan datang · ${CALENDAR_YEAR}`, en ? `No upcoming events for ${CALENDAR_YEAR}.` : `Belum ada event mendatang pada ${CALENDAR_YEAR}.`)}${renderSeoGroup(completedCards, en ? `Completed · ${CALENDAR_YEAR}` : `Selesai · ${CALENDAR_YEAR}`, en ? `No completed events for ${CALENDAR_YEAR}.` : `Belum ada event yang selesai pada ${CALENDAR_YEAR}.`)}`;
  const schemas = pageEvents.map(item => ({ '@type': 'ListItem', position: item.index + 1, item: item.schema }));
  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'CollectionPage',
    name: title,
    description,
    url: canonical,
    inLanguage: lang,
    isPartOf: { '@type': 'WebSite', name: 'Kabar Kopi', url: `${SITE}/` },
    mainEntity: { '@type': 'ItemList', itemListElement: schemas }
  };
  const body = `<main class="wrap"><p class="eyebrow">${en ? `Coffee industry agenda · ${CALENDAR_YEAR}` : `Agenda industri kopi · ${CALENDAR_YEAR}`}</p><h1>${title}</h1><p class="intro">${description}</p><p class="note">${en ? `This calendar shows reviewed ${CALENDAR_YEAR} events from MEVO’s events feed. Candidate entries awaiting review are not published. Dates and details follow the linked sources.` : `Kalender ini menampilkan acara ${CALENDAR_YEAR} yang sudah diperiksa dari bagian events di feed MEVO. Kandidat yang masih menunggu pemeriksaan tidak diterbitkan. Tanggal dan detail mengikuti sumber yang ditautkan.`}</p>${cards}<p class="back"><a href="${SITE}/">${en ? 'Back to Kabar Kopi home' : 'Kembali ke beranda Kabar Kopi'} →</a></p></main>`;
  const nav = en ? [['Coffee prices','/en/coffee-prices/'],['Market data','/en/coffee-market-data/'],['Export requirements','/en/export-coffee-requirements/']] : [['Harga kopi','/harga-kopi/'],['Data pasar','/data-tren-kopi/'],['Syarat ekspor','/persyaratan-ekspor-kopi/']];
  return `<!doctype html><html lang="${lang}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)} | Kabar Kopi</title><meta name="description" content="${esc(description)}"><link rel="canonical" href="${canonical}"><link rel="alternate" hreflang="id" href="${SITE}/kalender-event-kopi/"><link rel="alternate" hreflang="en" href="${SITE}/en/coffee-events-calendar/"><link rel="alternate" hreflang="x-default" href="${SITE}/kalender-event-kopi/"><meta property="og:type" content="website"><meta property="og:site_name" content="Kabar Kopi"><meta property="og:title" content="${esc(title)}"><meta property="og:description" content="${esc(description)}"><meta property="og:url" content="${canonical}"><meta name="twitter:card" content="summary"><script type="application/ld+json">${JSON.stringify(jsonLd).replace(/</g, '\\u003c')}</script><style>*{box-sizing:border-box}body{margin:0;background:#fbfaf7;color:#25231f;font:16px/1.7 system-ui,-apple-system,"Segoe UI",sans-serif}.wrap{width:min(1080px,calc(100% - 36px));margin:auto}header{padding:20px 0;border-bottom:1px solid #e7e1d8}header a{font:700 25px Georgia,serif;color:#25231f;text-decoration:none}.nav{display:flex;gap:18px;flex-wrap:wrap;padding:12px 0}.nav a{font-size:13px;font-weight:700;color:#62432e;text-decoration:none}h1,h2{font-family:Georgia,"Times New Roman",serif;line-height:1.2}h1{font-size:clamp(34px,5vw,54px);margin:8px 0 12px}h2{font-size:24px;margin:0 0 5px}.eyebrow{color:#a9472d;font-size:12px;font-weight:800;letter-spacing:.12em;text-transform:uppercase;margin-top:36px}.intro{max-width:850px;color:#57524c;font-size:19px}.note{padding:14px 16px;background:#f2ede5;border-left:3px solid #a9472d;color:#514b44}.event{display:grid;grid-template-columns:190px 1fr;gap:20px;padding:22px 0;border-bottom:1px solid #e7e1d8}.date{font-weight:700;color:#62432e}.status{display:block;margin-top:6px;color:#a9472d;font-size:12px;text-transform:uppercase;letter-spacing:.08em}.status.past{color:#746f68}.status.live{color:#34683e}.event p{margin:5px 0;color:#57524c}.meta{font-size:14px;color:#746f68}.event a,.back a{color:#8f3d27}.back{padding:24px 0 50px;font-weight:700}@media(max-width:600px){.event{grid-template-columns:1fr;gap:8px}.wrap{width:calc(100% - 28px)}}</style></head><body><header class="wrap"><a href="${SITE}/">Kabar Kopi</a></header><nav class="wrap nav" aria-label="${en ? 'Coffee topics' : 'Topik kopi'}">${nav.map(([label, href]) => `<a href="${SITE}${href}">${label}</a>`).join('')}<a href="${opposite}">${en ? 'Bahasa Indonesia' : 'English'}</a></nav>${body}</body></html>`;
}

const targets = ['index.html', 'kabar-kopi.html'];
function replaceContainerContents(html, id, content, closingContext) {
  const open = `<div id="${id}">`;
  const openAt = html.indexOf(open);
  if (openAt < 0) return html;
  const contentAt = openAt + open.length;
  const contextAt = html.indexOf(closingContext, contentAt);
  if (contextAt < 0) return html;
  const closeAt = id === 'coffee-events-home'
    ? html.lastIndexOf('</div>', contextAt)
    : contextAt;
  if (closeAt < contentAt) return html;
  return `${html.slice(0, contentAt)}${content}${html.slice(closeAt)}`;
}
for (const file of targets) {
  const target = path.join(ROOT, file);
  if (!fs.existsSync(target)) continue;
  let html = fs.readFileSync(target, 'utf8');
  const homeContent = `<div class="coffee-events-preview-grid"><div class="coffee-events-language id-copy">${render('id', true)}</div><div class="coffee-events-language en-copy">${render('en', true)}</div></div>`;
  const tabContent = `<div class="coffee-events-list"><div class="coffee-events-language id-copy">${render('id', false)}</div><div class="coffee-events-language en-copy">${render('en', false)}</div></div><p class="coffee-events-source-note"><span class="id-copy">Kalender ini hanya memakai bagian events dari feed MEVO. Kandidat acara masih menunggu pemeriksaan dan tidak ditampilkan. Tanggal dan detail mengikuti sumber yang ditautkan.</span><span class="en-copy">This calendar uses only the events section of the MEVO feed. Event candidates remain under review and are not displayed. Dates and details follow the linked sources.</span></p>`;
  html = replaceContainerContents(html, 'coffee-events-home', homeContent, '<button class="coffee-events-open"');
  html = replaceContainerContents(html, 'coffee-events-full', tabContent, '</div></div></section>');
  html = html.replace('<!-- SEO_COFFEE_EVENTS_LINK -->', `<span class="id-copy"><a href="/kalender-event-kopi/">Buka halaman kalender event kopi →</a></span><span class="en-copy"><a href="/en/coffee-events-calendar/">Open the coffee events calendar page →</a></span>`);
  fs.writeFileSync(target, html);
}

for (const [lang, route] of [['id', 'kalender-event-kopi'], ['en', 'en/coffee-events-calendar']]) {
  const output = path.join(ROOT, route, 'index.html');
  fs.mkdirSync(path.dirname(output), { recursive: true });
  fs.writeFileSync(output, renderSeoPage(lang));
}

// Add the bilingual calendar landing pages after sitemap-generating steps have run.
const sitemapPath = path.join(ROOT, 'sitemap.xml');
if (fs.existsSync(sitemapPath)) {
  let sitemap = fs.readFileSync(sitemapPath, 'utf8');
  const lastmod = new Date().toISOString().slice(0, 10);
  for (const route of ['/kalender-event-kopi/', '/en/coffee-events-calendar/']) {
    const url = `${SITE}${route}`;
    if (!sitemap.includes(`<loc>${url}</loc>`)) sitemap = sitemap.replace('</urlset>', `  <url><loc>${url}</loc><lastmod>${lastmod}</lastmod></url>\n</urlset>`);
  }
  fs.writeFileSync(sitemapPath, sitemap);
}

console.log(`Rendered ${sortedEvents.length} reviewed coffee events; candidates ignored.`);
