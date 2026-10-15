# DESIGN SYSTEM: BukuLapak (Clean White, gaya macOS / iOS)

## 1. Identitas & Mood
* **Vibe:** Putih bersih, tenang, terasa seperti aplikasi bawaan macOS/iOS. Angka uang dan untung tetap paling menonjol.
* **Filosofi:** Kemudahan nomor satu. Jangan membingungkan pedagang dengan istilah akuntansi (debit/kredit). Aksi utama (Uang Masuk / Keluar) selalu satu ketukan.
* **Prinsip visual:**
  - Kartu putih tanpa border di atas kanvas abu sangat muda; pemisah pakai hairline 0.5px, bukan garis tebal.
  - Kaca (blur + saturasi) hanya untuk elemen navigasi yang mengambang: tab bar, top bar, sidebar, menu. Konten tidak pernah transparan.
  - Tombol & chip berbentuk kapsul; input berupa field berisi (fill) tanpa border, ring hijau saat fokus.
  - Tidak ada gradient dekoratif selain ikon aplikasi.

## 2. Warna (semua lolos WCAG ≥ 4.5:1 untuk teks)
* **Kanvas:** `#F5F5F7` · **Surface/kartu:** `#FFFFFF`
* **Label:** `#1D1D1F` · **Label sekunder:** `#636366` · **Label tersier:** `#8E8E93` (hanya ikon/chevron, bukan teks penting)
* **Separator:** `rgba(60,60,67,.12)` · **Fill:** `rgba(118,118,128,.12 / .08 / .05)`
* **Semantik:**
  - Uang masuk / untung: `#137A37` (soft `#E9F6EE`)
  - Uang keluar / rugi: `#D70015` (soft `#FDECEC`)
  - Peringatan / QRIS tertunda: `#A34A00` (soft `#FFF4E0`)
  - Tautan / netral / pindah saldo: `#0066CC` (soft `#E8F1FC`)
* Warna ikon pengaturan (latar ikon persegi ala iOS Settings) bersifat dekoratif.

## 3. Tipografi
* **Font:** `-apple-system, BlinkMacSystemFont, "SF Pro Text", "Segoe UI Variable", "Segoe UI", Roboto, sans-serif`
* **Angka uang:** wajib `font-variant-numeric: tabular-nums`.
* **Skala:** Large title 32px/700 (HP) · Judul halaman 28px (tablet) / 24px (desktop) · Hero angka 40px/700 · Body 15px · Input **16px** (mencegah auto-zoom iOS) · Caption 13px.

## 4. Layout per Perangkat
Breakpoint mengikuti ukuran Apple dan dipakai bersama oleh CSS dan `src/ui/device.ts`:

* **HP (< 744px)**
  - Large title ala iOS di atas halaman tab; halaman dalam memakai nav bar kaca ringkas dengan tombol kembali.
  - Tab bar kapsul kaca mengambang di bawah + tombol "+" hijau terpisah yang membuka sheet Catat (Masuk / Keluar / Pindah).
  - Form punya bar Simpan menempel di bawah layar. Sheet muncul dari bawah dengan grabber.
* **Tablet (744px – 1179px)**
  - Bar tab kapsul kaca mengambang di atas (gaya iPadOS), tombol usaha di kiri, sinkronisasi & menu "+" di kanan. Di bawah 1024px tombol usaha jadi ikon saja.
  - Bento 2 kolom; split view (daftar kiri, detail kanan) di Riwayat, Utang, dan Pengaturan.
  - Sheet tampil sebagai dialog di tengah.
* **Desktop (≥ 1180px)**
  - Sidebar kaca mengambang (gaya macOS Tahoe) dengan pemilih usaha, grup menu, dan profil di bawah.
  - Toolbar halaman berisi judul + aksi cepat (Masuk / Keluar / Pindah) + status sinkron.
  - Bento 3 kolom, split view seperti tablet, nominal bisa diketik langsung pakai keyboard.
  - Halaman publik (masuk/daftar) dua kolom: panel brand kiri, form kanan.

## 5. Komponen inti (`src/ui/kit.tsx`, `src/ui/quick.tsx`)
* `TopBar`: large title untuk halaman tab, nav bar ringkas untuk halaman dalam, otomatis memuat aksi cepat di desktop.
* `Segmented`: pengganti deretan chip untuk tab/periode.
* `Sheet`: bottom sheet di HP, dialog di layar lebar; mengunci scroll body.
* `AmountPad`: tampilan nominal besar + keypad; mendengarkan keyboard fisik.
* `Empty`: empty state dengan ikon.
* Kelas daftar: `.group`/`.card.flush` + `.list` + `.item` (inset grouped list); `.list.with-icons` untuk inset separator setelah ikon.
* `input.switch` untuk toggle ala iOS; `.chip.option` untuk pilihan satu dari beberapa yang berupa kalimat.
