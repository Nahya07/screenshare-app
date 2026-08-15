# P2P ScreenShare — Live Screen Sharing via WebRTC

Aplikasi web untuk live screen sharing / mirroring peer-to-peer (2 pihak) menggunakan WebRTC.
Server hanya berfungsi sebagai **signaling server** (menjembatani proses handshake awal) —
video/audio dikirim **langsung antar browser**, tidak lewat server.

## Fitur

- Sistem room privat berbasis **kode + password** (maksimal 2 peserta per room).
- Screen sharing real-time via `getDisplayMedia()` + WebRTC.
- Fallback STUN server publik gratis (Google, Mozilla) untuk NAT traversal.
- Indikator status koneksi real-time: `Connected`, `Disconnecting`, `Reconnecting`, `Disconnected`.
- UI responsif, minimalis, dark-mode dengan Tailwind CSS (via CDN, tanpa build step).

## Struktur Proyek

```
screenshare-app/
├── server.js           # Backend Express + Socket.io (signaling server)
├── package.json
├── public/
│   ├── index.html       # UI utama (entry room + sesi sharing)
│   └── app.js            # Logika WebRTC + Socket.io client
└── README.md
```

## Cara Kerja Singkat

1. User A membuat room → mendapat **kode room** & **password** → dibagikan ke User B (via chat/WA/dsb, di luar aplikasi ini).
2. User B masuk dengan kode + password yang sama.
3. Begitu keduanya berada di room yang sama, salah satu pihak menekan **Start Sharing**.
4. Browser meminta izin `getDisplayMedia()`, lalu membuat **WebRTC offer** yang direlay oleh
   server ke peer lain lewat Socket.io (`webrtc-offer` → `webrtc-answer` → pertukaran `ICE candidate`).
5. Setelah negosiasi selesai, video mengalir **langsung P2P** antar browser.
6. Tombol **Stop Sharing** menghentikan track & menutup peer connection.

## Menjalankan Secara Lokal

### Prasyarat
- Node.js versi 18 ke atas
- NPM

### Langkah-langkah

```bash
# 1. Masuk ke folder proyek
cd screenshare-app

# 2. Install dependencies
npm install

# 3. Jalankan server
npm start
```

Server akan berjalan di `http://localhost:3001`. Buka URL tersebut di **dua tab/browser/perangkat
berbeda** untuk mensimulasikan 2 pihak (User A & User B).

> **Catatan penting soal `getDisplayMedia()`:**
> - Browser modern mensyaratkan koneksi **HTTPS** atau **localhost** untuk mengizinkan akses
>   screen capture. `localhost` aman dipakai untuk testing lokal.
> - Jika ingin testing dari 2 perangkat fisik berbeda di jaringan lokal (bukan localhost),
>   Anda wajib menggunakan HTTPS (lihat bagian deployment) atau tool tunneling seperti `ngrok`.

### Testing lintas perangkat di jaringan lokal (opsional, pakai ngrok)

```bash
npx ngrok http 3001
```

Gunakan URL HTTPS yang diberikan ngrok untuk diakses dari perangkat lain.

## Deployment

Karena ini adalah **single Node.js server** yang menyajikan backend (Socket.io) sekaligus
frontend statis (folder `public/`), cara paling sederhana adalah deploy sebagai satu service
di **Render** (atau platform sejenis seperti Railway/Fly.io).

> **Kenapa bukan Vercel untuk backend-nya?** Vercel berbasis serverless functions dan
> **tidak mendukung koneksi WebSocket persisten** yang dibutuhkan Socket.io untuk signaling.
> Anda tetap bisa deploy **frontend saja** ke Vercel/Netlify jika backend dipisah, tapi cara
> termudah adalah deploy semuanya jadi satu di Render.

### Deploy ke Render

1. Push kode ini ke repository GitHub.
2. Di [Render Dashboard](https://dashboard.render.com), klik **New → Web Service**.
3. Hubungkan repository GitHub Anda.
4. Isi konfigurasi:
   - **Build Command**: `npm install`
   - **Start Command**: `npm start`
   - **Environment**: Node
5. Render otomatis menyediakan **HTTPS** dan environment variable `PORT` — server.js sudah
   membaca `process.env.PORT` secara otomatis, jadi tidak perlu ubah apa pun.
6. Setelah deploy selesai, akses URL yang diberikan Render (contoh: `https://nama-app.onrender.com`)
   dari dua perangkat berbeda untuk mulai screen sharing.

### Catatan tentang TURN server (opsional, untuk jaringan yang lebih ketat)

STUN server gratis (Google, Mozilla) sudah cukup untuk kebanyakan kasus NAT rumahan/kantor.
Namun jika salah satu pihak berada di balik firewall/NAT simetris yang ketat (jaringan
korporat, beberapa jaringan seluler), koneksi P2P murni bisa gagal dan **butuh TURN server**
sebagai relay. Untuk kebutuhan produksi serius, pertimbangkan menambahkan TURN server gratis/
berbayar (misalnya dari [Metered](https://www.metered.ca/tools/openrelay/) atau
[Twilio STUN/TURN](https://www.twilio.com/docs/stun-turn)) dengan menambahkan entri baru ke
array `ICE_SERVERS` di `public/app.js`:

```js
const ICE_SERVERS = {
  iceServers: [
    { urls: "stun:stun.l.google.com:19302" },
    {
      urls: "turn:your-turn-server.com:3478",
      username: "your-username",
      credential: "your-credential",
    },
  ],
};
```

## Keamanan & Privasi

- Room dilindungi kombinasi **kode + password**; hanya dua pihak pertama yang tahu kombinasi
  ini yang bisa bergabung (room otomatis ditolak jika sudah terisi 2 orang).
- Video/audio **tidak pernah transit lewat server** — server hanya melihat metadata signaling
  (offer/answer/ICE candidate), bukan konten layar itu sendiri.
- Room otomatis dihapus dari memori server saat kosong atau kedaluwarsa (6 jam).
- Untuk produksi jangka panjang dengan banyak room bersamaan, pertimbangkan mengganti
  penyimpanan room in-memory dengan Redis agar tahan restart server & bisa horizontal scaling.

## Troubleshooting

| Masalah | Kemungkinan Penyebab & Solusi |
|---|---|
| Tombol "Start Sharing" tidak muncul dialog pilih layar | Pastikan diakses lewat `https://` atau `localhost`, bukan `http://` biasa di IP lokal. |
| Status macet di "Reconnecting" | Cek koneksi internet kedua pihak; jika salah satu di jaringan sangat ketat, mungkin perlu TURN server (lihat bagian di atas). |
| Room "sudah penuh" padahal cuma 1 orang | Kemungkinan tab lama masih terhubung (belum ter-disconnect). Refresh/tutup semua tab lama lalu buat room baru. |
| Video peer tidak muncul walau status "Connected" | Peer belum menekan "Start Sharing" — status koneksi socket dan status screen-share adalah dua hal berbeda. |
