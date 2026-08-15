/**
 * app.js
 * Logika frontend untuk P2P ScreenShare:
 * - Manajemen room (buat/gabung) via Socket.io signaling
 * - WebRTC PeerConnection untuk transmisi screen-share langsung P2P
 * - Update status koneksi (Connected / Disconnected / Reconnecting)
 */

// ------------------------------------------------------------------
// Konfigurasi STUN server publik gratis (fallback jika ada NAT/firewall)
// ------------------------------------------------------------------
const ICE_SERVERS = {
  iceServers: [
    { urls: "stun:stun.l.google.com:19302" },
    { urls: "stun:stun1.l.google.com:19302" },
    { urls: "stun:stun2.l.google.com:19302" },
    { urls: "stun:stun.services.mozilla.com" },
  ],
};

// ------------------------------------------------------------------
// State global
// ------------------------------------------------------------------
const socket = io(); // otomatis connect ke origin yang sama (server.js)

let currentRoomCode = null;
let selfId = null;
let peerId = null; // id socket lawan bicara (hanya 1, karena max 2 party)
let peerConnection = null;
let localStream = null;
let isSharing = false;

// ------------------------------------------------------------------
// Referensi elemen DOM
// ------------------------------------------------------------------
const el = {
  screenEntry: document.getElementById("screen-entry"),
  screenRoom: document.getElementById("screen-room"),

  tabCreate: document.getElementById("tab-create"),
  tabJoin: document.getElementById("tab-join"),
  panelCreate: document.getElementById("panel-create"),
  panelJoin: document.getElementById("panel-join"),

  inputName: document.getElementById("input-name"),

  createRoomCode: document.getElementById("create-room-code"),
  createRoomPassword: document.getElementById("create-room-password"),
  btnCreateRoom: document.getElementById("btn-create-room"),
  createdRoomInfo: document.getElementById("created-room-info"),
  displayRoomCode: document.getElementById("display-room-code"),
  displayRoomPassword: document.getElementById("display-room-password"),
  btnEnterCreatedRoom: document.getElementById("btn-enter-created-room"),

  joinRoomCode: document.getElementById("join-room-code"),
  joinRoomPassword: document.getElementById("join-room-password"),
  btnJoinRoom: document.getElementById("btn-join-room"),

  entryError: document.getElementById("entry-error"),

  headerRoomCode: document.getElementById("header-room-code"),
  statusDot: document.getElementById("status-dot"),
  statusText: document.getElementById("status-text"),
  btnLeaveRoom: document.getElementById("btn-leave-room"),

  remoteVideo: document.getElementById("remote-video"),
  remotePlaceholder: document.getElementById("remote-placeholder"),
  localVideo: document.getElementById("local-video"),
  localPlaceholder: document.getElementById("local-placeholder"),

  btnStartShare: document.getElementById("btn-start-share"),
  btnStopShare: document.getElementById("btn-stop-share"),
};

// ------------------------------------------------------------------
// Helper UI kecil
// ------------------------------------------------------------------
function showError(message) {
  el.entryError.textContent = message;
  el.entryError.classList.remove("hidden");
}
function clearError() {
  el.entryError.classList.add("hidden");
  el.entryError.textContent = "";
}

function switchTab(tab) {
  clearError();
  if (tab === "create") {
    el.tabCreate.classList.add("bg-indigo-600", "text-white");
    el.tabCreate.classList.remove("text-slate-300");
    el.tabJoin.classList.remove("bg-indigo-600", "text-white");
    el.tabJoin.classList.add("text-slate-300");
    el.panelCreate.classList.remove("hidden");
    el.panelJoin.classList.add("hidden");
  } else {
    el.tabJoin.classList.add("bg-indigo-600", "text-white");
    el.tabJoin.classList.remove("text-slate-300");
    el.tabCreate.classList.remove("bg-indigo-600", "text-white");
    el.tabCreate.classList.add("text-slate-300");
    el.panelJoin.classList.remove("hidden");
    el.panelCreate.classList.add("hidden");
  }
}
el.tabCreate.addEventListener("click", () => switchTab("create"));
el.tabJoin.addEventListener("click", () => switchTab("join"));

/**
 * setConnectionStatus
 * status: "waiting" | "connected" | "disconnecting" | "reconnecting" | "disconnected"
 */
function setConnectionStatus(status) {
  const map = {
    waiting: { color: "bg-yellow-400", text: "Menunggu peer bergabung...", pulse: true },
    connected: { color: "bg-emerald-400", text: "Connected", pulse: false },
    disconnecting: { color: "bg-orange-400", text: "Disconnecting...", pulse: true },
    reconnecting: { color: "bg-orange-400", text: "Reconnecting...", pulse: true },
    disconnected: { color: "bg-red-400", text: "Disconnected — peer keluar", pulse: false },
  };
  const s = map[status] || map.waiting;
  el.statusDot.className = `w-2 h-2 rounded-full ${s.color}` + (s.pulse ? " pulse-dot" : "");
  el.statusText.textContent = s.text;
}

function goToRoomScreen(roomCode) {
  el.screenEntry.classList.add("hidden");
  el.screenRoom.classList.remove("hidden");
  el.headerRoomCode.textContent = roomCode;
  setConnectionStatus(peerId ? "connected" : "waiting");
}

function goToEntryScreen() {
  el.screenRoom.classList.add("hidden");
  el.screenEntry.classList.remove("hidden");
}

// ------------------------------------------------------------------
// ROOM CREATION
// ------------------------------------------------------------------
el.btnCreateRoom.addEventListener("click", () => {
  clearError();
  const name = el.inputName.value.trim() || "Anonim";
  const roomCode = el.createRoomCode.value.trim();
  const password = el.createRoomPassword.value.trim();

  el.btnCreateRoom.disabled = true;
  el.btnCreateRoom.textContent = "Membuat room...";

  socket.emit("create-room", { roomCode, password, name }, (res) => {
    el.btnCreateRoom.disabled = false;
    el.btnCreateRoom.textContent = "Buat Room Baru";

    if (!res.ok) {
      showError(res.error || "Gagal membuat room.");
      return;
    }

    el.displayRoomCode.textContent = res.roomCode;
    el.displayRoomPassword.textContent = res.password;
    el.createdRoomInfo.classList.remove("hidden");

    // Simpan sementara untuk tombol "Masuk ke Room"
    el.btnEnterCreatedRoom.dataset.roomCode = res.roomCode;
    el.btnEnterCreatedRoom.dataset.password = res.password;
  });
});

el.btnEnterCreatedRoom.addEventListener("click", () => {
  const roomCode = el.btnEnterCreatedRoom.dataset.roomCode;
  const password = el.btnEnterCreatedRoom.dataset.password;
  const name = el.inputName.value.trim() || "Anonim";
  doJoinRoom(roomCode, password, name);
});

// ------------------------------------------------------------------
// ROOM JOIN
// ------------------------------------------------------------------
el.btnJoinRoom.addEventListener("click", () => {
  clearError();
  const name = el.inputName.value.trim() || "Anonim";
  const roomCode = el.joinRoomCode.value.trim();
  const password = el.joinRoomPassword.value.trim();

  if (!roomCode || !password) {
    showError("Kode room dan password wajib diisi.");
    return;
  }
  doJoinRoom(roomCode, password, name);
});

function doJoinRoom(roomCode, password, name) {
  clearError();
  el.btnJoinRoom.disabled = true;

  socket.emit("join-room", { roomCode, password, name }, (res) => {
    el.btnJoinRoom.disabled = false;

    if (!res.ok) {
      showError(res.error || "Gagal bergabung ke room.");
      return;
    }

    currentRoomCode = res.roomCode;
    selfId = res.selfId;

    if (res.peers && res.peers.length > 0) {
      peerId = res.peers[0];
    }

    goToRoomScreen(currentRoomCode);
  });
}

// ------------------------------------------------------------------
// SOCKET EVENTS — signaling & presence
// ------------------------------------------------------------------
socket.on("peer-joined", ({ peerId: newPeerId, name }) => {
  peerId = newPeerId;
  setConnectionStatus("connected");
  console.log(`Peer bergabung: ${name} (${newPeerId})`);
});

socket.on("peer-left", () => {
  setConnectionStatus("disconnected");
  cleanupPeerConnection();
  resetRemoteVideo();
  peerId = null;
});

socket.on("disconnect", () => {
  if (currentRoomCode) {
    setConnectionStatus("reconnecting");
  }
});

socket.on("connect", () => {
  // Jika sebelumnya di dalam room lalu socket sempat putus & reconnect,
  // browser Socket.io client akan otomatis reconnect ke server.
  if (currentRoomCode && peerId) {
    setConnectionStatus("connected");
  }
});

socket.on("reconnect-signal", () => {
  setConnectionStatus("reconnecting");
});

socket.on("sharing-status", ({ isSharing: peerIsSharing }) => {
  if (!peerIsSharing) {
    resetRemoteVideo();
  }
});

// --- WebRTC signaling relay ---
socket.on("webrtc-offer", async ({ from, offer }) => {
  peerId = from;
  await ensurePeerConnection();
  await peerConnection.setRemoteDescription(new RTCSessionDescription(offer));
  const answer = await peerConnection.createAnswer();
  await peerConnection.setLocalDescription(answer);
  socket.emit("webrtc-answer", { to: from, answer });
});

socket.on("webrtc-answer", async ({ answer }) => {
  if (!peerConnection) return;
  await peerConnection.setRemoteDescription(new RTCSessionDescription(answer));
});

socket.on("webrtc-ice-candidate", async ({ candidate }) => {
  if (!peerConnection || !candidate) return;
  try {
    await peerConnection.addIceCandidate(new RTCIceCandidate(candidate));
  } catch (err) {
    console.warn("Gagal menambahkan ICE candidate:", err);
  }
});

// ------------------------------------------------------------------
// WEBRTC — PeerConnection setup
// ------------------------------------------------------------------
async function ensurePeerConnection() {
  if (peerConnection) return peerConnection;

  peerConnection = new RTCPeerConnection(ICE_SERVERS);

  peerConnection.onicecandidate = (event) => {
    if (event.candidate && peerId) {
      socket.emit("webrtc-ice-candidate", { to: peerId, candidate: event.candidate });
    }
  };

  peerConnection.ontrack = (event) => {
    el.remoteVideo.srcObject = event.streams[0];
    el.remoteVideo.classList.remove("hidden");
    el.remotePlaceholder.classList.add("hidden");
  };

  peerConnection.onconnectionstatechange = () => {
    const state = peerConnection.connectionState;
    console.log("PeerConnection state:", state);
    if (state === "connected") {
      setConnectionStatus("connected");
    } else if (state === "disconnected") {
      setConnectionStatus("reconnecting");
    } else if (state === "failed" || state === "closed") {
      setConnectionStatus("disconnected");
      resetRemoteVideo();
    }
  };

  // Jika kita sudah punya localStream (sedang sharing) sebelum peerConnection dibuat,
  // pastikan track ikut ditambahkan.
  if (localStream) {
    localStream.getTracks().forEach((track) => {
      peerConnection.addTrack(track, localStream);
    });
  }

  return peerConnection;
}

function cleanupPeerConnection() {
  if (peerConnection) {
    peerConnection.close();
    peerConnection = null;
  }
}

function resetRemoteVideo() {
  el.remoteVideo.srcObject = null;
  el.remoteVideo.classList.add("hidden");
  el.remotePlaceholder.classList.remove("hidden");
}

function resetLocalVideo() {
  el.localVideo.srcObject = null;
  el.localVideo.classList.add("hidden");
  el.localPlaceholder.classList.remove("hidden");
}

// ------------------------------------------------------------------
// SCREEN SHARING — Start / Stop
// ------------------------------------------------------------------
el.btnStartShare.addEventListener("click", startSharing);
el.btnStopShare.addEventListener("click", stopSharing);

async function startSharing() {
  if (!peerId) {
    alert("Tunggu hingga peer lain bergabung ke room terlebih dahulu.");
    return;
  }

  try {
    localStream = await navigator.mediaDevices.getDisplayMedia({
      video: { frameRate: { ideal: 30, max: 60 } },
      audio: true, // ikut share audio sistem jika didukung browser
    });
  } catch (err) {
    console.error("Gagal mengambil layar:", err);
    alert("Tidak bisa memulai screen sharing. Pastikan Anda memberi izin.");
    return;
  }

  el.localVideo.srcObject = localStream;
  el.localVideo.classList.remove("hidden");
  el.localPlaceholder.classList.add("hidden");

  await ensurePeerConnection();

  localStream.getTracks().forEach((track) => {
    peerConnection.addTrack(track, localStream);
  });

  // Buat & kirim offer ke peer
  const offer = await peerConnection.createOffer();
  await peerConnection.setLocalDescription(offer);
  socket.emit("webrtc-offer", { to: peerId, offer });

  // Jika user menghentikan share lewat tombol browser bawaan ("Stop sharing")
  localStream.getVideoTracks()[0].addEventListener("ended", stopSharing);

  isSharing = true;
  updateShareButtons();
  socket.emit("sharing-status", { to: peerId, isSharing: true });
}

function stopSharing() {
  if (localStream) {
    localStream.getTracks().forEach((track) => track.stop());
    localStream = null;
  }
  resetLocalVideo();

  isSharing = false;
  updateShareButtons();

  if (peerId) {
    socket.emit("sharing-status", { to: peerId, isSharing: false });
  }

  // Tutup & bangun ulang koneksi supaya bersih untuk sesi share berikutnya
  cleanupPeerConnection();
}

function updateShareButtons() {
  el.btnStartShare.disabled = isSharing;
  el.btnStopShare.disabled = !isSharing;
  el.btnStartShare.classList.toggle("opacity-40", isSharing);
  el.btnStopShare.classList.toggle("opacity-40", !isSharing);
}

// ------------------------------------------------------------------
// LEAVE ROOM
// ------------------------------------------------------------------
el.btnLeaveRoom.addEventListener("click", () => {
  if (localStream) {
    localStream.getTracks().forEach((track) => track.stop());
    localStream = null;
  }
  cleanupPeerConnection();
  socket.emit("leave-room");

  currentRoomCode = null;
  peerId = null;
  isSharing = false;

  resetRemoteVideo();
  resetLocalVideo();
  updateShareButtons();
  el.createdRoomInfo.classList.add("hidden");
  el.createRoomCode.value = "";
  el.createRoomPassword.value = "";
  el.joinRoomCode.value = "";
  el.joinRoomPassword.value = "";

  goToEntryScreen();
});

// Inisialisasi awal
updateShareButtons();
switchTab("create");
