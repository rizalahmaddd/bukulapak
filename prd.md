# Product Requirement Document (PRD) — v2

**Nama Produk (Tentatif):** BukuLapak

**Model:** SaaS multi-tenant (satu aplikasi melayani banyak usaha, data tiap usaha terisolasi), **gratis untuk pengguna, tanpa paket berbayar**.

**Stack:** 100% Cloudflare free tier (Workers + Static Assets + D1), aplikasi berupa PWA offline-first. Tidak ada layanan berbayar maupun pihak ketiga yang wajib.

**Target Pengguna:** Pemilik & kasir UMKM Indonesia (toko kelontong, kuliner/F&B, fashion, jasa, supplier/grosir).

**Tujuan:** Pembukuan yang bisa dipakai orang yang tidak paham akuntansi, tapi angkanya tetap benar saat menghadapi kondisi riil UMKM.

> Ringkasan perubahan dari v1 ada di [Lampiran A](#lampiran-a--perubahan-dari-v1).

---

## 1. Problem & Goal

**Problem**
1. Aplikasi pembukuan umum terlalu rumit (debit/kredit, jurnal, alur berbelit).
2. Aplikasi yang simpel justru gagal di kondisi riil UMKM: uang pribadi tercampur uang usaha, pelanggan ngutang & dicicil, potongan MDR QRIS, dana QRIS/e-wallet belum cair, setor tunai ke bank, uang laci kurang/lebih, mati listrik & sinyal hilang.
3. Akibatnya pemilik tidak tahu dua hal paling dasar: **"Usaha saya untung berapa?"** dan **"Uang saya ada di mana?"**

**Goal**
* Input satu transaksi < 5 detik (median), maksimal 3 ketukan untuk transaksi tunai biasa.
* Angka **Untung** dan **Uang Ada** tetap benar walau ada prive, utang-piutang, QRIS, dan transfer antar-akun.
* Berjalan penuh tanpa internet; sinkron otomatis saat online.
* Biaya infrastruktur Rp0 sampai kapasitas free tier habis (lihat §6.4).

**Prinsip desain: kerumitan disembunyikan di Kategori, bukan di form.**
Pengguna cukup memilih kategori ("Jualan", "Beli Bahan", "Ambil untuk Pribadi", "Setor ke Bank"). Tiap kategori punya *jenis* tersembunyi yang menentukan apakah transaksi memengaruhi Untung, hanya memindahkan uang, atau mengubah utang-piutang. Form tidak perlu checkbox/toggle akuntansi.

### Success Metrics
| Metrik | Target |
| --- | --- |
| Waktu buka aplikasi pertama kali → transaksi pertama | < 1 menit (tanpa daftar) |
| Pengguna mode tamu yang akhirnya daftar & membawa datanya | ≥ 40% dalam 30 hari |
| Median waktu input transaksi | < 5 detik |
| Retensi D30 (tenant mencatat ≥ 1 transaksi/minggu) | ≥ 30% |
| Sinkronisasi sukses (tanpa data hilang/dobel) | 99,9% operasi |
| Selisih "Uang Ada" vs hitung fisik laci saat tutup kasir | dicatat 100%, tidak pernah hilang diam-diam |

### Non-Goals (sengaja tidak dikerjakan)
Stok/inventori per barang, POS per item (keranjang belanja), PPN & faktur pajak, penggajian, multi-cabang, integrasi mutasi bank otomatis, akuntansi double-entry yang terlihat oleh user.

---

## 2. Konsep Dasar (dipakai di semua fitur)

### 2.1 Akun Uang (tempat uang berada)
Setiap usaha punya akun default, bisa ditambah/diganti nama:
* **Laci Kasir** (tunai)
* **Rekening Bank**
* **Saldo QRIS / E-Wallet** (dana yang sudah masuk lewat QRIS tapi belum cair ke bank)

"Uang Ada" = total saldo semua akun. Selalu ditampilkan per akun.

### 2.2 Jenis Kategori (tersembunyi dari user)
| Jenis | Contoh kategori yang dilihat user | Ke Untung? | Ke Uang Ada? |
| --- | --- | --- | --- |
| Pendapatan usaha | Jualan, Jasa, Pendapatan Lain | Ya (+) | Ya, kecuali dicatat ngutang |
| Biaya usaha | Beli Bahan/Stok, Operasional, Gaji, Sewa, Listrik, Biaya Admin QRIS, Selisih Kas | Ya (−) | Ya, kecuali dicatat ngutang |
| Pribadi | Tambah Modal dari Uang Pribadi, Ambil untuk Pribadi (Prive) | Tidak | Ya |
| Pinjaman | Terima Pinjaman (KUR/koperasi), Bayar Cicilan Pinjaman (pokok) | Tidak | Ya |
| Aset | Beli Peralatan (etalase, kulkas, motor) | Tidak | Ya |
| Pindah uang | Setor ke Bank, Tarik dari Bank, Pencairan QRIS | Tidak | Tidak (hanya pindah akun) |
| Uang muka pesanan | DP Pesanan | Tidak, sampai pesanan selesai (§3.I) | Ya |

User bisa menambah kategori sendiri, tetapi harus memilih salah satu dari dua pertanyaan sederhana: *"Ini uang usaha?"* (Ya → pendapatan/biaya) atau *"Uang pribadi / pinjaman / beli alat?"*.

### 2.3 Definisi Untung (tertulis di aplikasi dengan bahasa sehari-hari)
* **Untung = Jualan − Biaya Usaha**, dihitung saat transaksi terjadi, **termasuk** jualan yang belum dibayar pelanggan dan belanja yang belum dibayar ke supplier.
* Pembayaran cicilan utang/piutang **tidak** menambah/mengurangi Untung lagi; hanya mengubah Uang Ada dan sisa utang/piutang.
* Bunga pinjaman = biaya usaha; pokok pinjaman bukan.
* Di layar, Untung dan Uang Ada **selalu tampil terpisah** dengan penjelasan satu kalimat ("Untung bisa beda dengan uang di tangan karena ada pelanggan yang belum bayar").

### 2.4 Nominal & Waktu
* Rupiah disimpan sebagai **integer** (tanpa desimal). Pembulatan MDR: dibulatkan ke rupiah terdekat.
* Zona waktu diatur per usaha (WIB/WITA/WIT); batas "hari ini" mengikuti zona usaha, bukan zona server (UTC).

---

## 3. Fitur Inti

### A. Dashboard
* **Hari ini:** Jualan, Biaya, **Untung**.
* **Uang Ada:** saldo per akun (Laci, Bank, QRIS belum cair).
* **Piutang aktif** (pelanggan belum bayar, tandai yang lewat jatuh tempo) & **Utang aktif** (ke supplier).
* Indikator sinkronisasi: "Tersimpan di HP" / "Tersinkron" / "Belum sinkron X jam" (peringatan jika > 24 jam).
* Aksi cepat: `+ Uang Masuk` (hijau), `− Uang Keluar` (merah), `⇄ Pindah Uang`.

### B. Buka & Tutup Kasir (Shift)
* **Buka Kasir:** hitung uang di laci (modal kembalian). Ini **bukan pendapatan**. Jika berbeda dari saldo Laci di sistem, user memilih: "ada tambahan dari uang pribadi" (→ Tambah Modal) atau "catat sebagai selisih".
* **Tutup Kasir:** hitung uang fisik → aplikasi menunjukkan seharusnya berapa → selisih otomatis dicatat ke kategori *Selisih Kas* (kurang = biaya, lebih = pendapatan lain) dengan nama kasir.
* Opsi lanjutan setelah tutup: "Setor ke Bank" / "Simpan, sisakan Rp X untuk kembalian besok".
* Fitur shift opsional; usaha yang tidak pakai kasir tetap bisa langsung mencatat.

### C. Pencatatan Transaksi

**Form utama (urutan field):**
1. **Nominal**: keypad angka besar, format ribuan otomatis (`50000` → `50.000`), tombol cepat `000`.
2. **Kategori**: 6 kategori paling sering dipakai tampil sebagai tombol; sisanya di "Lainnya".
3. **Dibayar pakai**: Tunai (default) / Transfer Bank / QRIS / **Belum Dibayar (Ngutang)**.
4. **Catatan & waktu**: tersembunyi di "Detail". Waktu default = sekarang.

**Edge case yang ditangani:**

1. **Uang pribadi vs usaha.** Ditangani lewat kategori (§2.2), bukan checkbox.
   * Bayar biaya usaha pakai uang dari dompet pribadi → pilih akun "Uang Pribadi" pada *Dibayar pakai*. Sistem mencatat sebagai biaya usaha (masuk Untung) + tambahan modal pribadi otomatis, tanpa mengurangi saldo Laci.
2. **Potongan MDR QRIS / biaya admin.**
   * Persentase MDR diatur **sekali** di Pengaturan (bisa 0%, karena tarif berbeda per jenis merchant & nominal). Tidak ada toggle di setiap transaksi.
   * Saat bayar via QRIS: Jualan = nominal bruto; Biaya Admin QRIS = bruto × MDR (otomatis); Saldo QRIS bertambah = neto.
   * Bisa di-override per transaksi di "Detail" bila potongan aktual berbeda.
3. **Dana QRIS / e-wallet belum cair.**
   * Pembayaran QRIS masuk ke akun *Saldo QRIS / E-Wallet*, bukan Bank.
   * Saat dana cair: `⇄ Pindah Uang` → "Pencairan QRIS" (QRIS → Bank). Aplikasi menyarankan nominal = total saldo QRIS yang belum cair.
   * Dashboard menampilkan "QRIS belum cair: Rp X sejak tanggal Y".
4. **Pembayaran sebagian / bayar kurang** (barang sudah diserahkan).
   * Field "Dibayar sekarang" (default = total). Jika lebih kecil: sisa otomatis menjadi piutang (jualan) atau utang (belanja). Aplikasi wajib meminta nama kontak (bisa ketik baru).
   * Untuk DP atas pesanan yang barangnya **belum** diserahkan, pakai fitur Pesanan (§3.I).
5. **Salah input, retur, dan batal (void).**
   * Transaksi **tidak pernah dihapus atau diubah di tempat**. "Ubah" = sistem membuat transaksi pembalik (void) + transaksi baru, tetap terlihat di riwayat.
   * Void wajib memilih alasan (Salah input / Retur barang / Batal / Lainnya).
   * Retur sebagian: catat sebagai Uang Keluar kategori "Retur Jualan" yang terhubung ke transaksi asal.
   * Kasir hanya bisa void transaksinya sendiri di shift yang masih terbuka; selebihnya hanya pemilik.
6. **Pencatatan susulan (backdate).**
   * Tanggal bisa dimundurkan. Transaksi backdate diberi tanda dan menyimpan waktu input asli.
   * Backdate ke shift yang sudah ditutup memunculkan peringatan bahwa laporan shift tersebut akan berubah.
7. **Anti double-submit.**
   * Tombol simpan nonaktif setelah ditekan sekali.
   * Setiap transaksi punya ID unik yang dibuat di HP, sehingga pengiriman ulang saat sinyal putus-nyambung tidak membuat data dobel di server (idempoten).
   * Peringatan lunak jika ada transaksi identik (nominal + kategori sama) < 60 detik sebelumnya.

### D. Pindah Uang (antar-akun)
Setor tunai ke bank, tarik ATM, pencairan QRIS, pindah antar-rekening. Tidak memengaruhi Untung. Biaya transfer/admin bank opsional dicatat sebagai biaya usaha.

### E. Utang & Piutang
1. **Piutang (Pelanggan Ngutang)**
   * Kontak: nama + nomor WhatsApp (dinormalisasi `08xx` → `628xx`).
   * Jatuh tempo opsional (`Tanpa Jatuh Tempo` untuk tetangga/relasi dekat).
   * Cicilan: riwayat pembayaran per pelanggan; sisa dihitung otomatis; tidak bisa membayar melebihi sisa (kelebihan ditawarkan sebagai "titip/deposit" atau dikembalikan).
   * **Tagih via WA:** 1 tombol membuka WhatsApp (`wa.me`) dengan pesan sopan berisi rincian & sisa tagihan. Template bisa diubah. Tanpa API berbayar.
   * Penghapusan piutang tak tertagih ("Ikhlaskan"): sisa dicatat sebagai biaya *Piutang Tak Tertagih*.
2. **Utang ke Supplier**: belanja kredit + riwayat cicilan, dengan mekanisme yang sama.
3. **Pinjaman usaha (KUR/koperasi/keluarga)**: dicatat sebagai pinjaman, bukan pendapatan; cicilan dipisah pokok & bunga (bunga opsional, default 0).

### F. Laporan & Ekspor
* **Laporan Untung/Rugi:** harian, mingguan, bulanan, custom; dirinci per kategori.
* **Laporan Arus Uang:** saldo awal → masuk → keluar → saldo akhir, per akun (Laci, Bank, QRIS).
* **Laporan Utang-Piutang:** daftar per kontak, umur piutang (belum jatuh tempo / lewat 1–30 / > 30 hari).
* **Laporan Shift:** per kasir, termasuk selisih kas.
* **Ekspor:** PDF (melalui tampilan cetak browser → "Simpan sebagai PDF") dan Excel/CSV, **dibuat di HP/browser** (tidak membebani server). Format siap untuk pengajuan KUR (identitas usaha, periode, ringkasan bulanan).

### G. Usaha, Pengguna & Hak Akses (multi-tenant)
* Satu akun pemilik bisa punya **beberapa usaha** (tenant); pindah usaha lewat menu.
* Peran:
  | Peran | Bisa |
  | --- | --- |
  | **Pemilik** | Semua, termasuk laporan, Untung, void lama, pengaturan, kelola anggota, hapus usaha |
  | **Kasir** | Catat uang masuk/keluar, buka/tutup kasir, catat cicilan piutang, tagih WA. **Tidak** melihat Untung & laporan, tidak bisa void di luar shift sendiri |
* **Menambah kasir tanpa email:** pemilik membuat *kode undangan 6 digit* (berlaku 10 menit, sekali pakai) → HP kasir memasukkan kode → HP terdaftar sebagai perangkat kasir.
* Pemilik bisa mencabut akses perangkat kapan saja (berlaku saat perangkat tersebut sinkron berikutnya).
* PIN 4–6 digit opsional untuk mengunci aplikasi di HP bersama.

### H. Login & Pemulihan Akun (pemilik)
Dua cara masuk, keduanya gratis tanpa layanan pihak ketiga:

1. **Google** (disarankan, 1 ketukan, tidak perlu ingat password).
2. **Email + password.**
   * Tidak ada email verifikasi/reset yang dikirim, karena Cloudflare Email Sending hanya tersedia di paket berbayar. Email dipakai sebagai nama pengguna.
   * Password minimal 8 karakter; ditolak jika termasuk daftar password paling umum (`12345678`, `password`, nama usaha, dsb.).
   * Batas percobaan: 5 kali gagal → jeda 15 menit per email.

**Lupa password** (urutan yang ditawarkan aplikasi):
1. **Dari HP yang masih login**: menu Akun → "Ganti Password" tanpa perlu password lama (cukup PIN/konfirmasi). Paling sering berhasil karena HP utama hampir selalu masih login.
2. **Kode pemulihan**: 12 karakter, ditampilkan sekali saat daftar dengan tombol "Simpan ke Galeri" dan "Kirim ke WhatsApp saya sendiri". Bisa dibuat ulang dari HP yang login.
3. **Masuk dengan Google** jika Google sudah ditautkan ke akun ini.
4. Jika semua gagal: bantuan manual via WhatsApp admin dengan verifikasi pertanyaan data usaha (nama usaha, perkiraan saldo, kontak pelanggan terakhir).

**Aturan keamanan:**
* Akun email+password **tidak pernah otomatis digabung** dengan akun Google yang emailnya sama, karena email di jalur ini tidak terverifikasi. Penautan hanya dari dalam aplikasi saat sudah login.
* Setelah login, aplikasi menyarankan (bukan mewajibkan) menautkan Google sebagai cadangan.

### I. Pesanan & Uang Muka (DP)
Untuk usaha berbasis pesanan (katering, kue, jahit/konveksi, sablon, jasa), hal yang sangat umum di UMKM Indonesia. Tampil otomatis untuk jenis usaha F&B, fashion, dan jasa; bisa diaktifkan manual untuk jenis lain.

* **Terima DP:** `+ Uang Masuk` → kategori "DP Pesanan" → isi nama pelanggan, total harga, tanggal ambil (opsional), catatan pesanan (mis. "50 nasi kotak").
  * Uang Ada bertambah, **Untung belum berubah**, karena barang belum diserahkan.
* **Pesanan selesai/diambil:** 1 ketukan "Selesai" → aplikasi mencatat Jualan sebesar total harga (Untung bertambah saat ini), DP dipotong otomatis, lalu menanyakan pelunasan sisa: dibayar sekarang (tunai/transfer/QRIS) atau jadi piutang.
* **Pesanan batal:** pilih "DP dikembalikan" (Uang Keluar, Untung tidak berubah) atau "DP hangus" (dicatat sebagai Pendapatan Lain).
* **DP tambahan/cicilan** sebelum pesanan selesai dicatat ke pesanan yang sama.
* Dashboard: "Pesanan berjalan: X pesanan, DP diterima Rp Y" + daftar pesanan yang tanggal ambilnya hari ini/besok.
* Pengingat pelanggan via WA (`wa.me`): konfirmasi pesanan & sisa pembayaran.

Alasan desain: jika DP langsung dihitung sebagai jualan, untung bulan ini terlihat besar padahal bahan belum dibeli, lalu bulan berikutnya terlihat rugi. Dengan alur di atas user tetap hanya melakukan "terima DP" dan "selesai", tanpa istilah akuntansi.

### J. Onboarding (< 2 menit, tanpa wajib daftar)
1. Layar pertama: tombol utama **"Mulai Catat"** (tanpa daftar) + tautan kecil "Sudah punya akun? Masuk".
2. Nama usaha + jenis usaha (kelontong/F&B/fashion/jasa/grosir) → preset kategori sesuai jenis.
3. "Ada uang di laci & rekening sekarang?" → saldo awal per akun (boleh dilewati).
4. Langsung ke form transaksi pertama.

### K. Mode Tanpa Daftar & Pindah Data Saat Daftar
**Mode tanpa daftar (mode tamu)**
* Semua fitur pencatatan, utang-piutang, pesanan, laporan, ekspor, dan tagih WA bisa dipakai **tanpa batas waktu**.
* Data hanya tersimpan di HP ini. Tidak ada request ke server, sehingga mode ini **tidak memakai kuota Cloudflare sama sekali**.
* Yang butuh akun: sinkron & backup cloud, memakai di beberapa HP, menambah kasir, dan pindah HP.
* Indikator permanen di dashboard: "Data hanya di HP ini" (kuning).
* **Ajakan daftar** muncul hanya di momen yang relevan, maksimal 1× per hari, dan bisa ditutup:
  * setelah 20 transaksi pertama dan setelah 7 hari pemakaian;
  * saat ekspor laporan ("Biar data aman walau HP hilang, simpan juga di cloud");
  * saat mencoba menambah kasir atau membuka di HP kedua;
  * di iPhone/Safari: lebih tegas, karena data PWA bisa dihapus Safari jika tidak dibuka ±7 hari.

**Daftar di tengah jalan & membawa data**
1. User memilih Daftar/Masuk (Google atau email+password).
2. Jika di HP ada data mode tamu, muncul layar: **"Bawa data yang sudah kamu catat?"** berisi ringkasan: nama usaha, jumlah transaksi, tanggal pertama–terakhir, jumlah kontak & pesanan.
3. Pilihan:
   * **Akun baru:**
     * "Ya, bawa semua" (default) → data tamu menjadi usaha pertama di akun.
     * "Mulai dari kosong" → konfirmasi dua kali + tawaran "Ekspor dulu ke Excel" sebelum data tamu dihapus dari HP.
   * **Akun yang sudah punya usaha:**
     * "Jadikan usaha baru" (default, paling aman) → data tamu menjadi usaha terpisah di akun.
     * "Gabung ke usaha [nama]" → akun uang & kategori dicocokkan berdasarkan nama (yang tidak cocok dibuat baru). Transaksi saldo awal dari mode tamu **tidak ikut** agar saldo tidak dobel; aplikasi menunjukkan selisih saldo per akun dan menawarkan koreksi.
     * "Jangan bawa" → sama seperti "Mulai dari kosong".
4. Proses unggah berjalan di background dengan progres ("Mengunggah 1.200 dari 7.200 transaksi"). Aplikasi tetap bisa dipakai selama proses berjalan, dan data lokal tidak dihapus sebelum server mengonfirmasi semua data diterima.

**Aturan teknis:**
* Data mode tamu sejak awal memakai struktur yang sama dengan data akun (ID ULID dibuat di HP), sehingga pindah data = mengirim outbox yang sudah ada, tanpa konversi.
* `tenant_id` di data tamu hanyalah ID lokal. Saat diunggah, server **selalu** memakai `tenant_id` dari token sesi dan tidak pernah menerima `tenant_id` dari klien (§5.3).
* Unggah data tamu dikecualikan dari kuota 300 transaksi/hari per usaha, tapi tetap tunduk pada anggaran tulis harian global. Jika anggaran hari itu menipis, unggahan otomatis dilanjutkan esok hari. Batas sekali unggah: 50.000 transaksi; di atas itu dilanjutkan bertahap.
* Unggah bersifat idempoten (lihat §6.3), sehingga jika sinyal putus di tengah jalan, proses dilanjutkan tanpa data dobel.
* Hanya satu proses pindah data per HP; HP lain yang juga menyimpan data tamu memunculkan pilihan yang sama secara terpisah.

---

## 4. User Flow

```
[Buka Aplikasi] ──(offline pun bisa, tanpa wajib daftar)
       │
       ├──► [Daftar/Masuk] kapan saja ─► "Bawa data yang sudah dicatat?" ─► unggah di background
       │
       ├──► [Buka Kasir] hitung uang laci (opsional)
       │
       ├──► Dashboard: Untung hari ini │ Uang Ada per akun │ Piutang/Utang
       │
       ├──► [+ Uang Masuk] ─► Nominal ─► Kategori ─► Dibayar pakai ─► Simpan
       │        └─ Detail: dibayar sebagian (sisa → piutang), MDR override, backdate, catatan
       │
       ├──► [− Uang Keluar] ─► Nominal ─► Kategori ─► Dibayar pakai ─► Simpan
       │        └─ Detail: pakai uang pribadi, belum dibayar (utang), backdate
       │
       ├──► [⇄ Pindah Uang] ─► Dari akun ─► Ke akun ─► Nominal (Setor bank / Pencairan QRIS)
       │
       ├──► Pesanan ─► Terima DP ─► … ─► [Selesai] ─► lunasi sisa / jadi piutang (atau Batal)
       │
       ├──► Utang/Piutang ─► Kontak ─► Catat cicilan / Tagih via WA / Ikhlaskan
       │
       └──► [Tutup Kasir] hitung fisik ─► selisih tercatat ─► setor / sisakan kembalian
```

---

## 5. Kebutuhan Non-Fungsional

### 5.1 Offline-First & Sinkronisasi
* Seluruh fitur pencatatan, utang-piutang, dan laporan berjalan **tanpa internet** (data lokal di IndexedDB).
* Sinkronisasi otomatis saat online, di background, tanpa tombol.
* **Transaksi bersifat append-only** (void = transaksi pembalik), sehingga data dari banyak HP tidak pernah bentrok. Data master (kontak, kategori, pengaturan) memakai *last-write-wins* per field berdasarkan waktu server.
* Meminta `navigator.storage.persist()` agar data lokal tidak dihapus browser. Peringatan keras jika ada data belum tersinkron > 24 jam.
* iOS/Safari: wajib diarahkan "Tambahkan ke Layar Utama" karena data PWA yang tidak di-install bisa dihapus Safari setelah ±7 hari tidak dibuka.
* Jam HP salah: server menyimpan waktu terima; selisih > 1 hari dari jam server diberi tanda di riwayat.

### 5.2 Performa & Ukuran
* PWA, bundle awal ≤ 200 KB gzip; library ekspor (Excel) di-*lazy load*.
* Lancar di Android entry-level (RAM 2 GB, Chrome versi 2 tahun terakhir).
* Distribusi **hanya PWA** (install lewat "Tambahkan ke Layar Utama"), tidak lewat Play Store. Halaman depan menampilkan panduan install bergambar untuk Chrome Android & Safari iOS, serta tombol install otomatis (`beforeinstallprompt`) di Android.

### 5.3 Keamanan & Isolasi Tenant
* `tenant_id` **selalu diambil dari token sesi di server**, tidak pernah dari body/parameter request.
* Semua tabel tenant memakai primary key `(tenant_id, id)`; semua query lewat satu lapisan repository yang mewajibkan `tenant_id`.
* Test otomatis wajib: akses data tenant lain → 404.
* Anti-bot pendaftaran: Cloudflare Turnstile (gratis).
* Kuota wajar per tenant (maks 300 transaksi/hari) agar satu tenant tidak menghabiskan kuota bersama. Transaksi di atas kuota tetap tersimpan di HP dan disinkron keesokan harinya.
* Password: di-hash di HP dengan PBKDF2-SHA256 (≥ 600.000 iterasi, salt per user), server hanya menyimpan SHA-256 dari hasil tersebut. Hashing berat dilakukan di HP karena batas CPU Worker gratis 10 ms/request tidak cukup untuk hashing password yang aman. Untuk email yang tidak terdaftar, server tetap mengembalikan salt palsu yang konsisten agar tidak bisa dipakai menebak email terdaftar.
* Rate limit login: dicatat di D1 per email (5 gagal → kunci 15 menit) + Turnstile setelah 3 kali gagal.

### 5.4 Data & Privasi
* Backup server: D1 Time Travel (point-in-time recovery 7 hari di free plan). Tidak ada salinan ke R2 (R2 tidak dipakai, §6.1).
* Backup oleh user: ekspor Excel/CSV kapan saja; pengingat ekspor bulanan.
* Kepatuhan UU PDP (UU 27/2022): kebijakan privasi, data kontak pelanggan hanya dipakai untuk penagihan, fitur **hapus usaha & semua data** oleh pemilik.

### 5.5 Bahasa & UX
* Istilah sehari-hari: *Uang Masuk, Uang Keluar, Untung, Uang Ada, Pelanggan Ngutang, Modal Kembalian, Ambil untuk Pribadi*. Tidak ada kata debit/kredit/jurnal/akrual.
* Tombol minimal 48 px; angka nominal besar & kontras tinggi; bisa dipakai satu tangan.

---

## 6. Arsitektur Teknis (Cloudflare, Rp0)

### 6.1 Komponen
| Kebutuhan | Pilihan | Alasan |
| --- | --- | --- |
| Frontend | PWA (Preact + Vite) disajikan lewat **Workers Static Assets** | Request ke file statis tidak memakan kuota request Worker |
| API | **1 Worker** (Hono), rute `/api/*` | 100.000 request/hari, CPU 10 ms/request di free plan |
| Database | **D1** (SQLite), shared schema + kolom `tenant_id` | DB-per-tenant tidak mungkin di free plan (maks 10 database) |
| Penyimpanan lokal | IndexedDB (Dexie) + outbox | Offline-first |
| Auth pemilik | Google Sign-In (OIDC), verifikasi ID token di Worker via WebCrypto; **atau** email + password (hash di klien, §5.3) | Gratis. OTP SMS/WA dan pengiriman email (Cloudflare Email Sending hanya di paket Paid) berbayar sehingga **tidak dipakai** |
| Auth kasir | Kode undangan → token perangkat | Kasir tidak perlu email |
| Sesi | Token bertanda tangan HMAC (stateless) + cek `devices.revoked_at` saat sinkron | Tanpa KV (KV free hanya 1.000 write/hari) |
| Job terjadwal | Cron Trigger (maks 5 per akun) | Pantau kapasitas (§6.5), bersih-bersih kode undangan kedaluwarsa |
| Anti-bot | Turnstile | Gratis |
| Domain | Subdomain `bukulapak.solusikoding.com` (Workers Custom Domain) | Memakai domain yang sudah dimiliki, tanpa biaya tambahan. Syarat: zona `solusikoding.com` dikelola di Cloudflare (DNS di Cloudflare, plan Free cukup). Domain dipakai sejak hari pertama karena PWA & data lokal terikat ke origin; pindah domain nanti berarti user install ulang |
| Penyimpanan file | **Tidak memakai R2** | R2 mewajibkan kartu pembayaran terdaftar; semua ekspor dibuat di HP user |

### 6.2 Model Data (inti)
**Server (D1)**: tabel kontrol + satu tabel data generik.
```
tenants        (id, name, business_type, shard, migrate_until, created_at, deleted_at)
users          (id, name, email?, google_sub?, google_email?, pw_salt?, pw_verifier?, recovery_verifier?,
                failed_logins, locked_until?)
memberships    (user_id, tenant_id, role)              -- owner | cashier
devices        (id, user_id?, tenant_id?, role, label, last_sync_at, revoked_at)
invites        (code_hash, tenant_id, role, created_by, expires_at)
records        (seq, tenant_id, id, type, data JSON, received_at)
                                                       -- type: settings | account | category | contact
                                                       --       | entry | debt | order | shift
usage          (tenant_id, day, entries)               -- kuota harian per usaha
system         (key, value)                            -- status pendaftaran, ukuran shard
```
**Isi `records.data`** (sama persis dengan yang disimpan di HP):
```
settings   (name, businessType, tz, mdr, ordersEnabled, shiftEnabled, waTemplate, waOrderTemplate)
account    (name, kind: cash|bank|qris, archived, sort)
category   (name, kind: income|expense|personal|loan|asset|deposit, dir: in|out, sys?, hidden?)
contact    (name, phone?, role: customer|supplier|lender)
debt       (contactId, dir: recv|pay|loan, dueDate?, note?)
order      (contactId, total, pickupDate?, note, status: open|done|cancelled)
shift      (device, by, openedAt, openingCount, closedAt?, closingCount?, expected?, diff?)
entry      (kind, at, createdAt, by, device, amount, lines[], catId?, accountId?, toAccountId?,
            contactId?, debtId?, orderId?, shiftId?, reverses?, voidReason?, note?, backdated?)
```
* **`entry.lines`** adalah pembukuan berpasangan tersembunyi: daftar `[kunci, nominal]` yang totalnya selalu 0. Kunci: `a:` akun uang, `p:` kategori untung/rugi, `e` uang pribadi pemilik, `r:` piutang, `u:` utang, `l:` pinjaman, `s:` aset, `d:` DP pesanan. Untung, saldo, sisa utang-piutang, dan DP yang ditahan semuanya hanya penjumlahan baris ini. User tidak pernah melihat istilah debit/kredit.
* Batal (void) = entry baru berisi baris yang dibalik, dengan tanggal transaksi asli, sehingga laporan periode itu ikut terkoreksi.
* `id` = ULID dibuat di klien. Entry bersifat idempoten dan tidak bisa ditimpa (`INSERT OR IGNORE`); data lain *last-write-wins*.
* `seq` = urutan global server, dipakai sebagai kursor tarik data: indeks `(tenant_id, seq)`.
* Saldo, sisa utang/piutang, dan laporan **dihitung di klien** dari data lokal; server hanya menyimpan & meneruskan.
* Indeks dibuat seminim mungkin, karena di D1 setiap indeks menambah *rows written*.

### 6.3 Protokol Sinkronisasi
* `POST /api/sync/push`: maksimal 200 operasi per request, dikirim sebagai satu parameter JSON lalu di-insert dengan `json_each(?)` dalam **satu statement** (batas free: 50 query/invocation, 100 parameter/query).
* `GET /api/sync/pull?since=<seq>`: maksimal 500 baris per halaman.
* Frekuensi: saat ada perubahan (debounce 10 detik), saat aplikasi dibuka, dan saat kembali online. Tanpa polling terus-menerus.
* Jika server menolak karena kuota harian Cloudflare habis: data tetap aman di HP, dicoba lagi setelah 00:00 UTC (07:00 WIB). User tidak melihat error, hanya status "Belum sinkron".

### 6.4 Anggaran Kapasitas Free Tier
Batas resmi (dicek Okt 2026): Workers 100k request/hari & CPU 10 ms/request; D1 5 juta rows read/hari, 100k rows written/hari, 500 MB per database, 5 GB total, maks 10 database.

| Sumber daya | Asumsi per tenant aktif/hari | Batas | Kapasitas ≈ |
| --- | --- | --- | --- |
| Rows written | 40 transaksi × ~3 (baris + 2 indeks) = 120 | 100.000 | **~800 tenant aktif/hari** |
| Request Worker | ~2 perangkat × ~30 sync = 60 | 100.000 | ~1.600 tenant |
| Penyimpanan | ~400 byte × 40 × 365 ≈ 6 MB/tahun | 500 MB/DB, 5 GB total | ~80 tenant-tahun/DB; ~800 tenant-tahun total |

**Konsekuensi desain:**
* **Sharding sejak awal:** tenant dibagi ke beberapa database D1 (kolom `tenants.shard`; 1 DB kecil untuk direktori tenant + hingga 9 DB data). Pindah shard tidak perlu mengubah kode aplikasi.
* Batas pertama yang akan tercapai adalah *rows written* (harian) dan *storage* (jangka panjang).

### 6.5 Kebijakan "Gratis Selamanya"
Karena tidak ada pemasukan, aplikasi harus menjaga dirinya sendiri tetap di dalam free tier:

| Pemicu (dipantau harian oleh Cron) | Tindakan otomatis |
| --- | --- |
| Rows written > 70% kuota harian, 3 hari berturut-turut | Pendaftaran usaha baru masuk **daftar tunggu** (tenant lama tidak terganggu) |
| Storage total > 80% | Pendaftaran baru ditutup sementara (tenant lama tidak terganggu) |
| Satu tenant > kuota 300 transaksi/hari | Sinkron tenant tersebut ditunda ke hari berikutnya; data aman di HP |

* **Tenant tidak aktif** (tidak ada sinkron > 18 bulan): data tetap disimpan di D1, tanpa arsip ke R2. Saat pemilik login lagi, aplikasi menampilkan ajakan "Ekspor datamu". Penghapusan data tenant tidak aktif **tidak dilakukan otomatis**; jika storage benar-benar kritis, kebijakannya diputuskan terpisah dan diumumkan di halaman status jauh hari sebelumnya.
* Pemilik selalu bisa mengekspor seluruh datanya kapan saja (tidak terkunci di platform).
* Halaman status publik kecil: "Kapasitas pendaftaran: tersedia / daftar tunggu", agar ekspektasi pengguna jelas.
* Jika suatu saat kapasitas gratis tidak lagi cukup, Workers Paid ($5/bulan) memakai arsitektur yang sama persis tanpa rewrite. Ini keputusan pengelola aplikasi, bukan beban pengguna.

---

## 7. Roadmap

| Fase | Fokus | Fitur |
| --- | --- | --- |
| **Fase 1 (MVP)** | Angka benar sejak hari pertama | Fondasi multi-tenant (tenant, login Google & email+password dengan kode pemulihan, isolasi data), mode tanpa daftar + pindah data saat daftar, PWA offline + sync, Dashboard, Akun Uang, Uang Masuk/Keluar dengan kategori berjenis (termasuk Prive & Tambah Modal), Pindah Uang, MDR QRIS otomatis, backdate, void/ubah, Piutang & Utang dasar (catat + cicilan + tagih WA), Pesanan & DP, Laporan Untung/Rugi & Arus Uang |
| **Fase 2** | Operasional toko | Peran Kasir + kode undangan perangkat, Buka/Tutup Kasir & selisih kas, QRIS belum cair & pencairan, jatuh tempo & umur piutang, pinjaman usaha, PIN aplikasi, ekspor Excel/CSV & PDF |
| **Fase 3** | Skala & kepercayaan | Banyak usaha per pemilik, format laporan KUR, backup terjadwal, kebijakan gratis selamanya (§6.5: daftar tunggu, halaman status), hapus akun (UU PDP) |

---

## 8. Keputusan Produk
| # | Pertanyaan | Keputusan |
| --- | --- | --- |
| 1 | Model bisnis | **Gratis untuk semua pengguna**, tanpa paket berbayar. Kapasitas dijaga oleh kebijakan §6.5 |
| 2 | Cara login | **Google atau email + password.** Tanpa pengiriman email (berbayar di Cloudflare); pemulihan lewat HP yang login, kode pemulihan, atau Google tertaut (§3.H) |
| 3 | DP pesanan yang barangnya belum diserahkan | **Fitur Pesanan** (§3.I): DP tidak dihitung untung sampai pesanan selesai; user hanya melakukan "Terima DP" dan "Selesai" |
| 4 | Arsip tenant tidak aktif ke R2 | **Tidak memakai R2** (tidak perlu daftar kartu). Data tetap di D1; kapasitas dijaga lewat daftar tunggu (§6.5) |
| 5 | Domain | **Subdomain `bukulapak.solusikoding.com`** sejak awal |
| 6 | Distribusi | **PWA saja**, tanpa Play Store |
| 7 | Fase fitur Pesanan & DP | **MVP (Fase 1)** |
| 8 | Bantuan jika semua cara pemulihan gagal | **Bantuan manual via WhatsApp admin** dengan verifikasi data usaha |
| 9 | Kuota transaksi per usaha | **300 transaksi/hari** |
| 10 | Pakai tanpa daftar | **Boleh, tanpa batas waktu**, hanya pengingat di momen relevan; saat daftar ada pilihan membawa data (§3.K) |

---

## Lampiran A — Perubahan dari v1

| Area | v1 | v2 | Alasan |
| --- | --- | --- | --- |
| Platform | APK Android < 15 MB, backup Google Drive | PWA saja di `bukulapak.solusikoding.com`, sinkron ke D1 | Sesuai stack Cloudflare gratis; tanpa biaya Play Console |
| Multi-tenant | Tidak ada; multi-user di Fase 3 | Fondasi tenant & isolasi data di MVP | Skema yang tidak ber-`tenant_id` sejak awal mahal untuk dimigrasi |
| Prive / uang pribadi | Checkbox, di Fase 2 | Jenis kategori, di MVP | Pencampuran uang pribadi adalah masalah #1; tanpa ini Laba/Rugi MVP salah |
| Pinjaman & beli aset | Tidak ada | Kategori non-usaha | Pinjaman KUR masuk sebagai "pendapatan" akan memalsukan untung |
| Setor bank / pindah akun | Tidak ada | Fitur Pindah Uang | Setor tunai ke bank tercatat sebagai keluar/masuk sehingga merusak laporan |
| MDR QRIS | Toggle tiap transaksi | Diatur sekali, otomatis | Lebih cepat & konsisten; tarif MDR berbeda per merchant |
| Settlement QRIS | Status per transaksi | Akun "Saldo QRIS" + Pencairan | Rekonsiliasi cukup membandingkan saldo, tidak perlu menandai satu per satu |
| Modal awal laci | Hanya buka shift | Buka + Tutup Kasir + selisih | Uang laci kurang/lebih adalah masalah harian yang sebelumnya tidak tertangkap |
| Utang-piutang | Fase 2 | Dasar di MVP | "Utang/Piutang" sudah ada sebagai metode bayar di form MVP v1 sehingga tidak konsisten |
| Void | Fase 2 | MVP + "Ubah" = void + baru | User awam sering salah input; audit trail wajib sejak awal |
| Definisi laba | Tidak dijelaskan | Untung vs Uang Ada didefinisikan (§2.3) | Menghindari angka yang membingungkan user |
| Login | "Sync via nomor HP / Akun Google" | Google atau email+password, kode undangan untuk kasir | OTP via SMS/WA dan pengiriman email berbayar |
| Mulai pakai | Tidak dijelaskan | Bisa langsung tanpa daftar; data dibawa saat daftar | Menghilangkan hambatan terbesar di awal; mode tamu tidak memakai kuota server |
| DP | Hanya "DP / Pembayaran Sebagian" | Dipisah: bayar sebagian (barang sudah diserahkan) vs Pesanan & DP (belum diserahkan) | DP pesanan yang dihitung jualan membuat untung naik-turun palsu |
| Model bisnis | Tidak disebut | Gratis selamanya + kebijakan kapasitas | Free tier terbatas; harus dijaga otomatis |
| Auto-backup lokal harian | Ada | Diganti ekspor manual + D1 Time Travel | PWA tidak bisa menulis file backup diam-diam |
| Lain-lain | — | Success metrics, non-goals, anggaran kapasitas, UU PDP, zona waktu, idempotensi | Kelengkapan PRD |
