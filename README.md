# RodaKas — Sistem Akuntansi Sparepart Motor

Aplikasi sederhana untuk mencatat persediaan, pembelian, penjualan, dan estimasi laba kotor. ERD terdiri dari empat entitas: `parties`, `spare_parts`, `transactions`, dan `transaction_items`.

```mermaid
erDiagram
  PARTIES ||--o{ TRANSACTIONS : terkait
  TRANSACTIONS ||--|{ TRANSACTION_ITEMS : memiliki
  SPARE_PARTS ||--o{ TRANSACTION_ITEMS : dicatat

  PARTIES {
    uuid id PK
    text name
    text party_type
    text phone
  }
  SPARE_PARTS {
    uuid id PK
    text sku
    text name
    integer stock
    numeric cost_price
    numeric selling_price
  }
  TRANSACTIONS {
    uuid id PK
    text transaction_type
    date transaction_date
    uuid party_id FK
    numeric total_amount
  }
  TRANSACTION_ITEMS {
    uuid id PK
    uuid transaction_id FK
    uuid spare_part_id FK
    integer quantity
    numeric unit_price
    numeric unit_cost
  }
```

## Menjalankan aplikasi

1. Buat project Supabase, lalu jalankan seluruh isi [`backend/schema.sql`](backend/schema.sql) melalui SQL Editor Supabase.
2. Atur variabel lingkungan `SUPABASE_URL` dan `SUPABASE_SERVICE_ROLE_KEY` pada terminal. Gunakan **service role key hanya di backend**; jangan masukkan key ini ke frontend atau unggah ke repositori.
3. Pastikan Node.js 18 atau lebih baru tersedia, lalu jalankan `node backend/app.js` dari folder proyek.
4. Buka `http://localhost:3000`.

## Mempublikasikan aplikasi untuk penilaian

GitHub Pages hanya dapat menjalankan frontend statis, bukan server Node.js. Workflow di `.github/workflows/deploy-pages.yml` menerbitkan isi `frontend` sebagai GitHub Pages, sedangkan `render.yaml` menyiapkan backend Node.js untuk Render. Jangan mengunggah service-role key ke GitHub.

1. Unggah/push proyek ini ke repository GitHub.
2. Di Render, buat Web Service baru dari repository ini dan gunakan blueprint `render.yaml`. Isi `SUPABASE_URL` serta `SUPABASE_SERVICE_ROLE_KEY` pada Environment service Render. Untuk `APP_ORIGINS`, masukkan origin Pages Anda saja, misalnya `https://username.github.io` (tanpa nama repository dan tanpa garis miring di akhir). Simpan lalu tunggu backend berstatus **Live**.
3. Salin URL backend HTTPS Render, misalnya `https://rodakas-api.onrender.com`.
4. Di repository GitHub, buka **Settings → Secrets and variables → Actions → Variables**, lalu buat repository variable bernama `API_BASE_URL` dengan URL backend tersebut.
5. Di **Settings → Pages**, pilih **GitHub Actions** sebagai Build and deployment source. Jalankan workflow **Deploy frontend to GitHub Pages** dari tab **Actions** (workflow juga berjalan otomatis saat file frontend berubah dan di-push).
6. Tunggu workflow sukses, lalu bagikan URL Pages berbentuk `https://username.github.io/nama-repository/`. Uji halaman Ringkasan dan pastikan data berhasil dimuat.

**Peringatan akses publik:** backend ini tidak memiliki login. Siapa pun dapat memanggil API untuk menambah, mengubah, atau menghapus data di project Supabase yang dikonfigurasi. `APP_ORIGINS` hanya membatasi akses browser lintas-origin, bukan autentikasi—orang tetap dapat mengakses API dengan alat lain. Pakai project Supabase demo yang terpisah dan jangan gunakan database berisi data sensitif. Simpan service-role key hanya di Environment Render; jangan masukkan ke workflow, frontend, atau repository.

Contoh pengaturan variabel di PowerShell:

```powershell
$env:SUPABASE_URL = "https://project-ref.supabase.co"
$env:SUPABASE_SERVICE_ROLE_KEY = "service-role-key"
node backend/app.js
```

Pembelian menambah stok dan memperbarui harga pokok rata-rata tertimbang. Penjualan memeriksa stok, menguranginya, serta menyimpan harga pokok saat transaksi untuk perhitungan estimasi laba kotor. Tambahkan pemasok dan sparepart, lalu catat pembelian sebelum mencatat penjualan. Setiap transaksi dapat berisi lebih dari satu barang.

Menu **Laporan** menyediakan ringkasan penjualan, pembelian, dan estimasi laba kotor berdasarkan rentang tanggal, serta ekspor rincian transaksi ke CSV.

Sparepart dan kontak dapat diedit atau dihapus dari tabel masing-masing. Penghapusan ditolak bila data sudah digunakan dalam transaksi, agar riwayat akuntansi tetap utuh.

Transaksi juga dapat diedit atau dihapus dari tabel riwayat. Perubahan transaksi menghitung ulang stok dan harga pokok secara atomik; bila penyesuaian akan membuat stok tidak mencukupi pada transaksi berikutnya, perubahan dibatalkan. Sebelum memperbarui aplikasi yang sudah berisi data, buat backup Supabase, hentikan server, kemudian jalankan seluruh file [`backend/schema.sql`](backend/schema.sql) di SQL Editor Supabase untuk memasang kolom dan fungsi migrasi terbaru. Jika migrasi melaporkan saldo awal tidak konsisten, hentikan proses dan periksa stok serta riwayat transaksi; jangan hapus data untuk mengatasi error.

Tidak memerlukan `package.json` atau file `env.example`; server menggunakan modul bawaan Node.js dan API Supabase melalui REST.
