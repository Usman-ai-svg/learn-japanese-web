# Pengingat belajar bersyarat

Notifikasi yang **hanya berbunyi kalau hari itu belum ada sesi yang dikerjakan**.

## Kenapa perlu komponen terpisah

Aplikasi di GitHub Pages bersifat statis, dan catatan belajarmu hanya ada di
`localStorage` browser HP. Artinya tidak ada satu pun pihak yang tahu kapan kamu
terakhir belajar — alarm kalender biasa tidak bisa bertanya "sudah belajar belum?",
dia cuma berbunyi pada jamnya.

Worker ini mengisi celah itu. Dia menyimpan **dua hal saja**: langganan push, dan
*tanggal* terakhir kamu belajar. Tidak ada kosakata, skor, maupun isi belajar yang
keluar dari HP-mu.

## Cara kerjanya

```
Aplikasi  ──POST /subscribe──►  Worker        (sekali, saat kamu aktifkan)
Aplikasi  ──POST /activity ──►  Worker        (tiap sesi selesai: "hari ini sudah")
                                  │
                        cron tiap 15 menit
                                  ▼
                   sudah lewat jam pengingat?
                   belum ada sesi hari ini?
                   belum diingatkan hari ini?
                                  │ ketiganya ya
                                  ▼
                        kirim notifikasi push
```

---

## Yang kamu butuhkan

- Akun Cloudflare gratis (tanpa kartu kredit) — https://dash.cloudflare.com/sign-up
- Node.js — sudah terpasang di komputermu

Seluruh proses sekitar 10–15 menit, sekali saja.

---

## Langkah 0 — Masuk ke folder ini dulu

**Semua** perintah di bawah dijalankan dari dalam folder `reminder-worker`, bukan dari
root proyek — di sinilah `wrangler.toml` dan `generate-keys.mjs` berada.

```bash
cd reminder-worker
```

Kalau muncul `Cannot find module ...generate-keys.mjs` atau wrangler mengeluh tidak
menemukan konfigurasi, hampir pasti penyebabnya langkah ini terlewat.

## Langkah 1 — Login ke Cloudflare

```bash
npx wrangler login
```

Browser akan terbuka untuk menyetujui akses. Setelah itu kembali ke terminal.

## Langkah 2 — Buat penyimpanan (KV)

```bash
npx wrangler kv namespace create REMINDERS
```

Keluarannya memuat sebuah `id`. **Salin id itu ke `wrangler.toml`**, ganti tulisan
`ISI_DENGAN_ID_KV_NAMESPACE_MU`.

## Langkah 3 — Buat dan pasang kunci VAPID

```bash
node generate-keys.mjs
```

Kunci privat yang muncul adalah **rahasia** — siapa pun yang memegangnya bisa mengirim
notifikasi atas nama aplikasimu. Jangan dibagikan ke mana pun dan jangan sampai masuk git.

Pasang ketiganya (tempel nilainya saat diminta):

```bash
npx wrangler secret put VAPID_PUBLIC_KEY
npx wrangler secret put VAPID_PRIVATE_KEY
npx wrangler secret put VAPID_SUBJECT
```

Untuk `VAPID_SUBJECT`, isi dengan `mailto:` diikuti emailmu — layanan push memakainya
untuk menghubungimu kalau ada masalah pengiriman.

## Langkah 4 — Deploy

```bash
npx wrangler deploy
```

Keluarannya memuat URL worker-mu, bentuknya seperti
`https://pengingat-belajar.xxxx.workers.dev`. **Salin URL itu.**

Cek dulu sehat atau tidak:

```bash
curl https://pengingat-belajar.xxxx.workers.dev/health
```

Harus menjawab `{"ok":true,"vapidConfigured":true,"kvBound":true}`. Kalau salah satu
bernilai `false`, ada langkah di atas yang belum beres.

## Langkah 5 — Pasang aplikasi ke Home Screen iPhone

**Ini wajib, bukan opsional.** Di iOS, Web Push hanya jalan untuk situs yang sudah
ditambahkan ke Home Screen.

1. Buka aplikasi di Safari
2. Tombol Bagikan → **Tambahkan ke Layar Utama**
3. Buka aplikasi **dari ikon Home Screen** itu, bukan dari Safari lagi

## Langkah 6 — Aktifkan di aplikasi

1. Masuk ke **Rencana Belajar**
2. Gulir ke kartu **🔔 Pengingat harian**
3. Buka **Pengaturan server pengingat**, tempel URL worker dari Langkah 4, klik Simpan
4. Pilih jam pengingatmu
5. Klik **Aktifkan notifikasi pintar**, izinkan saat iOS bertanya

Selesai.

---

## Menguji tanpa menunggu sehari

Set jam pengingat ke beberapa menit dari sekarang, lalu **jangan kerjakan sesi apa pun**.
Notifikasi akan datang dalam maksimal 15 menit setelah jam itu (cron berjalan tiap 15 menit).

Untuk menguji sisi sebaliknya — yang justru inti fiturnya — kerjakan 1 sesi lebih dulu,
lalu tunggu melewati jam pengingat. Seharusnya **tidak ada notifikasi sama sekali**.

Melihat catatan jalannya cron:

```bash
npx wrangler tail
```

## Biaya

Nol. Cloudflare Workers gratis memberi 100.000 permintaan/hari dan cron trigger;
pemakaian satu orang jauh di bawah itu (sekitar 96 kali cron + beberapa laporan per hari).

## Kalau notifikasi tidak datang

| Gejala | Kemungkinan sebab |
|---|---|
| Tombol aktifkan menolak dengan pesan Home Screen | Aplikasi dibuka dari Safari, bukan dari ikon Home Screen |
| `/health` menjawab `vapidConfigured:false` | Secret VAPID belum terpasang (Langkah 3) |
| `/health` menjawab `kvBound:false` | Id KV di `wrangler.toml` belum diganti (Langkah 2) |
| Aktif tapi diam terus | Cek `npx wrangler tail` — mungkin `lastActive` hari ini sudah terisi, artinya worker menganggap kamu sudah belajar |
| Sempat jalan lalu berhenti | Langganan push bisa kedaluwarsa; aktifkan ulang dari aplikasi |

## Mematikan

Klik **Matikan notifikasi pintar** di aplikasi. Untuk menghapus worker sepenuhnya:

```bash
npx wrangler delete
```
