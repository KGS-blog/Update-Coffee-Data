// ===== BERITA_KLASTER_FINAL.js — v2026.09.27-15 =====
// Standalone file untuk clustering berita dengan logic & fetching sendiri
// Tidak depend pada laporan-usda.html, bisa digunakan di mana saja

// ===== KLASTER BERITA DEFINITION — 810+ KEYWORDS =====
const BERITA_KLASTER = [
    // CLUSTER 1: Harga & Pasar — 51 keywords
    { nama: "Harga & Pasar", slug: "harga-pasar", analisis_id: "harga-komoditas", nama_en: "Prices & Market", kunci: ["harga","ekspor","impor","fob","kurs","dolar","lelang","nilai ekspor","penurunan harga","kenaikan harga","stok","c-market","mahal","murah","ico","new york","london","futures","forward contract","spot price","harga spot","supply","demand","shortage","kekurangan","surplus","oversupply","purchasing power","daya beli","affordability","supply chain","rantai pasokan","logistics","pengiriman","shipping","margin","keuntungan","profit","loss","rugi","revenue","pendapatan","wholesale","retail","distributor","buyer","seller","pembeli","penjual","competition","kompetisi","market share","pangsa pasar","price movement","pergerakan harga","volatility","volatilitas"] },

    // CLUSTER 2: Produksi & Panen — 64 keywords (with rejuvenation keywords)
    { nama: "Produksi & Panen", slug: "produksi-panen", analisis_id: "hilirisasi-produksi", nama_en: "Production & Harvest", kunci: ["panen","produksi","produktivitas","kebun","cuaca","kemarau","hujan","la nina","el nino","gagal panen","bibit","tanam","areal","luas areal","budidaya","pertanian","agronomic","agronomi","farming","farm","plantation","pemeliharaan kebun","manajemen kebun","perawatan tanaman","karakteristik kebun","farm characteristics","shade grown","monoculture","intercropping","companion planting","soil","tanah","pH","nutrient","nitrogen","phosphorus","potassium","hama","penyakit","pest","disease","fungal","jamur","karat kopi","coffee leaf rust","berry borer","pest control","pestisida","organic","varietas","arabica","robusta","hybrid","breed","genetic","genetika","breeding program","selection","seleksi","yield improvement","altitude","ketinggian","elevation","climate","iklim","terroir","temperature","temperatur","precipitation","curah hujan","picker","petik","hand picked","selective picking","strip picking","mechanical harvest","machine harvest","mesin panen","yield","hasil panen","ton","ton per hectare","annual production","crop forecast","proyeksi panen","harvest season","musim panen","petani","farmer","smallholder","cooperative","koperasi","group farming","profil rasa","flavor profile","taste profile","sensory characteristics","program peremajaan","rejuvenasi","replanting program","peremajaan kebun"] },

    // CLUSTER 3: Kebijakan & Regulasi — 42 keywords
    { nama: "Kebijakan & Regulasi", slug: "kebijakan-regulasi", analisis_id: null, nama_en: "Policy & Regulation", kunci: ["eudr","tarif","regulasi","pemerintah","kementan","bea cukai","subsidi","peraturan","izin","kemendag","sertifikasi","standar","bappebti","ipc","ica","ico","aeki","kemenlu","kemenkeu","kemenperin","presiden","menteri","kementerian","certification","sertifikat","eco-label","ecolabel","fair trade","rainforest alliance","organic certification","utz certified","carbon footprint","jejak karbon","sustainability","berkelanjutan","environmental impact","dampak lingkungan","sni","iso","quality standard","standar mutu","food safety","pesticide residue","residual pestisida","maximum residue level","heavy metals","logam berat","mycotoxin","kontaminasi","trade war","tariff","trade agreement","perjanjian dagang","protectionist","proteksionisme","wto","asean","kerjasama dagang","export license","izin ekspor","import duty","bea masuk","climate change","perubahan iklim","climate adaptation","mitigasi","water rights","hak air","irrigation","irigasi","labor","tenaga kerja","minimum wage","upah minimum","working conditions","child labor","buruh anak","forced labor","land rights","hak lahan","land reform","agrarian","kepemilikan lahan","community rights","indigenous","adat"] },

    // CLUSTER 4: Event & Kompetisi — explicit event signals only
    { nama: "Event & Kompetisi", slug: "event-kompetisi", analisis_id: "brand-event", nama_en: "Events & Competitions", kunci: ["festival", "festival kopi", "coffee festival", "coffee fest", "coffee days", "coffee day", "hari kopi internasional", "hari kopi nasional", "kompetisi", "kompetisi kopi", "coffee competition", "barista competition", "kejuaraan barista", "barista championship", "world barista championship", "latte art competition", "lomba barista", "pameran", "pameran kopi", "coffee exhibition", "coffee expo", "trade show", "konferensi kopi", "coffee conference", "seminar kopi", "workshop kopi", "coffee workshop", "coffee party", "pesta kopi", "ajang kopi", "tasting event", "coffee tasting event"] },

    // CLUSTER 5: Barista & Teknik Seduh — 149 keywords
    { nama: "Barista & Teknik Seduh", slug: "barista-teknik-seduh", analisis_id: null, nama_en: "Barista & Brewing", kunci: ["barista","brewing","seduh","latte","manual brew","v60","grinder","espresso","pour over","teknik seduh","tata cara","latte art","drip","mesin kopi","coffee machine","espresso machine","mesin espresso","moka pot","moka","french press","aeropress","chemex","kalita wave","cloth filter","filter kain","paper filter","metal filter","saringan","portafilter","basket","shower head","group head","tamper","scale","timbangan","timer","thermometer","barometer","water heater","pemanas air","steam wand","milk frother","tamping","distribusi","distribution","water temperature","temperatur air","brew time","waktu seduh","extraction","ekstrasi","contact time","grind size","ukuran penggilingan","coarse","fine","medium","water quality","kualitas air","mineral content","ph","yield","ratio","perbandingan","coffee to water","coffee water ratio","channeling","blooming","pre-infusion","flow rate","laju aliran","americano","cappuccino","flat white","macchiato","ristretto","lungo","cortado","affogato","mocha","cold brew","cold drip","iced coffee","ice latte","specialty drink","minuman spesial","signature drink","latte art","seni kopi","rosettas","tulips","hearts","milk steaming","steam susu","microfoam","frothing","consistency","texture","temperature","technique","skill","coffee knowledge","pengetahuan kopi","sensory","tasting notes","body","acidity","bitterness","sweetness","flavor","aroma","aftertaste","mouthfeel","balance","complexity","tasting wheel","sensory profile","cup score","sca","specialty coffee association","certification","certified","level 1","level 2","level 3","course","kursus","training","pelatihan","barista school","sekolah barista","best practice","standard operating procedure","sop","quality control","kontrol kualitas","sanitation","kebersihan","maintenance","perawatan"] },

    // CLUSTER 6: Riset & Tren Konsumen — research and measured-consumption signals
    { nama: "Riset & Tren Konsumen", slug: "riset-tren-konsumen", analisis_id: "konsumsi-domestik", nama_en: "Consumer Research & Trends", kunci: ["survei konsumen", "survei konsumsi kopi", "consumer survey", "consumer research", "riset konsumen", "penelitian konsumen", "studi konsumen", "consumer study", "consumer behavior", "consumer preference", "perilaku konsumen", "preferensi konsumen", "konsumen kopi", "pola konsumsi kopi", "pola konsumsi", "kebiasaan konsumsi kopi", "kebiasaan minum kopi", "coffee drinking habits", "tren konsumsi kopi", "consumption pattern", "consumption per capita", "per capita consumption", "konsumsi kopi per kapita", "konsumsi per kapita", "consumer habits", "preferensi minum kopi"] },

    // CLUSTER 7: Kedai, Konsumsi & Gaya Hidup — 82+ keywords (with homey keywords)
    { nama: "Kedai, Konsumsi & Gaya Hidup", slug: "kedai-konsumsi-gaya-hidup", analisis_id: "konsumsi-domestik", nama_en: "Cafes, Consumption & Lifestyle", kunci: ["kedai","kafe","gerai","ritel","cold brew","menu","franchise","coffee shop","cafe","coffee shop","kafe kopi","espresso bar","specialty coffee","third wave","artisan coffee","independent cafe","chain cafe","jaringan kafe","kiosk","stand","food truck","mobile","roastery","roastery cafe","traditional","modern","retail","ritel","store","toko","outlet","cabang","franchise","franchisee","franchisor","location","lokasi","strategic location","lokasi strategis","interior","ambiance","suasana","design","desain","seating","tempat duduk","counter","outdoor","indoor","menu","menu kopi","drink menu","food menu","menu makanan","specialty drink","minuman spesial","signature","food pairing","pasangan makanan","snack","dessert","pastry","breakfast","sarapan","lunch","dinner","tea","teh","morning","pagi","afternoon","sore","evening","malam","work","kerja","meeting","pertemuan","social","sosial","gathering","berkumpul","date","kencan","study","belajar","relaxation","santai","leisure","experience","pengalaman","lifestyle","gaya hidup","culture","community","komunitas","social space","ruang sosial","hangout","tempat nongkrong","gathering place","rumah kedua","habit forming","routine","rutinitas","business","bisnis","owner","pemilik","entrepreneur","wirausaha","profit","keuntungan","revenue","pendapatan","expansion","ekspansi","growth","pertumbuhan","scaling","service","layanan","customer service","pelayanan pelanggan","customer satisfaction","kepuasan pelanggan","loyalty program","membership","keanggotaan","rewards","reward program","quality","kualitas","consistency","standards","target market","pasar target","urban professional","office worker","wifi","workspace","workstation","meeting room","ruang rapat","delivery","pengiriman","takeaway","takeout","dine-in","street coffee","kaki lima","warung kopi","tempat kopi enak","kopi enak","spot kopi","kedai pinggir jalan","17 street","street vendor","pedagang kaki lima","homey","coffee homey"] },

    // CLUSTER 8: Ekspor & Daya Saing — 90+ keywords
    { nama: "Ekspor & Daya Saing", slug: "ekspor-daya-saing", analisis_id: "ekspor-daya-saing", nama_en: "Exports & Competitiveness", kunci: ["ekspor","daya saing","brand","merek","internasional","global","export","exportable","export-ready","export market","import","importer","buyer","pembeli","customer","shipment","port","pelabuhan","container","logistics","logistik","supply chain","rantai pasokan","trade","perdagangan","trader","trading house","world market","pasar dunia","global market","export destination","developed country","developing country","neighbor country","negara tetangga","us market","eu market","asian market","pasar asia","japan","jepang","korea","australia","china","cina","india","vietnam","vietnam","brazil","brasil","kolombia","peru","uganda","wholesale","wholesale buyer","distributor","retailer","specialty","specialty coffee","premium","premium coffee","high end","single origin","single origin","single estate","terroir","microlot","micro lot","limited edition","edisi terbatas","roaster","roasting","roasted","specialty roaster","cup score","cupping score","sca score","q grader","defect","defective bean","cacat","quality defect","competitive advantage","keunggulan kompetitif","differentiation","unique selling point","usp","positioning","cost leadership","innovation","inovasi","quality","kualitas","reliability","keandalan","consistency","brand","brand image","reputation","reputasi","recognition","branding","brand building","brand awareness","brand equity","certification","award","penghargaan","akreditasi","market share","pangsa pasar","market position","posisi pasar","competitor","kompetitor","competition","kompetisi","market trend","tren pasar","market growth","pertumbuhan pasar","opportunity","peluang","threat","ancaman","price premium","premium harga","pricing strategy","strategi harga","value added","nilai tambah","value proposition","value chain","profit margin","margin keuntungan","fair trade","ethical","etis","sustainability","keberlanjutan","eco-friendly","ramah lingkungan","organic","shade grown","carbon neutral","carbon offset","carbon footprint","market intelligence","market analysis","benchmarking","best practice","industry standard","government support","dukungan pemerintah","export incentive","trade mission","trade show","promotion","promosi","kopi gayo","gayo coffee","aceh coffee","kopi aceh","regional origin","coffee origin","dinobatkan","terbaik di asia","peringkat dunia","kualitas ekspor","award winner","award international"] },

    // CLUSTER 9: Pendidikan & Industri — 97 keywords
    { nama: "Pendidikan & Industri", slug: "edukasi-industri", analisis_id: "edukasi-industri", nama_en: "Education & Industry", kunci: ["edukasi","pendidikan","industri","akademi","kurikulum","pelatihan","education","training","workshop","course","kursus","seminar","webinar","school","sekolah","academy","akademi","institute","lembaga","center","pusat","university","universitas","college","vocational","barista school","sekolah barista","coffee school","roasting course","cupping course","brewing course","sensory training","specialty coffee association","sca","certification","world coffee event","wce","world barista championship","wbc","curriculum","kurikulum","syllabus","course content","materi","module","modul","lesson","pelajaran","unit","practical","praktik","theory","teori","hands-on","assessment","ujian","exam","test","evaluation","penilaian","trainer","pelatih","instructor","instruktur","facilitator","expert","ahli","mentor","master","champion","certification","sertifikasi","certified","tersertifikasi","q grader","q processor","level 1","level 2","level 3","accredited","terakreditasi","credential","kredensial","standard","standar","requirement","persyaratan","compliance","professional development","pengembangan profesional","career path","jalur karir","advancement","kemajuan","skill development","pengembangan keterampilan","upskilling","continuous learning","lifelong learning","pembelajaran berkelanjutan","industry knowledge","pengetahuan industri","best practice","innovation","inovasi","technology","teknologi","research","penelitian","development","pengembangan","pilot program","program percobaan","case study","studi kasus","industry development","pengembangan industri","industry growth","industry association","asosiasi industri","trade body","aeki","ico","ica","ici","iwic","lobbying","advocacy","kampanye","policy advocacy","industry news","berita industri","industry report","student","peserta","participant","trainee","apprentice","graduate","alumni","peer learning","collaboration","network","networking","community","komunitas","impact","dampak","outcome","hasil","effectiveness","efektivitas","satisfaction","kepuasan","feedback","testimonial","success rate","tingkat keberhasilan","graduation rate","online","virtual","distance learning","e-learning","video tutorial","online course","platform","knowledge sharing","berbagi pengetahuan","documentation","sop","standard operating procedure","guide","panduan","manual","reference","literature"] },

    // CLUSTER 10: Brand Global — 110+ keywords
    { nama: "Brand Global", slug: "brand-global", analisis_id: "brand-global", nama_en: "Global Brands", kunci: ["brand","merek","global","internasional","posisi","repositioning","brand name","merek","merek global","multinational brand","international brand","retail brand","coffee chain","coffee company","startup","startup kopi","new brand","merek baru","starbucks","coffee bean","peets","intelligentsia","blue bottle","lavazza","nespresso","keurig","nescafe","folgers","maxwell house","illy","illy coffee","segafredo","kimbo","victor","kraft","jacobs","jacobs douwe","fore coffee","litterly coffee","bacha coffee","draft coffee","taname ra coffee","positioning","market position","brand positioning","repositioning","rebranding","brand refresh","brand evolution","brand identity","identitas merek","brand image","brand value","brand equity","brand strength","brand loyalty","marketing","pemasaran","advertising","iklan","campaign","kampanye","promotion","promosi","brand awareness","awareness merek","communication","komunikasi","messaging","social media","media sosial","digital marketing","pemasaran digital","influencer","partnership","kerjasama","corporate","korporat","company","perusahaan","corporation","ceo","cfo","executive","eksekutif","leadership","acquisition","akuisisi","merger","investment","funding","pendanaan","ipo","public company","expansion","ekspansi","growth","pertumbuhan","opening","new store","toko baru","new market","pasar baru","market entry","penetrasi pasar","global expansion","distribution","distribusi","franchise","joint venture","partnership","kerjasama","innovation","inovasi","product launch","peluncuran produk","new product","produk baru","product line","lini produk","ready-to-drink","rtd","instant coffee","coffee pod","capsule","kapsul","equipment","peralatan","technology","sustainability","keberlanjutan","csr","corporate social responsibility","environmental","lingkungan","eco-friendly","green","organic","fair trade","ethical sourcing","ethical","responsible","partnership","kerjasama","collaboration","kolaborasi","co-branding","licensing","supplier","distributor","retailer","retail partner","news","berita","announcement","pengumuman","statement","press release","siaran pers","press conference","achievement","pencapaian","award","penghargaan","recognition","akreditasi","customer experience","pengalaman pelanggan","loyalty program","membership","rewards","satisfaction","kepuasan","customer service","layanan pelanggan","price","harga","pricing","pricing strategy","premium pricing","value","value proposition","discount","sale","penjualan","revenue","pendapatan","sales growth","pertumbuhan penjualan","diskon","promo"] }
];

// ===== HELPER FUNCTIONS =====

/**
 * Perform clustering pada artikel berdasarkan BERITA_KLASTER
 * @param {Array} artikel - Array of article objects with 'judul' property
 * @returns {Object} - Result object dengan clustered articles dan metadata
 */
function clusterBerita(artikel) {
    const definitions = (typeof window !== "undefined" && Array.isArray(window.BERITA_KLASTER)) ? window.BERITA_KLASTER : BERITA_KLASTER;
    const result = {
        success: true,
        total_artikel: artikel.length,
        clustering_timestamp: new Date().toISOString(),
        klaster: [],
        lainnya_items: []
    };

    // Initialize clusters
    const kl = definitions.map(k => ({
        nama: k.nama,
        nama_en: k.nama_en,
        slug: k.slug,
        analisis_id: k.analisis_id,
        kunci: k.kunci,
        items: [],
        jumlah: 0,
        persen: 0
    }));

    let lainnya = { nama: "Lainnya", nama_en: "Others", items: [] };

    // Clustering logic
    artikel.forEach(a => {
        const t = String(a.judul || "").toLowerCase();
        const saved = String(a.cluster_id || a.cluster_name || a.klaster_user || "").toLowerCase();
        const assignment = String(a.cluster_assignment || "").toLowerCase();
        // The server has explicitly left this item unclassified. Do not
        // silently replace that decision with a weak browser keyword match.
        if (["lainnya", "other"].includes(saved) || assignment === "unassigned") {
            lainnya.items.push(a);
            return;
        }
        const hit = kl.find(k => saved && [k.slug, k.nama].some(v => String(v || "").toLowerCase() === saved))
            || kl.find(k => k.kunci.some(kw => t.indexOf(kw) !== -1));
        (hit || lainnya).items.push(a);
    });

    // Calculate percentages
    kl.forEach(k => {
        k.jumlah = k.items.length;
        k.persen = artikel.length ? Math.round((k.jumlah / artikel.length) * 100) : 0;
    });

    lainnya.jumlah = lainnya.items.length;
    lainnya.persen = artikel.length ? Math.round((lainnya.jumlah / artikel.length) * 100) : 0;

    // Return formatted result
    result.klaster = kl.filter(k => k.items.length > 0);
    result.lainnya_items = lainnya.items;
    result.lainnya_jumlah = lainnya.jumlah;
    result.lainnya_persen = lainnya.persen;

    return result;
}

// ===== MAIN: AUTO-FETCH & CLUSTER =====

/**
 * Fetch berita-all.json dan perform clustering
 * Result disimpan di window.BERITA_HASIL_CLUSTERING untuk akses global
 */
async function fetchAndClusterBerita() {
    try {
        const response = await fetch("https://KGS-blog.github.io/Update-Coffee-Data/data/berita-all.json", {
            cache: "no-store"
        });

        if (!response.ok) {
            throw new Error(`HTTP ${response.status}`);
        }

        const data = await response.json();
        const artikel = (data && data.artikel) || [];

        // Perform clustering
        const hasil = clusterBerita(artikel);

        // Store result globally for laporan-usda.html to access
        window.BERITA_HASIL_CLUSTERING = hasil;

        // Log summary
        console.log(`[BERITA_KLASTER_FINAL] Clustering complete - Total: ${hasil.total_artikel}, Lainnya: ${hasil.lainnya_jumlah}`);

        return hasil;
    } catch (error) {
        console.error("[BERITA_KLASTER_FINAL] Error:", error.message);
        return {
            success: false,
            error: error.message,
            klaster: [],
            lainnya_items: []
        };
    }
}

// Auto-fetch when script loads
if (typeof window !== 'undefined') {
    window.BERITA_KLASTER = BERITA_KLASTER;
    window.clusterBerita = clusterBerita;
    window.fetchAndClusterBerita = fetchAndClusterBerita;

    // Auto-trigger fetch
    document.addEventListener("DOMContentLoaded", () => {
        fetchAndClusterBerita();
    });
}

console.log(`[BERITA_KLASTER_FINAL.js] Loaded - ${BERITA_KLASTER.length} clusters, ${BERITA_KLASTER.reduce((n, c) => n + c.kunci.length, 0)} keyword signals`);

if (typeof module !== "undefined" && module.exports) {
    module.exports = { BERITA_KLASTER, clusterBerita };
}
