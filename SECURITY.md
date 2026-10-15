# Security Policy

## Offline-First Data & Privacy Guarantee

**BukuLapak** dirancang dengan prinsip privasi dan ketahanan data (*offline-first*):

- **Data Tersimpan Lokal di Perangkat:** Seluruh data transaksi, akun kas/bank, kategori, hutang/piutang, kontak pelanggan, dan shift kasir disimpan secara lokal di IndexedDB browser perangkat Anda.
- **Kalkulasi Akuntansi di Sisi Klien:** Perhitungan buku besar ganda (*double-entry ledger*), laba/rugi, arus kas, dan neraca diproses secara lokal tanpa bergantung pada komputasi server.
- **Kredensial Aman:** Autentikasi email dan kata sandi menggunakan hashing derivasi kunci PBKDF2 di sisi perangkat pengguna dengan *salt* acak unik per akun. Kata sandi mentah tidak pernah dikirimkan atau disimpan di server.
- **Isolasi Tenant Ketat:** Jika fitur sinkronisasi multi-perangkat diaktifkan, sesi diamankan menggunakan token bertanda tangan kriptografis HMAC-SHA256 (`SESSION_SECRET`). Akses ke basis data Cloudflare D1 dibatasi secara ketat berdasarkan `tenant_id` dari token sesi yang sah, mencegah kebocoran data antar pemilik usaha.
- **Pencadangan Mandiri:** Pengguna memiliki kendali penuh atas data mereka melalui fitur ekspor/impor cadangan JSON dan ekspor laporan Excel/CSV.

## Melaporkan Celah Keamanan (Reporting a Security Concern)

Jika Anda menemukan kerentanan keamanan, kebocoran data, atau masalah keamanan lainnya pada proyek ini, mohon laporkan secara bertanggung jawab:

1. **GitHub Security Advisory:** Anda dapat mengirimkan laporan kerentanan privat melalui [GitHub Security Advisories](https://github.com/rizalahmaddd/bukulapak/security/advisories/new).
2. **Kontak Langsung:** Anda juga dapat menghubungi pengembang utama secara langsung melalui WhatsApp di [+62 857-7777-5477](https://wa.me/6285777775477).

Mohon sertakan:
- Deskripsi detail mengenai celah keamanan yang ditemukan.
- Langkah-langkah atau *proof-of-concept* (PoC) untuk mereproduksi temuan tersebut.
- Browser/sistem operasi atau lingkungan API yang digunakan.

Kami akan meninjau setiap laporan secepat mungkin dan mengambil tindakan perbaikan yang diperlukan.
