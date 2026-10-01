# Menjalankan Kabar Kopi

## Berkas halaman

`kabar-kopi.html` adalah halaman portal baru. `laporan-usda.html` hanya mengalihkan URL lama ke halaman baru agar bookmark dan tautan terdahulu tetap bekerja. `gateway.html` sudah diarahkan ke nama dan bagian halaman baru.

## Yang dikerjakan otomatis

Workflow GitHub Actions memperbarui feed, menambahkan berita ke arsip bulanan, membuat indeks arsip untuk pencarian, menerapkan keputusan editor, memperbarui katalog klaster, lalu menyusun artikel editorial. Pencarian menggabungkan feed terbaru dengan semua bulan pada indeks arsip dan memuat arsip saat pengguna mulai mencari. Data arsip tidak ikut terpotong oleh batas 500 berita pada feed terbaru.

Analisis dan pilihan editorial menggunakan bahan berita pada rentang waktu di `data/editorial-settings.json`. Artikel yang dibuat memuat lead, bagian analisis, kesimpulan, rekomendasi untuk audiens tertentu, sumber, serta catatan batas bukti. Model diminta untuk tidak menambah fakta di luar bahan. Tinjau hasil AI sebelum menganggapnya sebagai laporan faktual final.

## Mengaktifkan AI

Di pengaturan repo GitHub, tambahkan Actions secret bernama `OPENAI_API_KEY` dengan API key OpenAI. Jangan menaruh key di HTML, JSON publik, atau variabel biasa. Opsional, tambahkan Actions variable `OPENAI_MODEL`; bila kosong, workflow memakai `gpt-5`. Pemanggilan AI berjalan di GitHub Actions, bukan di perangkat pembaca. Pemakaian API dapat menimbulkan biaya sesuai akun OpenAI.

Tanpa secret tersebut, pengindeksan arsip dan pengelompokan berbasis kata kunci tetap berjalan, tetapi kandidat AI dan artikel editorial penuh belum dihasilkan.

## Memilih artikel editorial

Ubah `data/editorial-settings.json` dan commit perubahan:

- `mode: "auto"` memilih sampai `max_topics` topik dengan berita terbanyak dalam periode.
- `mode: "editor"` memakai daftar `selected_cluster_ids` yang dipilih editor, misalnya `ekspor-daya-saing`.
- `lookback_days` menentukan rentang berita.
- `minimum_articles_per_topic` mencegah artikel dibuat dari bahan yang terlalu sedikit.

Setelah perubahan masuk, jalankan workflow `Update Coffee Market Data` secara manual atau tunggu jadwal berikutnya. Hasil terbaru tersimpan di `data/editorial-current.json`; versi sebelumnya disimpan di `data/editorial-archive.json`.

## Menyetujui atau menolak klaster baru

Usulan AI ada di `data/cluster-candidates.json`, termasuk ID, alasan, dan tautan berita pendukung. Untuk mengaktifkan kandidat, tambahkan ID-nya ke `accepted_candidate_ids` di `data/cluster-decisions.json`. Untuk menolak, tambahkan ID ke `rejected_candidate_ids`. Kandidat yang disetujui masuk katalog, dipakai untuk mengklasifikasikan berita berikutnya, dan tersedia untuk laporan editorial. Berita lama dapat diarahkan manual dengan menambahkan `{ "url": "URL_ARTIKEL", "cluster_id": "ID_KLASTER" }` pada `overrides`.

Kandidat belum langsung menjadi klaster aktif sebelum editor menyetujuinya. Ini mencegah satu berita atau usulan yang keliru mengubah struktur kategori portal.

## Batas cakupan pencarian

Arsip bulanan menampung berita yang berhasil dihimpun oleh job feed pada setiap jadwal. Pencarian hanya dapat menemukan artikel yang pernah masuk ke arsip tersebut; artikel lama sebelum pengarsipan mulai berjalan tidak otomatis diimpor dari penerbit lain.
