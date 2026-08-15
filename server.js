/**
 * server.js
 * Backend signaling server untuk aplikasi P2P Screen Sharing.
 *
 * Tugas server ini HANYA sebagai "signaling" (perantara pertukaran
 * informasi koneksi WebRTC: offer, answer, ICE candidate) dan
 * manajemen room privat berbasis kode/token.
 *
 * Video/audio (screen share) TIDAK pernah lewat server ini —
 * transmisi terjadi langsung peer-to-peer antar browser (WebRTC),
 * sehingga lebih cepat & privat.
 */

const express = require("express");
const http = require("http");
const path = require("path");
const { Server } = require("socket.io");
const crypto = require("crypto");

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: "*", // Untuk produksi, ganti dengan domain frontend Anda
    methods: ["GET", "POST"],
  },
});

const PORT = process.env.PORT || 3001;

// Sajikan file frontend statis dari folder /public
app.use(express.static(path.join(__dirname, "public")));

// ------------------------------------------------------------------
// State penyimpanan room di memori (in-memory).
// Untuk skala produksi besar, ganti dengan Redis dsb.
// Setiap room MAKSIMAL 2 peserta (2-party connection) + password.
// ------------------------------------------------------------------
/**
 * rooms = {
 *   [roomCode]: {
 *     password: string,
 *     members: { [socketId]: { name: string } },
 *     createdAt: number
 *   }
 * }
 */
const rooms = {};

// Bersihkan room kosong secara berkala supaya memori tidak bocor
setInterval(() => {
  const now = Date.now();
  for (const code of Object.keys(rooms)) {
    const room = rooms[code];
    const isEmpty = Object.keys(room.members).length === 0;
    const isStale = now - room.createdAt > 1000 * 60 * 60 * 6; // 6 jam
    if (isEmpty || isStale) {
      delete rooms[code];
    }
  }
}, 60 * 1000);

function generateRoomCode() {
  // Kode 6 karakter, mudah dibaca (tanpa karakter ambigu seperti 0/O, 1/I)
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let code = "";
  do {
    code = "";
    for (let i = 0; i < 6; i++) {
      code += chars[crypto.randomInt(0, chars.length)];
    }
  } while (rooms[code]); // pastikan unik
  return code;
}

// ------------------------------------------------------------------
// REST endpoint kecil: buat room baru beserta password acak.
// Frontend juga boleh mengizinkan user membuat room dengan
// kode & password custom melalui event socket "create-room".
// ------------------------------------------------------------------
app.get("/api/create-room", (req, res) => {
  const code = generateRoomCode();
  const password = crypto.randomBytes(3).toString("hex"); // 6 karakter hex

  rooms[code] = {
    password,
    members: {},
    createdAt: Date.now(),
  };

  res.json({ roomCode: code, password });
});

app.get("/api/health", (req, res) => {
  res.json({ status: "ok", activeRooms: Object.keys(rooms).length });
});

// ------------------------------------------------------------------
// Socket.io — signaling logic
// ------------------------------------------------------------------
io.on("connection", (socket) => {
  console.log(`[socket] connected: ${socket.id}`);

  let currentRoom = null;

  // --- Buat room dengan kode & password custom (opsional) ---
  socket.on("create-room", ({ roomCode, password, name }, callback) => {
    try {
      const code = (roomCode && roomCode.trim().toUpperCase()) || generateRoomCode();
      const pass = password && password.trim() ? password.trim() : crypto.randomBytes(3).toString("hex");

      if (rooms[code] && Object.keys(rooms[code].members).length > 0) {
        return callback({ ok: false, error: "Kode room sudah digunakan. Coba kode lain." });
      }

      rooms[code] = {
        password: pass,
        members: {},
        createdAt: Date.now(),
      };

      callback({ ok: true, roomCode: code, password: pass });
    } catch (err) {
      callback({ ok: false, error: "Gagal membuat room." });
    }
  });

  // --- Join room dengan kode + password ---
  socket.on("join-room", ({ roomCode, password, name }, callback) => {
    const code = (roomCode || "").trim().toUpperCase();
    const room = rooms[code];

    if (!room) {
      return callback({ ok: false, error: "Room tidak ditemukan. Periksa kembali kode room." });
    }

    if (room.password !== (password || "").trim()) {
      return callback({ ok: false, error: "Password salah." });
    }

    const memberCount = Object.keys(room.members).length;
    if (memberCount >= 2) {
      return callback({ ok: false, error: "Room sudah penuh (maksimal 2 peserta)." });
    }

    // Gabungkan socket ke room
    socket.join(code);
    currentRoom = code;
    room.members[socket.id] = { name: name || "Anonim" };

    const otherPeers = Object.keys(room.members).filter((id) => id !== socket.id);

    callback({
      ok: true,
      roomCode: code,
      selfId: socket.id,
      peers: otherPeers, // daftar peer lain yang sudah ada di room (0 atau 1 orang)
    });

    // Beri tahu peer lain bahwa ada user baru join
    socket.to(code).emit("peer-joined", { peerId: socket.id, name: name || "Anonim" });

    console.log(`[room] ${socket.id} joined room ${code} (${memberCount + 1}/2)`);
  });

  // --- Relay WebRTC signaling: offer ---
  socket.on("webrtc-offer", ({ to, offer }) => {
    io.to(to).emit("webrtc-offer", { from: socket.id, offer });
  });

  // --- Relay WebRTC signaling: answer ---
  socket.on("webrtc-answer", ({ to, answer }) => {
    io.to(to).emit("webrtc-answer", { from: socket.id, answer });
  });

  // --- Relay WebRTC signaling: ICE candidate ---
  socket.on("webrtc-ice-candidate", ({ to, candidate }) => {
    io.to(to).emit("webrtc-ice-candidate", { from: socket.id, candidate });
  });

  // --- Notifikasi status sharing (mulai/berhenti) ke peer lain ---
  socket.on("sharing-status", ({ to, isSharing }) => {
    io.to(to).emit("sharing-status", { from: socket.id, isSharing });
  });

  // --- Sinyal "reconnecting" manual (misalnya jaringan goyang) ---
  socket.on("reconnect-signal", ({ to }) => {
    io.to(to).emit("reconnect-signal", { from: socket.id });
  });

  // --- Leave room secara eksplisit ---
  socket.on("leave-room", () => {
    handleLeave();
  });

  socket.on("disconnect", () => {
    console.log(`[socket] disconnected: ${socket.id}`);
    handleLeave();
  });

  function handleLeave() {
    if (!currentRoom || !rooms[currentRoom]) return;

    const room = rooms[currentRoom];
    delete room.members[socket.id];
    socket.to(currentRoom).emit("peer-left", { peerId: socket.id });
    socket.leave(currentRoom);

    console.log(`[room] ${socket.id} left room ${currentRoom}`);

    if (Object.keys(room.members).length === 0) {
      delete rooms[currentRoom];
    }
    currentRoom = null;
  }
});

server.listen(PORT, () => {
  console.log(`✅ Signaling server berjalan di http://localhost:${PORT}`);
});
