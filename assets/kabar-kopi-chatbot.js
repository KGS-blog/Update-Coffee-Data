(() => {
  'use strict';
  if (document.getElementById('kk-guide-launcher')) return;

  const pages = {
    id: [
      ['/', 'Beranda dan fitur Kabar Kopi'],
      ['/persyaratan-ekspor-kopi/', 'Panduan persyaratan ekspor kopi'],
      ['/kalkulator-kopi/', 'Kalkulator kopi dan quotation'],
      ['/data-tren-kopi/', 'Data dan tren industri kopi'],
      ['/harga-kopi/', 'Tracking harga kopi'],
      ['/analisis-report-kopi/', 'Analisis editorial dan Report MEVO'],
      ['/berita-kopi/', 'Berita kopi'],
      ['/tentang-kabar-kopi.html', 'Tentang, metode, dan kebijakan Kabar Kopi']
    ],
    en: [
      ['/kabar-kopi.html?lang=en#beranda', 'Kabar Kopi home and features'],
      ['/en/export-coffee-requirements/', 'Coffee export requirements guide'],
      ['/en/coffee-export-calculator/', 'Coffee calculator and quotation'],
      ['/en/coffee-market-data/', 'Coffee market data and trends'],
      ['/en/coffee-prices/', 'Coffee price tracking'],
      ['/en/coffee-analysis-reports/', 'Editorial analysis and MEVO reports'],
      ['/en/coffee-news/', 'Coffee news'],
      ['/tentang-kabar-kopi.html', 'About, methods, and Kabar Kopi policies']
    ]
  };
  const DATA = '/data/';
  const TODAY = new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Jakarta',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
  const stop = new Set(('yang dan atau dari untuk dengan pada dalam adalah ini itu apa bagaimana dimana kapan kenapa apakah bisa kah ke di dari the and or for with about what how where when why can is are does do this that into from your our coffee kopi kabar kabar kopi').split(/\s+/));
  const normalize = value => (value || '').toLocaleLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
  const tokens = value => normalize(value).split(/\s+/).filter(word => word.length > 2 && !stop.has(word));
  let corpus = [];
  let indexedLanguage = '';
  let indexing = null;

  const button = document.createElement('button');
  button.id = 'kk-guide-launcher'; button.type = 'button'; button.setAttribute('aria-haspopup', 'dialog');
  const dialog = document.createElement('dialog'); dialog.id = 'kk-guide-dialog'; dialog.setAttribute('aria-labelledby', 'kk-guide-title');
  const langNow = () => (document.documentElement.lang || '').toLowerCase().startsWith('en') || new URLSearchParams(location.search).get('lang') === 'en' ? 'en' : 'id';
  const copy = {
    id: { launch:'Tanya Kabar Kopi', title:'Tanya Kabar Kopi', sub:'Cari harga, event, pelatihan, dan data ekspor—dengan sumber dan tanggal.', close:'Tutup', placeholder:'Contoh: harga Arabika terbaru, event kopi bulan depan…', send:'Tanya', examples:['Berapa harga Arabika dan Robusta terbaru?','Event kopi apa yang akan datang?','Di mana ada pelatihan barista?','Berapa ekspor kopi Indonesia terbaru?'], loading:'Mencari data dan sumber…', ready:'Jawaban berdasarkan data situs yang tersedia.', none:'Belum ada jawaban yang cocok. Coba kata “harga”, “event”, “pelatihan”, atau “ekspor”.', error:'Data belum berhasil dimuat. Periksa koneksi lalu coba lagi.', privacy:'Pencarian berjalan di browser ini. Pertanyaan tidak dikirim ke layanan AI dan tidak disimpan.', source:'Buka sumber →', disclaimer:'Jawaban memakai data Kabar Kopi dan pencarian halaman. Tanggal sumber ditampilkan; cek sumber asli untuk konfirmasi terbaru.' },
    en: { launch:'Ask Kabar Kopi', title:'Ask Kabar Kopi', sub:'Find coffee prices, events, training, and export data—with sources and dates.', close:'Close', placeholder:'Example: latest Arabica price, coffee events next month…', send:'Ask', examples:['What are the latest Arabica and Robusta prices?','What coffee events are coming up?','Where can I find barista training?','What are Indonesia’s latest coffee exports?'], loading:'Searching data and sources…', ready:'Answers use the available site data.', none:'No matching answer yet. Try “price”, “event”, “training”, or “export”.', error:'Data could not be loaded. Check your connection and try again.', privacy:'Search runs in this browser. Your question is not sent to an AI service and is not stored.', source:'Open source →', disclaimer:'Answers use Kabar Kopi data and page search. Source dates are shown; check the original source for the latest confirmation.' }
  };
  const safe = text => { const node = document.createElement('span'); node.textContent = text; return node.innerHTML; };
  const renderShell = () => {
    const t = copy[langNow()]; button.textContent = t.launch; button.setAttribute('aria-label', t.launch);
    dialog.innerHTML = `<div class="kk-guide-head"><div><h2 id="kk-guide-title">${safe(t.title)}</h2><p>${safe(t.sub)}</p></div><button id="kk-guide-close" type="button">${safe(t.close)}</button></div><div class="kk-guide-body"><form class="kk-guide-form"><input name="q" type="search" autocomplete="off" required aria-label="${safe(t.placeholder)}" placeholder="${safe(t.placeholder)}"><button>${safe(t.send)}</button></form><div class="kk-guide-examples">${t.examples.map(example => `<button class="kk-guide-example" type="button">${safe(example)}</button>`).join('')}</div><p id="kk-guide-status" aria-live="polite">${safe(t.disclaimer)}</p><div id="kk-guide-results" aria-live="polite"></div><p class="kk-guide-privacy">${safe(t.privacy)}</p></div>`;
    dialog.querySelector('#kk-guide-close').addEventListener('click', () => dialog.close());
    dialog.querySelectorAll('.kk-guide-example').forEach(chip => chip.addEventListener('click', () => { const input=dialog.querySelector('[name=q]'); input.value=chip.textContent; answer(input.value); }));
    dialog.querySelector('.kk-guide-form').addEventListener('submit', event => { event.preventDefault(); answer(new FormData(event.currentTarget).get('q')); });
  };
  let datasetsPromise;
  const loadDatasets = () => datasetsPromise || (datasetsPromise = Promise.all([
    fetch(`${DATA}market-data.json`, {cache:'no-store'}).then(r=>r.ok?r.json():null).catch(()=>null),
    fetch(`${DATA}public-price-supplement.json`, {cache:'no-store'}).then(r=>r.ok?r.json():null).catch(()=>null),
    fetch(`${DATA}mevo-events-calendar.json`, {cache:'no-store'}).then(r=>r.ok?r.json():null).catch(()=>null),
    fetch(`${DATA}lembaga-pelatihan-kopi.json`, {cache:'no-store'}).then(r=>r.ok?r.json():null).catch(()=>null),
    fetch(`${DATA}ekspor.json`, {cache:'no-store'}).then(r=>r.ok?r.json():null).catch(()=>null)
  ]).then(([prices,priceListings,events,training,exports])=>({prices,priceListings,events,training,exports})));
  const formatNumber = (n, digits=2) => Number(n).toLocaleString(langNow()==='en'?'en-US':'id-ID',{maximumFractionDigits:digits});
  const formatDate = value => { if(!value) return langNow()==='en'?'date unavailable':'tanggal tidak tersedia'; if(/^\d{4}-\d{2}$/.test(value)) return new Date(`${value}-01T00:00:00`).toLocaleDateString(langNow()==='en'?'en-US':'id-ID',{month:'long',year:'numeric'}); const d=new Date(`${value.slice(0,10)}T00:00:00`); return Number.isNaN(d.getTime())?value:d.toLocaleDateString(langNow()==='en'?'en-US':'id-ID',{day:'numeric',month:'long',year:'numeric'}); };
  const sourceLink = (url,label,date) => `<div class="kk-guide-citation"><a href="${safe(url)}" target="_blank" rel="noopener noreferrer">${safe(label||copy[langNow()].source)}</a><span>${langNow()==='en'?'Source date':'Tanggal sumber'}: ${safe(formatDate(date))}</span></div>`;
  const structuredAnswer = async query => {
    const q=normalize(query), en=langNow()==='en', data=await loadDatasets(), items=[];
    const add=(title,text,url,label,date,dateLabel)=>items.push({title,text,url,label,date,dateLabel});
    if(/harga|price|arabika|arabica|robusta|kurs|exchange/.test(q)){
      const p=data.prices;
      if(p){const when=p.meta?.lastUpdated?.slice(0,10); if(p.arabica?.current!=null)add(en?'Arabica C-Market reference':'Harga acuan Arabika C-Market',`${formatNumber(p.arabica.current)} ${p.arabica.unit} (${p.arabica.symbol}); ${en?'change':'perubahan'} ${formatNumber(p.arabica.change,2)} ${p.arabica.unit}. ${en?'This is an exchange reference, not a farmgate or retail price.':'Ini harga acuan bursa, bukan harga di tingkat petani atau harga eceran.'}`, 'https://finance.yahoo.com/quote/KC=F/history/', 'Yahoo Finance · KC=F',when,en?'Data updated':'Data diperbarui');
        if(p.robusta?.sourceValue!=null)add(en?'ICO Robusta daily indicator':'Indikator harian Robusta ICO',`${formatNumber(p.robusta.sourceValue)} ${p.robusta.sourceUnit} (${en?'source observation':'angka sumber'}); equivalent ${formatNumber(p.robusta.current,0)} ${p.robusta.unit}. ${en?'Not an ICE futures quote.':'Bukan kuotasi kontrak berjangka ICE.'}`,p.robusta.sourceUrl||'https://www.ico.org/resources/public-market-information/','International Coffee Organization (ICO)',p.robusta.sourceDate,en?'Observation date':'Tanggal observasi');
        if(p.idrUsd?.current!=null)add(en?'USD/IDR reference exchange rate':'Kurs acuan USD/IDR',`${formatNumber(p.idrUsd.current,0)} ${p.idrUsd.unit}.`, 'https://finance.yahoo.com/quote/IDR=X/history/','Yahoo Finance · IDR=X',when,en?'Data updated':'Data diperbarui');
      }
      const listings=data.priceListings?.listings||[], terms=tokens(query), matching=listings.filter(x=>!terms.some(t=>/arabika|arabica|robusta|green|mentah|sangrai|roasted|bubuk|gayo|flores|toraja/.test(t))||terms.some(t=>normalize([x.type,x.form,x.origin,x.product,x.process].join(' ')).includes(t))).sort((a,b)=>String(b.date||'').localeCompare(String(a.date||''))).slice(0,4);
      matching.forEach(x=>add(`${x.type|| (en?'Coffee':'Kopi')} · ${x.form|| (en?'form not specified':'bentuk tidak disebut')}`,`Rp ${formatNumber(x.price_per_kg,0)}/kg${x.origin?' · '+x.origin:''}${x.product?'\n'+x.product:''}\n${en?'Observed listing; prices vary by grade, origin, seller, and market level.':'Harga listing yang diamati; harga berbeda menurut mutu, asal, penjual, dan tingkat pasar.'}`,x.source_url||x.product_url||'/harga-kopi/',x.source||'Kabar Kopi · Listing harga',x.date,en?'Observed':'Tanggal pengamatan'));
    }
    if(/event|acara|festival|pameran|jadwal|kompetisi|competition/.test(q)){
      const dataEvents=data.events?.events||[], upcoming=dataEvents.filter(e=>e.end_date>=TODAY&&e.start_date).sort((a,b)=>a.start_date.localeCompare(b.start_date)).slice(0,6);
      upcoming.forEach(e=>{const src=(e.sources||[]).find(s=>/official|organizer|ticket/i.test(s.kind))||(e.sources||[])[0];const url=src?.url||'/kalender-event-kopi/';add(e.name,`${formatDate(e.start_date)}${e.end_date&&e.end_date!==e.start_date?' – '+formatDate(e.end_date):''} · ${e.location|| (en?'location not listed':'lokasi belum tercatat')}${e.organizer?' · '+e.organizer:''}${e.note?'\n'+e.note:''}`,url,src?.kind|| (en?'Event listing':'Data kalender event'),data.events?.fetched_at?.slice(0,10),en?'Calendar updated':'Kalender diperbarui');});
      if(!upcoming.length)add(en?'Upcoming coffee events':'Event kopi mendatang',en?'No upcoming event is currently listed. Check the calendar page for updates.':'Belum ada event mendatang yang tercatat. Cek halaman kalender untuk pembaruan.','/kalender-event-kopi/','Kabar Kopi · Kalender event',data.events?.fetched_at?.slice(0,10),en?'Calendar updated':'Kalender diperbarui');
    }
    if(/pelatihan|training|barista|kursus|kelas|cupping|roasting/.test(q)){
      const all=data.training?.items||[], terms=tokens(query).filter(t=>!['pelatihan','training','barista','kursus','kelas'].includes(t));
      const matches=all.filter(x=>!terms.length||terms.some(t=>normalize([x.name,x.location,...(x.focus||[]),x.certificate].join(' ')).includes(t))).slice(0,6);
      matches.forEach(x=>add(x.name,`${x.location||''}${x.focus?.length?' · '+x.focus.join(', '):''}${x.contact?'\n'+(en?'Contact':'Kontak')+': '+x.contact:''}${x.note?'\n'+x.note:''}`,x.url||'/lembaga-pelatihan-kopi/','Kabar Kopi · Direktori pelatihan',data.training?.updated,en?'Directory updated':'Direktori diperbarui'));
      if(!matches.length)add(en?'Coffee training directory':'Direktori pelatihan kopi',en?'No matching provider found. Browse the directory and confirm schedules, fees, and certification directly with the provider.':'Belum ditemukan penyedia yang cocok. Lihat direktori dan konfirmasi jadwal, biaya, serta sertifikasi langsung kepada penyelenggara.','/lembaga-pelatihan-kopi/','Kabar Kopi · Direktori pelatihan',data.training?.updated,en?'Directory updated':'Direktori diperbarui');
    }
    if(/ekspor|export|bps|hs code|perdagangan/.test(q)){
      const records=data.exports?.data||[], year=Math.max(0,...records.filter(x=>x.trade_flow==='export').map(x=>Number(x.year)||0));
      const green=records.filter(x=>x.trade_flow==='export'&&Number(x.year)===year&&/^09011[12]/.test(String(x.hs_code)));
      if(green.length){const volume=green.reduce((a,x)=>a+(Number(x.volume)||0),0),value=green.reduce((a,x)=>a+(Number(x.value_usd)||0),0);const first=green[0];add(en?`Indonesia coffee exports · ${year}`:`Ekspor kopi Indonesia · ${year}`,`${formatNumber(volume,0)} ${first.volume_unit||'ton'}${value?` · US$ ${formatNumber(value,0)}`:''}. ${en?'Sum of the green coffee HS codes shown in this BPS extract; this is not total coffee-related trade.':'Jumlah kode HS kopi biji hijau yang tercatat pada cuplikan BPS ini; bukan seluruh perdagangan terkait kopi.'}`,first.publication_url||'/data-tren-kopi/','BPS · '+(first.table?'Tabel '+first.table:'Perdagangan kopi'),first.publication_revised_at||data.exports?.fetched?.slice(0,10),en?'Publication revised':'Publikasi direvisi');}
      else add(en?'Indonesia coffee export data':'Data ekspor kopi Indonesia',en?'The export dataset is currently unavailable or contains no matching green coffee rows.':'Dataset ekspor sedang tidak tersedia atau belum memiliki baris kopi biji hijau yang cocok.','/data-tren-kopi/','Kabar Kopi · Data & Tren',data.exports?.fetched?.slice(0,10),en?'Data refreshed':'Data diperbarui');
    }
    return items;
  };
  const extract = (html, url, fallbackTitle) => {
    const parsed = new DOMParser().parseFromString(html, 'text/html');
    const root = parsed.querySelector('main') || parsed.body;
    root.querySelectorAll('script,style,nav,header,footer,noscript,button,input,select,textarea,form,[aria-hidden="true"]').forEach(node => node.remove());
    const canonical = parsed.querySelector('link[rel="canonical"]')?.href || url;
    const mainTitle = root.querySelector('h1')?.textContent.trim() || parsed.title || fallbackTitle;
    const headings = [...root.querySelectorAll('h1,h2,h3,h4')];
    if (!headings.length) {
      const text = root.innerText.replace(/\s+/g,' ').trim();
      if (text) corpus.push({title:mainTitle, text:text.slice(0,3500), url:canonical});
      return;
    }
    for (let i=0; i<headings.length; i++) {
      const heading=headings[i], parts=[];
      let node=heading.nextElementSibling;
      while(node && !/^H[1-4]$/.test(node.tagName)) { if (!['SCRIPT','STYLE','NAV','FOOTER'].includes(node.tagName)) { const text=node.innerText?.replace(/\s+/g,' ').trim(); if(text) parts.push(text); } node=node.nextElementSibling; }
      const text=parts.join('\n').trim();
      if(text.length>25) corpus.push({title:`${mainTitle} · ${heading.textContent.trim()}`,text:text.slice(0,2200),url:`${canonical}${heading.id ? `#${encodeURIComponent(heading.id)}` : ''}`});
    }
    if (!corpus.some(item=>item.url===canonical)) {
      const text=root.innerText.replace(/\s+/g,' ').trim();
      if(text) corpus.push({title:mainTitle,text:text.slice(0,2200),url:canonical});
    }
  };
  const buildIndex = async () => {
    const language=langNow(); if(indexedLanguage===language && corpus.length) return;
    if(indexing && indexedLanguage===language) return indexing;
    indexedLanguage=language; corpus=[];
    indexing=(async()=>{
      await Promise.all(pages[language].map(async ([path,title])=>{
        try { const response=await fetch(path,{credentials:'same-origin',headers:{'Accept':'text/html'}}); if(!response.ok) return; extract(await response.text(),new URL(path,location.origin).href,title); } catch (_) { /* unavailable pages are skipped; local search continues */ }
      }));
    })();
    await indexing; indexing=null;
  };
  const aliases = query => {
    const q=normalize(query); const additions=[];
    const pairs=[[/\b(mevo|report|laporan)\b/,'editorial member report score methodology'],[/\b(harga|price|pricing)\b/,'coffee price tracking green bean roasted bean'],[/\b(ekspor|export)\b/,'export requirements documents destination country checklist'],[/\b(quotation|kuotasi|penawaran)\b/,'calculator FOB quote quotation'],[/\b(data|tren|trend|market)\b/,'ICO USDA BPS trade production consumption']];
    for(const [pattern,extra] of pairs) if(pattern.test(q)) additions.push(extra);
    return `${query} ${additions.join(' ')}`;
  };
  const answer = async query => {
    const t=copy[langNow()], status=dialog.querySelector('#kk-guide-status'), result=dialog.querySelector('#kk-guide-results');
    status.textContent=t.loading; result.replaceChildren();
    const direct=await structuredAnswer(String(query||''));
    if(direct.length){status.textContent=t.ready;direct.slice(0,8).forEach(item=>{const article=document.createElement('article');article.className='kk-guide-answer';const h=document.createElement('h3');h.textContent=item.title;const p=document.createElement('p');p.textContent=item.text;article.append(h,p);const citation=document.createElement('div');citation.className='kk-guide-citation';const a=document.createElement('a');a.href=item.url;a.target='_blank';a.rel='noopener noreferrer';a.textContent=item.label||t.source;const date=document.createElement('span');date.textContent=`${item.dateLabel|| (langNow()==='en'?'Source date':'Tanggal sumber')}: ${formatDate(item.date)}`;citation.append(a,date);article.append(citation);result.append(article);});return;}
    await buildIndex();
    const terms=[...new Set(tokens(aliases(String(query||''))))];
    if(!terms.length){status.textContent=t.none;return;}
    const ranked=corpus.map(item=>{
      const titleWords=new Set(tokens(item.title)), bodyWords=new Set(tokens(item.text)); let score=0, matches=0;
      for(const term of terms){if(titleWords.has(term)){score+=4;matches++;} else if(bodyWords.has(term)){score+=1;matches++;}}
      const density=matches/terms.length; return {...item,score:score*density};
    }).filter(item=>item.score>0).sort((a,b)=>b.score-a.score).slice(0,3);
    if(!ranked.length){status.textContent=t.none;return;}
    status.textContent=t.ready;
    ranked.forEach(item=>{
      const article=document.createElement('article'); article.className='kk-guide-answer';
      const h=document.createElement('h3'); h.textContent=item.title;
      const p=document.createElement('p'); const snippet=item.text.length>430?`${item.text.slice(0,427).replace(/\s+\S*$/,'')}…`:item.text; p.textContent=snippet;
      const a=document.createElement('a'); a.href=item.url; a.textContent=t.source;
      article.append(h,p,a); result.append(article);
    });
  };
  const css=document.createElement('link'); css.rel='stylesheet'; css.href='/assets/kabar-kopi-chatbot.css'; document.head.append(css);
  renderShell(); document.body.append(button,dialog);
  button.addEventListener('click',()=>{ renderShell(); dialog.showModal(); dialog.querySelector('[name=q]').focus(); });
  document.documentElement.addEventListener('langchange',renderShell);
  new MutationObserver(()=>{ if(indexedLanguage && indexedLanguage!==langNow()){indexedLanguage='';corpus=[];} if(!dialog.open) renderShell(); }).observe(document.documentElement,{attributes:true,attributeFilter:['lang']});
})();
