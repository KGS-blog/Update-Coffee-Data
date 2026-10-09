# Metodologi klasifikasi dan penemuan topik berita Kabar Kopi

Dokumen ini menjelaskan metode yang dipakai dan batasnya. Ini adalah rancangan klasifikasi editorial MEVO/Kabar Kopi, bukan klaim bahwa sistem menjalankan BERTopic, Snorkel, atau model NLI secara penuh.

## Sasaran

Setiap berita yang relevan mendapat satu **cluster utama** berdasarkan pokok berita, bukan sekadar kata yang disebut. Tema tambahan dapat disimpan sebagai tag jika berguna, tetapi tidak menggantikan cluster utama. Artikel yang belum cukup bukti tetap menunggu moderasi; sistem tidak boleh memaksanya ke cluster agar angka “Lainnya” tampak kecil.

## Tahapan

1. **Kualitas sumber dan ekstraksi** — simpan status terpisah untuk teks artikel yang berhasil diekstrak, konten tipis, paywall/penolakan, kesalahan jaringan, dan kegagalan parsing. Judul serta deskripsi feed dapat membantu pencarian kandidat, tetapi tidak dianggap sebagai kutipan isi artikel. Ekstraksi isi berita adalah tahap tersendiri dalam sistem pengolahan berita (Ibrahim et al., LREC 2008).
2. **Relevansi kopi** — nilai apakah kopi menjadi pokok atau bukti penting dalam berita. Penyebutan insidental diberi saran “tidak relevan” untuk editor; tidak dihapus otomatis.
3. **Kesesuaian judul–isi** — bandingkan judul dengan konteks isi yang diekstrak. Model harus mengutip bukti verbatim dari konteks isi, bukan judul. Bukti divalidasi terhadap konteks isi secara terpisah, termasuk memastikan kutipan memiliki istilah substantif yang tidak hanya menyalin judul. Jika konteks tidak diekstrak atau kutipan tidak lolos validasi, hasil menjadi tidak pasti dan tidak boleh menetapkan cluster otomatis.
4. **Pencarian cluster yang ada** — gunakan definisi, cakupan, pengecualian, dan contoh artikel tiap cluster. Selain aturan editorial, sistem lokal membandingkan representasi TF-IDF artikel dengan artikel terdahulu yang sudah memiliki label editor atau assignment sistem berkeyakinan tinggi. Judul diberi bobot lebih besar daripada isi; kata umum seperti “kopi” tidak menjadi bukti tema. Sistem lebih dulu memastikan istilah substantif judul didukung konteks isi. Pencocokan leksikal hanya menjadi petunjuk. Jika dua cluster sama kuat, minta moderasi.
5. **Penetapan bertingkat** — keputusan editor mengungguli semua tebakan sistem. Penempatan otomatis dibatasi pada cluster standar dengan bukti isi valid dan keyakinan tinggi. Saran cluster yang belum memenuhi batas disimpan sebagai “cluster disarankan”, bukan dibiarkan tak terbedakan di “Lainnya”.
6. **Penemuan tema baru** — kelompokkan artikel relevan yang belum cocok sebagai kandidat sementara. Ringkasan kata-kata pembeda dan daftar URL harus ditinjau editor; cluster baru membutuhkan dukungan artikel independen dan cakupan yang tidak tumpang tindih secara berlebihan. Tema hasil clustering tidak otomatis menjadi kategori publik.
7. **Evaluasi** — bangun sampel acuan yang dilabeli editor, kemudian ukur precision, recall, F1 per cluster, tingkat salah-klasifikasi, proporsi abstain, dan agreement antarpenilai. Jangan mengoptimalkan persentase artikel yang berhasil ditempatkan saja.

### Kode tema dan bukti sumber adalah dua kolom berbeda

Review artikel sekarang meminta `thematic_statement`: satu kalimat parafrasa yang merangkum proposisi pokok artikel dengan kata-kata sistem. Kalimat ini menjadi kode analitis untuk pencocokan cluster; ia bukan kutipan penerbit dan tidak boleh diberi tanda kutip. `evidence` tetap merupakan kutipan verbatim dari konteks isi yang berhasil diekstrak, dipakai sebagai jejak audit terpisah. Review versi 9 menyimpan kode tema di `cluster_relevance_review.thematic_statement`; assignment otomatis juga menyimpan `cluster_ai_theme`. Assignment otomatis mensyaratkan kode tema yang cukup panjang, bukti konteks tervalidasi, dan batas keyakinan yang berlaku. Perubahan ini menggunakan skema dalam panggilan review clustering yang sudah ada, bukan menambah panggilan API baru.

## Pemisahan status antrean

Artikel di luar cluster publik harus dibedakan paling tidak menjadi:

- `source_context_unavailable`: isi sumber belum dapat diperiksa;
- `review_pending`: konteks tersedia tetapi belum direview;
- `existing_cluster_suggested`: artikel relevan dan ada cluster yang disarankan, menunggu aturan keyakinan/editor;
- `evidence_not_grounded_in_article_context`: kutipan review tidak dapat diverifikasi pada konteks isi;
- `title_context_mismatch`: isi tidak mendukung fokus judul atau berbeda pokok;
- `irrelevant_suggested`: kopi tampaknya hanya disebut sekilas; keputusan buang tetap milik editor;
- `editor_review_needed`: bukti atau batas antarklaster belum cukup jelas.

Status ini menjelaskan ketidakpastian; tidak mengubah keputusan editorial menjadi fakta.

## Identitas artikel, liputan peristiwa, dan bukti independen

Ketiganya adalah hal berbeda dan tidak boleh disatukan menjadi satu hitungan:

1. **Identitas artikel** — deduplikasi teknis hanya menyatukan rekaman dengan URL penerbit setelah normalisasi yang sama. Fragmen URL dan parameter pelacakan umum diabaikan. URL penerbit berbeda berarti rekaman liputan tetap disimpan, sekalipun judulnya identik atau sangat mirip. Judul bukan kunci deduplikasi karena beberapa media dapat meliput peristiwa yang sama dengan judul serupa.
2. **Liputan peristiwa** — dua artikel dapat membahas peristiwa yang sama (misalnya Trade Expo Indonesia) namun tetap merupakan dua rekaman penerbit. Kemiripan judul, tanggal, entitas, atau tema tidak boleh menghapus artikel. Sistem saat ini tidak menganggap kemiripan tersebut sebagai bukti bahwa artikel identik; pengelompokan peristiwa lintas-sumber belum menjadi deduplikasi otomatis.
3. **Asal bukti** — beberapa artikel yang mengulang siaran pers, kutipan narasumber, atau dataset yang sama adalah beberapa liputan, tetapi satu asal klaim. Jumlah URL atau penerbit tidak otomatis berarti jumlah konfirmasi independen. Independensi harus ditelusuri ke sumber klaim/bukti primer dan verifikasi terpisah; bila belum diketahui, statusnya belum diverifikasi.

URL Google News yang belum terselesaikan diperlakukan sebagai petunjuk penemuan, bukan penerbit tambahan. Jika judulnya cocok dengan artikel yang sudah memiliki URL penerbit terverifikasi, pointer agregator tidak ditampilkan sebagai sumber kedua. Sebaliknya, artikel dari URL penerbit berbeda tidak dibuang hanya karena judulnya cocok. Jika hubungan dua rekaman belum jelas, pertahankan keduanya dan tandai untuk pemeriksaan, jangan hapus diam-diam.

Data feed memuat `metodologi_deduplikasi` agar aturan ini dapat dibaca mesin dan diaudit. Aturan tersebut menjelaskan kebijakan, bukan klaim bahwa sistem sudah mengidentifikasi seluruh rantai sindikasi, mengelompokkan semua peristiwa, atau memverifikasi independensi setiap klaim.

## Keterlacakan sitasi dalam artikel analisis

Nomor sitasi artikel analisis baru memakai ID stabil dari `input_sources`; nomor tidak ditafsirkan ulang sebagai posisi dalam daftar URL. Setiap ID harus ditemukan pada daftar sumber masukan dan URL yang sama harus dicantumkan dalam `source_urls`. Untuk setiap sumber yang dikutip, keluaran juga harus menyertakan klaim yang dirujuk dan kutipan bukti verbatim dari cuplikan sumber. Sebelum artikel disimpan, validator memeriksa bahwa ID tersedia, URL cocok persis dengan data masukan, tidak ada sumber tak-terkutip, dan kutipan bukti terdapat dalam konteks sumber. Jika salah satu pemeriksaan gagal, artikel baru ditolak dan laporan sebelumnya dipertahankan.

Pemeriksaan tersebut mencegah nomor bergeser atau menunjuk ke URL yang berbeda, dan memastikan ada teks sumber yang dapat diperiksa. Pemeriksaan ini bukan pembuktian otomatis bahwa penafsiran klaim benar atau bahwa penerbit benar; editor tetap perlu menilai apakah kutipan memang mendukung klaim. Artikel lama tetap didukung dengan aturan kompatibilitas: jika semua nomor sitasinya berada dalam rentang `source_urls`, nomor dipetakan menurut urutan URL yang tersimpan; jika tidak, nomor diperlakukan sebagai ID sumber masukan.

## Landasan riset dan penerapannya

- **Pengelompokan headline sulit secara semantik.** Dataset Headline Grouping menguji apakah pasangan judul berita membahas kelompok/topik yang sama dan memperlakukan penilaiannya sebagai tantangan NLU. Karena itu, kemiripan kata pada judul tidak cukup untuk memasukkan berita ke cluster (Vijay et al., NAACL 2021, [paper](https://aclanthology.org/2021.naacl-main.255/)).
- **Embedding dan density clustering untuk menemukan tema.** BERTopic membentuk embedding dokumen, mengelompokkan representasi tersebut, lalu menghasilkan istilah yang menjelaskan kelompok melalui class-based TF-IDF. Ini berguna untuk menemukan pola baru pada artikel yang belum cocok, tetapi bukan bukti bahwa label editorial benar dan bukan klasifikator taksonomi Kabar Kopi yang telah terkalibrasi (Grootendorst, 2022, [paper](https://arxiv.org/abs/2203.05794)).
- **Sinyal lemah perlu boleh abstain dan saling diperiksa.** Snorkel memodelkan beberapa fungsi label seperti aturan, pola, atau basis pengetahuan yang mungkin bertentangan; pendekatannya memisahkan label lemah dari label acuan dan evaluasi. Untuk Kabar Kopi, aturan cluster menjadi sinyal kandidat dan editor tetap menjadi pengendali keputusan berisiko tinggi (Ratner et al., VLDB 2017, [paper](https://arxiv.org/abs/1711.10160)).
- **Keputusan berbasis kutipan perlu memisahkan bukti dari klaim.** Sistem FEVER memisahkan penemuan span bukti dari klasifikasi klaim–bukti. Prinsip ini diadaptasi untuk memisahkan judul dari konteks artikel dan menolak kutipan yang hanya ada pada judul (Portelli et al., FEVER 2020, [paper](https://aclanthology.org/2020.fever-1.7/)).
- **Definisi kelas adalah supervisi awal, bukan ground truth.** Riset weak supervision menunjukkan definisi label, aturan, dan contoh dapat membantu memulai klasifikasi, namun performanya harus dinilai dengan data acuan. Karena itu, deskripsi cluster harus memiliki contoh positif dan negatif serta diuji oleh editor (Meng et al., NAACL 2019, [paper](https://aclanthology.org/N19-3004/)).

## Perubahan kode yang sudah diterapkan lokal

- Pemeriksaan bukti review dan assignment sekarang memeriksa konteks isi secara terpisah dari judul.
- Contoh berlabel dari keputusan editor dan assignment sistem berkeyakinan tinggi dipakai sebagai referensi kemiripan TF-IDF lokal; pemrosesan ini tidak memanggil API.
- Kalibrasi leave-one-out awal memakai 30 contoh keputusan editor yang memenuhi syarat; hanya 26 yang lolos pemeriksaan hubungan judul-isi dan dapat dinilai. Ambang 0,22 dengan selisih 0,08 menghasilkan 5 prediksi benar dari 6 (precision 83,3%); ambang 0,34 menghasilkan 2 benar dari 3 (66,7%). Sampel ini terlalu kecil dan didominasi satu cluster untuk mengesahkan assignment otomatis.
- Karena itu, kemiripan historis saat ini hanya mengisi saran cluster untuk editor; belum ada assignment otomatis dari referensi. Artikel tetap di “Lainnya” sampai review kontekstual atau keputusan editor mengonfirmasi cluster.
- Konteks harus berstatus `extracted` untuk review berbasis isi dan penempatan otomatis oleh aturan.
- Kutipan yang hanya berupa judul, terlalu pendek, atau tidak memiliki istilah isi yang cukup tidak lolos sebagai bukti.
- Status antrean seperti isi sumber tidak tersedia, cluster disarankan, dan perlu tinjauan editor disimpan secara eksplisit.
- Model diminta membaca konteks, menulis parafrasa tema, lalu mencocokkan maknanya dengan cluster dalam urutan kerja yang eksplisit. Bukti kutipan verbatim disimpan terpisah dari kode tema parafrasa.
- Halaman metodologi publik ID dan EN menjelaskan prinsip analisis konten, pengodean tema, pemetaan cluster, evaluasi, keterbatasan, dan tautan penelitian; keduanya ditautkan dari footer dan sitemap.
- Versi review dinaikkan agar hasil review lama dinilai ulang secara bertahap. Pemrosesan tetap dibatasi 160 artikel per proses dan 20 artikel per batch; pipeline tidak dijalankan selama pembaruan lokal ini.

Kalibrasi lanjutan membutuhkan sampel keputusan editor yang lebih banyak dan seimbang antarcluster. Ukur precision/recall per cluster dan audit khusus untuk artikel yang salah ditempatkan; jangan menurunkan ambang hanya demi mengecilkan “Lainnya”.

## Batasan

Validasi kutipan berbasis istilah bukan model entailment yang memahami semua parafrasa. Ia dapat menolak bukti yang benar jika extractor menghasilkan potongan terlalu pendek, dan tidak membuktikan bahwa sumber tersebut benar. Ambang 0,85 juga bukan probabilitas terkalibrasi sebelum diuji pada label acuan. Untuk mengklaim kualitas, MEVO perlu mengumpulkan sampel review editorial dan melaporkan metrik per cluster.
