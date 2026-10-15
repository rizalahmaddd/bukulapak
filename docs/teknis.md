# Dokumentasi Teknis

Dokumentasi arsitektur, mesin akuntansi (*double-entry ledger*), penyimpanan offline-first, sinkronisasi real-time, dan panduan pengembangan **BukuLapak**.

---

## 1. Arsitektur Offline-First & Hybrid Cloud

BukuLapak menggunakan pendekatan **Offline-First**. Seluruh transaksi dan perhitungan pembukuan dilakukan secara instan di perangkat pengguna menggunakan IndexedDB. Sinkronisasi ke cloud berjalan di latar belakang secara asinkron ketika perangkat terhubung ke internet.

```
┌────────────────────────────────────────────────────────────────────────┐
│                        UI (Preact + Signals)                           │
│     Kasir · Transaksi · Hutang/Piutang · Shift · Laporan · Pengaturan  │
└───────────────────────────────────┬────────────────────────────────────┘
                                    │
       ┌────────────────────────────┴───────────────────────────┐
       ▼                                                        ▼
┌───────────────────────────────┐               ┌───────────────────────────────┐
│     Mesin Akuntansi Lokal     │               │   Penyimpanan Lokal (IDB)     │
│   Append-Only Double Entry    │◄─────────────►│  IndexedDB + Antrean Outbox   │
│   Laba/Rugi, Arus Kas, Neraca │               │   Bekerja 100% saat offline   │
└───────────────────────────────┘               └───────────────┬───────────────┘
                                                                │ Sync Engine
                                                                ▼ (Push / Pull)
┌───────────────────────────────────────────────────────────────────────────────┐
│                     Cloudflare Workers (Edge Server)                          │
│                                                                               │
│   ┌───────────────────────────┐               ┌───────────────────────────┐   │
│   │     Hono REST API         │               │ Durable Objects (Live DO) │   │
│   │   Auth, Session, Shard,   │               │   WebSocket Multi-Device  │   │
│   │    Sync Push/Pull         │               │     Realtime Broadcast    │   │
│   └─────────────┬─────────────┘               └─────────────┬─────────────┘   │
└─────────────────┼───────────────────────────────────────────┼─────────────────┘
                  ▼                                           ▼
┌───────────────────────────────────────────────────────────────────────────────┐
│                     Cloudflare D1 (Sharded SQLite DB)                         │
│           DB (Shard 0)  ·  DB_SHARD_1  ·  ...  ·  DB_SHARD_9                  │
└───────────────────────────────────────────────────────────────────────────────┘
```

---

## 2. Peta Modul & Struktur Kode

| Direktori / Modul | Lokasi | Peran & Fungsi |
|---|---|---|
| **Domain Akuntansi** | `src/domain/ledger.ts` | Inti logika pembukuan: perakitan transaksi berimbang (*balanced lines*), kalkulasi saldo, laba/rugi, arus kas, dan pembatalan (*void*). |
| **Laporan & Ringkasan** | `src/domain/reports.ts` | Agregasi data laporan keuangan harian, bulanan, piutang, dan ringkasan mutasi. |
| **Preset Standar** | `src/domain/presets.ts` | Konfigurasi bawaan Bagan Akun (*Chart of Accounts*) dan kategori untuk UMKM/warung Indonesia. |
| **Tipe Data** | `src/domain/types.ts` | Definisi TypeScript untuk transaksi, akun, kontak, hutang, pesanan, dan shift. |
| **Penyimpanan Lokal** | `src/store/idb.ts` | Skema IndexedDB lokal, indeks pencarian, dan antrean *outbox*. |
| **Mesin Sinkronisasi** | `src/store/sync.ts` | Pengelola sinkronisasi push & pull berbasis cursor urutan monotonik (`seq`). |
| **Koneksi Real-time** | `src/store/live.ts` | Klien WebSocket untuk pembaruan instan multi-perangkat via Durable Objects. |
| **Sesi & Autentikasi** | `src/store/session.ts` | Pengelolaan token sesi JWT, alur login/register PBKDF2, dan alur kode kasir. |
| **Klien HTTP** | `src/store/api.ts` | Wrapper pemanggilan REST API ke Cloudflare Workers dengan penanganan offline. |
| **Halaman & Layar** | `src/pages/` | Layar antarmuka: Kasir Cepat (`TxForm`), Kasir Sederhana, Laporan, Hutang, Shift, Riwayat, dan Pengaturan. |
| **Komponen UI** | `src/ui/` | Router, sistem PIN lock, modal konfirmasi, indikator status sync, dan prompt install PWA. |
| **Ekspor Data** | `src/export/` | Generator laporan PDF, Excel (XLSX), dan CSV di sisi browser (*lazy-loaded*). |
| **Edge API Worker** | `worker/` | Endpoint Hono: autentikasi PBKDF2, manajemen sharding D1, sync API, dan Durable Object WebSocket. |
| **Skema Basis Data** | `migrations/` | Skema SQL D1 untuk multi-tenant SQLite database. |
| **Pengujian** | `test/` | Unit test vitest untuk integritas mesin akuntansi dan end-to-end API. |

---

## 3. Sistem Double-Entry Ledger (Mesin Akuntansi Tersembunyi)

BukuLapak menyederhanakan pembukuan bagi pemilik warung tanpa mengorbankan integritas akuntansi. Di balik formulir sederhana (pemasukan, pengeluaran, catat hutang), sistem mencatat setiap transaksi ke dalam entri *immutable append-only* yang berimbang (*zero-sum balance*).

### Format Garis Saldo (Balanced Lines)

Setiap transaksi memuat baris-baris berformat `[kunci, jumlah]`. Jumlah total dari semua baris dalam satu entri **wajib berjumlah tepat 0**.

Awalan (*prefix*) kunci menentukan kategori akuntansi:

| Prefix | Arti Akuntansi | Kategori Umum | Sifat Laba/Rugi |
|---|---|---|---|
| `a:` | **Akun Kas / Bank / E-Wallet** | Kas Tunai, BCA, BRI, GoPay, ShopeePay | Netral (Aset Lancar) |
| `p:` | **Pos Laba & Rugi** | Penjualan, Biaya Kulakan (HPP), Listrik, Sewa | Memengaruhi Laba/Rugi |
| `e` | **Ekuitas Pemilik** | Modal Awal, Penambahan Modal, Tarik Tunai Pribadi (*Prive*) | Netral terhadap Laba/Rugi |
| `r:` | **Piutang Usaha** (*Receivables*) | Pelanggan belum bayar / Kasbon | Netral (Aset Lancar) |
| `u:` | **Hutang Usaha** (*Payables*) | Belanja barang ke supplier belum lunas | Netral (Kewajiban) |
| `l:` | **Pinjaman** (*Loans*) | Pinjaman bank, pinjaman pihak ketiga | Netral (Kewajiban) |
| `s:` | **Aset Tetap** (*Fixed Assets*) | Pembelian etalase, kulkas, peralatan toko | Netral (Kapitalisasi Aset) |
| `d:` | **Uang Muka / Titipan Pesanan** (*Deposits*) | DP pesanan barang dari pelanggan | Belum menjadi laba sampai pesanan tuntas |

### Contoh Aliran Jurnal Otomatis

1. **Penjualan Tunai Rp 50.000:**
   - Kas bertambah: `['a:cash', 50000]`
   - Pendapatan bertambah (kredit): `['p:sales', -50000]`
   - Total balance: `50000 + (-50000) = 0`

2. **Penjualan QRIS Rp 100.000 dengan MDR 0,7% (Rp 700):**
   - E-Wallet masuk bersih: `['a:qris', 99300]`
   - Beban biaya MDR: `['p:mdr_fee', 700]`
   - Pendapatan penjualan: `['p:sales', -100000]`
   - Total balance: `99300 + 700 + (-100000) = 0`

3. **Penjualan Bon / Piutang Sebagian (Total Rp 100.000, Bayar Tunai Rp 30.000, Hutang Rp 70.000):**
   - Kas diterima: `['a:cash', 30000]`
   - Piutang dicatat atas nama pelanggan: `['r:contact_123', 70000]`
   - Pendapatan diakui penuh: `['p:sales', -100000]`
   - Laba tercatat seketika, namun arus kas hanya bertambah Rp 30.000.

4. **Pembatalan Transaksi (*Void*):**
   - Transaksi asli tidak pernah dihapus dari basis data.
   - Sistem menerbitkan entri pembalik dengan jumlah yang dinegasikan pada tanggal transaksi yang sama:
     - `['a:cash', -50000]`
     - `['p:sales', 50000]`
   - Hal ini menjaga jejak audit (*audit trail*) tetap utuh dan laporan periode sebelumnya tidak terdistorsi.

---

## 4. Penyimpanan Lokal (IndexedDB) & Manajemen Outbox

Aplikasi menggunakan IndexedDB tingkat rendah yang cepat dan efisien tanpa dependensi ORM berat:

- **Tabel Lokal:**
  - `entries`: Seluruh entri pembukuan double-entry.
  - `accounts`: Rekening kas, bank, dan dompet digital.
  - `categories`: Kategori laba rugi.
  - `contacts`: Daftar pelanggan dan pemasok.
  - `debts`: Catatan piutang dan hutang dengan status pelunasan.
  - `orders`: Pesanan ber-DP / titipan.
  - `shifts`: Sesi pembukaan dan penutupan kasir beserta pencatatan selisih kas fisik.
  - `settings`: Konfigurasi toko, PIN, dan profil.
  - `outbox`: Antrean perubahan lokal yang belum terkirim ke server.
- **Identifikasi Record (ULID):** Setiap data menggunakan Universally Unique Lexicographically Sortable Identifier (ULID), sehingga urutan data dapat diurutkan secara kronologis langsung dari ID tanpa konflik antar perangkat.
- **Pencadangan Mandiri:** Fitur ekspor basis data lokal ke format JSON yang dapat diimpor kembali secara aman ke perangkat baru.

---

## 5. Sinkronisasi Real-Time & Multi-Perangkat

Sinkronisasi awan dirancang untuk keandalan jaringan yang fluktuatif di Indonesia:

1. **Push Batch (`POST /api/sync/push`):**
   - Mengirim hingga 200 data sekaligus dalam satu payload JSON dari antrean *outbox*.
   - Tabel `entries` bersifat *append-only* dan menggunakan klausa `INSERT OR IGNORE` di D1 SQLite, menjadikannya sepenuhnya idempoten.
   - Master data (kontak, akun, shift) menggunakan strategi *last-write-wins* berbasis stempel waktu perubahan.
2. **Pull dengan Monotonic Cursor (`GET /api/sync/pull?since=<seq>`):**
   - Setiap mutasi yang diterima server mendapat nomor urut sekuensial monotonik (`seq`).
   - Perangkat klien meminta pembaruan data sejak nomor urut terakhir yang diterimanya, memastikan tidak ada data yang terlewat.
3. **Pemberitahuan Instan (Cloudflare Durable Objects):**
   - Saat satu perangkat (misal kasir) melakukan push data, Durable Object `TenantLive` menerima notifikasi dan menyiarkan sinyal sinkronisasi ke seluruh koneksi WebSocket aktif di bawah toko/tenant tersebut.
   - Perangkat lain langsung menarik data terbaru secara otomatis tanpa jeda *polling*.
4. **Sistem Peran Kasir & Perangkat:**
   - **Pemilik (*Owner*):** Memiliki akses ke pengaturan keuangan, bagan akun, laba/rugi, dan neraca.
   - **Kasir (*Cashier*):** Bergabung ke toko menggunakan kode 6 digit yang diterbitkan pemilik. Dibatasi pada pencatatan transaksi kasir harian dan pembukaan/penutupan shift tanpa akses ke laporan laba rugi menyeluruh.

---

## 6. Keamanan, Autentikasi & Privasi

- **Derivasi Kata Sandi PBKDF2 di Sisi Klien:**
  - Password pengguna di-hash di browser menggunakan PBKDF2 (100.000 iterasi) dengan salt kriptografis unik sebelum dikirim ke API.
  - Server Cloudflare Workers tidak pernah menerima atau menyimpan kata sandi mentah pengguna.
- **Token Sesi HMAC-SHA256:**
  - Sesi diautentikasi dengan token yang ditandatangani menggunakan `SESSION_SECRET` di edge runtime Cloudflare.
  - Token memuat identitas pengguna (`u`), ID tenant (`t`), peran (`r`), dan masa kedaluwarsa (`exp`).
- **Isolasi Data Antar Tenant:**
  - ID tenant selalu diekstrak dari token sesi kriptografis terverifikasi, bukan dari parameter body atau URL yang bisa dipalsukan.
- **Perlindungan Terhadap Bot & Brute Force:**
  - Endpoint publik dilindungi oleh rate limiter Cloudflare `AUTH_LIMIT` (maksimal 20 permintaan per menit per alamat IP).
  - Dukungan Cloudflare Turnstile opsional untuk pendaftaran akun baru.

---

## 7. Skalabilitas & Sharding Database

BukuLapak dirancang untuk dapat berjalan di atas Cloudflare Free Tier dengan efisiensi maksimal:

- **Horizontal Sharding D1:**
  - Data tenant dapat dibagi ke beberapa basis data Cloudflare D1 (`DB`, `DB_SHARD_1`, ..., `DB_SHARD_9`).
  - Tenant baru dialokasikan ke shard yang memiliki kapasitas paling longgar.
- **Cron Pemantauan Sistem (`worker/system.ts`):**
  - Cron harian mengecek volume dan penggunaan kuota masing-masing shard (batas aman 80% dari kuota 500 MB per database D1).
  - Jika kuota tulis harian melebihi 70% selama 3 hari berturut-turut, pendaftaran otomatis dialihkan ke mode antrean tunggu (*waitlist*) untuk melindungi integritas layanan yang sudah aktif.

---

## 8. PWA, Service Worker & Android Native

- **PWA (Progressive Web App):**
  - Dilengkapi Service Worker yang mem-precache aset statis UI, stylesheet, dan font.
  - Dapat dipasang (*Install to Homescreen*) di Android, iOS, Windows, dan macOS.
- **Aplikasi Android Native (Capacitor):**
  - Proyek menyertakan konfigurasi Capacitor Android di direktori `android/`.
  - Dukungan build APK debug dan AAB (Android App Bundle) untuk distribusi internal atau Google Play Store:
    ```bash
    npm run apk:build   # Menghasilkan APK Debug
    npm run aab:build   # Menghasilkan bundle rilis AAB
    ```

---

## 9. Panduan Build & Deploy

### Kebutuhan Lingkungan

- Node.js versi 22 atau lebih baru
- NPM
- Akun Cloudflare (untuk deployment Worker & D1)

### Perintah Pengembangan

```bash
# 1. Pasang dependensi
npm install

# 2. Terapkan migrasi basis data D1 lokal
npm run db:migrate:local

# 3. Jalankan unit test mesin akuntansi
npm test

# 4. Jalankan aplikasi di browser (development server)
npm run dev

# 5. Jalankan edge worker lokal
npm run dev:worker
```

### Deployment ke Cloudflare Workers & D1

1. Buat basis data D1 produksi:
   ```bash
   npx wrangler d1 create bukulapak
   ```
2. Salin `database_id` yang dihasilkan ke dalam file `wrangler.jsonc`.
3. Terapkan migrasi ke D1 remote:
   ```bash
   npm run db:migrate:remote
   ```
4. Tambahkan secret wajib di Cloudflare Workers:
   ```bash
   npx wrangler secret put SESSION_SECRET
   ```
5. Deploy aplikasi web dan backend worker:
   ```bash
   npm run deploy
   ```

### Pencadangan Basis Data Produksi

D1 Time Travel pada paket gratis Cloudflare memiliki retensi terbatas. Lakukan ekspor cadangan rutin menggunakan perintah:

```bash
npm run db:backup
```

File SQL cadangan akan tersimpan di direktori `backups/` dengan penanda waktu.
