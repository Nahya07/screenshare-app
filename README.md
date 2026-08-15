P2P ScreenShare (versi Supabase)
Versi ini tidak butuh server Node.js/Express sama sekali. Semua backend (penyimpanan room + signaling WebRTC) ditangani oleh Supabase:
Supabase Database → menyimpan room_code + password.
Supabase Realtime (Broadcast + Presence) → menggantikan Socket.io untuk bertukar offer/answer/ICE candidate serta mendeteksi kapan peer join/leave.
WebRTC → tetap murni peer-to-peer untuk video/audio; Supabase tidak pernah membawa data screen share itu sendiri.
Karena tidak ada server custom, project ini cocok 100% untuk Vercel (atau hosting statis apa pun) — cukup upload index.html + app.js.
Struktur
screenshare-supabase/
├── index.html     # UI (Tailwind CDN), memuat supabase-js lalu app.js
├── app.js          # Semua logika: room, WebRTC, realtime signaling
├── setup.sql       # Script SQL untuk membuat tabel & RLS policy di Supabase
└── README.md
Setup Supabase (wajib dilakukan sebelum aplikasi bisa jalan)
1. Buat tabel + RLS policy
Buka Supabase Dashboard → SQL Editor, jalankan isi file setup.sql (aman dijalankan berkali-kali, tidak akan error meski policy sudah ada).
Ini akan membuat tabel rooms dengan kolom:
id (uuid, primary key)
room_code (text, unik)
password (text)
created_at (timestamptz)
Serta 3 policy untuk role anon: select, insert, delete — supaya aplikasi bisa baca/tulis room langsung dari browser tanpa server perantara.
2. Pastikan Realtime aktif
Broadcast & Presence Supabase Realtime biasanya aktif secara default di project baru. Jika sebelumnya pernah dinonaktifkan, cek di Project Settings → Realtime di dashboard Supabase.
3. Cocokkan kredensial di app.js
Pastikan SUPABASE_URL dan SUPABASE_PUBLISHABLE_KEY di bagian atas app.js sesuai dengan project Supabase kamu (Project Settings → API). Publishable/anon key aman dipakai di sisi client — itu memang tujuannya, selama RLS policy sudah benar seperti di atas.
Menjalankan Secara Lokal
Karena semua file statis (tidak ada backend custom), cukup jalankan static server sederhana, misalnya:
npx serve .
# atau
python3 -m http.server 8080
Lalu buka http://localhost:8080 (atau port yang ditampilkan) di dua tab browser berbeda untuk simulasi 2 pihak.
Catatan: getDisplayMedia() (untuk mulai screen share) mensyaratkan HTTPS atau localhost. Testing di localhost aman-aman saja.
Deploy ke Vercel
Push folder ini ke GitHub.
Di Vercel Dashboard, import repo tersebut.
Vercel akan otomatis mendeteksi ini sebagai static site (tidak perlu Build Command / Output Directory khusus — kosongkan saja atau biarkan default).
Setelah deploy, akses URL https://nama-app.vercel.app dari dua perangkat berbeda.
Tidak perlu environment variable apa pun di Vercel karena kredensial Supabase memang ditulis langsung di app.js (publishable key, bukan service_role key — jadi aman untuk publik).
Cara Kerja Signaling (ringkas)
User A klik Buat Room → insert row baru ke tabel rooms di Supabase, dapat room_code + password acak (atau custom).
User A & User B sama-sama join ke Supabase Realtime channel bernama screenshare-{room_code} setelah password tervalidasi lewat query ke tabel rooms.
Presence dipakai untuk saling tahu "peer sudah ada di room" — begitu presence sync mendeteksi 1 user lain, status berubah jadi connected.
Saat salah satu pihak klik Start Sharing:
getDisplayMedia() diminta ke browser.
RTCPeerConnection dibuat, track layar ditambahkan.
Offer dikirim lewat roomChannel.send({ type: "broadcast", event: "webrtc-offer", ... }).
Peer lain menerima broadcast tsb, buat answer, kirim balik.
ICE candidate saling ditukar lewat broadcast event terpisah.
Setelah negosiasi ICE selesai, video mengalir langsung P2P antar browser — Supabase sudah tidak terlibat lagi di jalur video.
Keamanan & Keterbatasan
Password room disimpan plain text di tabel rooms untuk kesederhanaan. Untuk kebutuhan lebih serius, pertimbangkan hash password (misalnya lewat Supabase Edge Function) alih-alih membandingkan plain text langsung dari client.
Room tidak otomatis terhapus. Jalankan query pembersihan secara berkala (lihat komentar di akhir setup.sql), atau buat Supabase Edge Function + Cron Job untuk otomatisasi.
Karena validasi password dilakukan di client (bukan lewat RPC/Edge Function di server), siapa pun dengan akses ke anon key secara teknis bisa membaca seluruh isi tabel rooms (termasuk password room lain) jika ingin mencoba — cukup aman untuk penggunaan personal/casual, tapi bukan level keamanan enterprise. Jika butuh lebih ketat, pindahkan logic validasi password ke Supabase Edge Function/RPC yang menyembunyikan password asli dari response.
Troubleshooting
Masalah
Penyebab & Solusi
Tombol "Buat Room"/"Gabung Room" tidak merespons
Cek Console browser — biasanya karena supabase global belum termuat (urutan script salah) atau SUPABASE_URL/key salah.
"Gagal membuat room" / "Gagal menghubungi database"
RLS policy belum di-setup dengan benar. Jalankan ulang setup.sql.
Status macet di "Menunggu peer bergabung..." padahal peer sudah join
Cek apakah Realtime aktif di project Supabase; cek juga console untuk status channel (SUBSCRIBED/CHANNEL_ERROR).
Video peer tidak muncul walau status "Connected"
Peer belum menekan "Start Sharing" — status koneksi presence dan status screen-share adalah dua hal berbeda.
Room lama menumpuk di database
Jalankan DELETE FROM rooms WHERE created_at < now() - interval '6 hours'; secara berkala.
