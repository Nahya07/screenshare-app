/**
 * app.js
 * Frontend P2P ScreenShare
 *
 * Signaling:
 * - Supabase Realtime Broadcast
 * - Supabase Realtime Presence
 *
 * Media:
 * - WebRTC P2P langsung antar-browser
 * - Screen/audio TIDAK dikirim melalui Supabase
 */

// ================================================================
// SUPABASE CONFIG
// ================================================================

const SUPABASE_URL = "https://yoehxwgradptpvpgujlx.supabase.co";

const SUPABASE_PUBLISHABLE_KEY =
  "sb_publishable_sZv6Aj53i98DPKDoMA3sTw_ZMGODu4a";

const supabaseClient = window.supabase.createClient(
  SUPABASE_URL,
  SUPABASE_PUBLISHABLE_KEY
);

// ================================================================
// WEBRTC CONFIG
// ================================================================

const ICE_SERVERS = {
  iceServers: [
    { urls: "stun:stun.l.google.com:19302" },
    { urls: "stun:stun1.l.google.com:19302" },
    { urls: "stun:stun2.l.google.com:19302" },
    { urls: "stun:stun.services.mozilla.com" },
  ],
};

// ================================================================
// GLOBAL STATE
// ================================================================

let currentRoomCode = null;
let currentPassword = null;

let selfId = crypto.randomUUID();
let peerId = null;

let channel = null;
let peerConnection = null;
let localStream = null;

let isSharing = false;
let isHost = false;

// Untuk mencegah ICE candidate masuk sebelum remote description siap
const pendingIceCandidates = [];

// ================================================================
// DOM REFERENCES
// ================================================================

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

// ================================================================
// UI HELPERS
// ================================================================

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

// ================================================================
// CONNECTION STATUS
// ================================================================

function setConnectionStatus(status) {
  const map = {
    waiting: {
      color: "bg-yellow-400",
      text: "Menunggu peer bergabung...",
      pulse: true,
    },

    connected: {
      color: "bg-emerald-400",
      text: "Connected",
      pulse: false,
    },

    disconnecting: {
      color: "bg-orange-400",
      text: "Disconnecting...",
      pulse: true,
    },

    reconnecting: {
      color: "bg-orange-400",
      text: "Reconnecting...",
      pulse: true,
    },

    disconnected: {
      color: "bg-red-400",
      text: "Disconnected — peer keluar",
      pulse: false,
    },
  };

  const s = map[status] || map.waiting;

  el.statusDot.className =
    `w-2 h-2 rounded-full ${s.color}` +
    (s.pulse ? " pulse-dot" : "");

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

// ================================================================
// ROOM ID / PASSWORD
// ================================================================

function generateRoomCode() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

  let code = "";

  for (let i = 0; i < 6; i++) {
    code += chars[Math.floor(Math.random() * chars.length)];
  }

  return code;
}

function generatePassword() {
  const chars =
    "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789";

  let password = "";

  for (let i = 0; i < 6; i++) {
    password += chars[Math.floor(Math.random() * chars.length)];
  }

  return password;
}

// ================================================================
// SUPABASE CHANNEL
// ================================================================

async function createRoomChannel(roomCode) {
  if (channel) {
    try {
      await supabaseClient.removeChannel(channel);
    } catch (err) {
      console.warn("Gagal menghapus channel lama:", err);
    }

    channel = null;
  }

  channel = supabaseClient.channel(`screenshare:${roomCode}`, {
    config: {
      presence: {
        key: selfId,
      },
    },
  });

  // --------------------------------------------------------------
  // PRESENCE
  // --------------------------------------------------------------

  channel.on("presence", { event: "sync" }, () => {
    handlePresenceSync();
  });

  channel.on("presence", { event: "join" }, ({ key, newPresences }) => {
    console.log("Peer join:", key, newPresences);

    if (key !== selfId) {
      peerId = key;

      setConnectionStatus("connected");

      // Host memberi tahu peer baru bahwa dia siap.
      if (isHost) {
        sendSignal({
          type: "peer-ready",
        });
      }
    }
  });

  channel.on("presence", { event: "leave" }, ({ key }) => {
    console.log("Peer leave:", key);

    if (key === peerId) {
      peerId = null;

      cleanupPeerConnection();
      resetRemoteVideo();

      setConnectionStatus("disconnected");
    }
  });

  // --------------------------------------------------------------
  // BROADCAST SIGNALING
  // --------------------------------------------------------------

  channel.on(
    "broadcast",
    { event: "signal" },
    async ({ payload }) => {
      await handleSignal(payload);
    }
  );

  const status = await channel.subscribe(async (status) => {
    console.log("Supabase channel status:", status);

    if (status === "SUBSCRIBED") {
      await channel.track({
        id: selfId,
        name: el.inputName.value.trim() || "Anonim",
        joinedAt: Date.now(),
      });

      console.log("Supabase Realtime connected.");
    }
  });

  if (status !== "ok") {
    throw new Error("Gagal terhubung ke Supabase Realtime.");
  }
}

// ================================================================
// PRESENCE
// ================================================================

function handlePresenceSync() {
  if (!channel) return;

  const state = channel.presenceState();

  const peerKeys = Object.keys(state).filter(
    (key) => key !== selfId
  );

  console.log("Presence state:", state);

  if (peerKeys.length > 0) {
    if (peerKeys.length > 1) {
      console.warn("Room memiliki lebih dari 2 peserta.");
    }

    peerId = peerKeys[0];

    setConnectionStatus("connected");

    // Host memberi tahu peer bahwa dia siap.
    if (isHost) {
      sendSignal({
        type: "peer-ready",
      });
    }
  } else {
    peerId = null;
    setConnectionStatus("waiting");
  }
}

// ================================================================
// BROADCAST SIGNAL
// ================================================================

async function sendSignal(payload) {
  if (!channel) {
    console.warn("Channel belum tersedia.");
    return;
  }

  try {
    await channel.send({
      type: "broadcast",
      event: "signal",
      payload: {
        ...payload,
        from: selfId,
      },
    });
  } catch (err) {
    console.error("Gagal mengirim signaling:", err);
  }
}

// ================================================================
// SIGNAL HANDLER
// ================================================================

async function handleSignal(payload) {
  if (!payload) return;

  // Abaikan pesan sendiri
  if (payload.from === selfId) return;

  console.log("Signal received:", payload.type);

  // --------------------------------------------------------------
  // PEER READY
  // --------------------------------------------------------------

  if (payload.type === "peer-ready") {
    peerId = payload.from;

    setConnectionStatus("connected");

    // Host yang membuat room bertanggung jawab membuat offer
    // ketika sudah ada peer.
    if (isHost && !isSharing) {
      console.log("Peer siap.");
    }

    return;
  }

  // --------------------------------------------------------------
  // START SHARING REQUEST
  // --------------------------------------------------------------

  if (payload.type === "sharing-status") {
    if (!payload.isSharing) {
      resetRemoteVideo();
    }

    return;
  }

  // --------------------------------------------------------------
  // WEBRTC OFFER
  // --------------------------------------------------------------

  if (payload.type === "webrtc-offer") {
    peerId = payload.from;

    try {
      await ensurePeerConnection();

      await peerConnection.setRemoteDescription(
        new RTCSessionDescription(payload.offer)
      );

      await flushPendingIceCandidates();

      const answer = await peerConnection.createAnswer();

      await peerConnection.setLocalDescription(answer);

      await sendSignal({
        type: "webrtc-answer",
        to: payload.from,
        answer,
      });
    } catch (err) {
      console.error("Gagal menangani offer:", err);
    }

    return;
  }

  // --------------------------------------------------------------
  // WEBRTC ANSWER
  // --------------------------------------------------------------

  if (payload.type === "webrtc-answer") {
    if (!peerConnection) return;

    try {
      await peerConnection.setRemoteDescription(
        new RTCSessionDescription(payload.answer)
      );

      await flushPendingIceCandidates();
    } catch (err) {
      console.error("Gagal menangani answer:", err);
    }

    return;
  }

  // --------------------------------------------------------------
  // ICE CANDIDATE
  // --------------------------------------------------------------

  if (payload.type === "webrtc-ice-candidate") {
    if (!payload.candidate) return;

    const candidate = new RTCIceCandidate(payload.candidate);

    if (
      peerConnection &&
      peerConnection.remoteDescription
    ) {
      try {
        await peerConnection.addIceCandidate(candidate);
      } catch (err) {
        console.warn("Gagal add ICE candidate:", err);
      }
    } else {
      pendingIceCandidates.push(candidate);
    }

    return;
  }

  // --------------------------------------------------------------
  // RECONNECT SIGNAL
  // --------------------------------------------------------------

  if (payload.type === "reconnect-signal") {
    setConnectionStatus("reconnecting");
    return;
  }
}

// ================================================================
// ROOM CREATION
// ================================================================

el.btnCreateRoom.addEventListener("click", async () => {
  clearError();

  const name =
    el.inputName.value.trim() || "Anonim";

  let roomCode =
    el.createRoomCode.value.trim().toUpperCase();

  let password =
    el.createRoomPassword.value.trim();

  if (!roomCode) {
    roomCode = generateRoomCode();
  }

  if (!password) {
    password = generatePassword();
  }

  el.btnCreateRoom.disabled = true;
  el.btnCreateRoom.textContent = "Membuat room...";

  try {
    /*
     * Kita tidak menggunakan database untuk room.
     * Room dibuat berdasarkan channel Realtime.
     *
     * Password tetap ditampilkan kepada host.
     */

    currentRoomCode = roomCode;
    currentPassword = password;

    isHost = true;

    el.displayRoomCode.textContent = roomCode;
    el.displayRoomPassword.textContent = password;

    el.createdRoomInfo.classList.remove("hidden");

    el.btnEnterCreatedRoom.dataset.roomCode = roomCode;
    el.btnEnterCreatedRoom.dataset.password = password;

    console.log("Room dibuat:", roomCode);

  } catch (err) {
    console.error(err);
    showError("Gagal membuat room.");
  } finally {
    el.btnCreateRoom.disabled = false;
    el.btnCreateRoom.textContent = "Buat Room Baru";
  }
});

// ================================================================
// ENTER CREATED ROOM
// ================================================================

el.btnEnterCreatedRoom.addEventListener("click", async () => {
  const roomCode =
    el.btnEnterCreatedRoom.dataset.roomCode;

  const password =
    el.btnEnterCreatedRoom.dataset.password;

  const name =
    el.inputName.value.trim() || "Anonim";

  await doJoinRoom(roomCode, password, name, true);
});

// ================================================================
// JOIN ROOM
// ================================================================

el.btnJoinRoom.addEventListener("click", async () => {
  clearError();

  const name =
    el.inputName.value.trim() || "Anonim";

  const roomCode =
    el.joinRoomCode.value.trim().toUpperCase();

  const password =
    el.joinRoomPassword.value.trim();

  if (!roomCode || !password) {
    showError("Kode room dan password wajib diisi.");
    return;
  }

  await doJoinRoom(roomCode, password, name, false);
});

// ================================================================
// JOIN ROOM FUNCTION
// ================================================================

async function doJoinRoom(
  roomCode,
  password,
  name,
  host
) {
  clearError();

  if (!roomCode) {
    showError("Kode room tidak boleh kosong.");
    return;
  }

  try {
    currentRoomCode = roomCode.toUpperCase();
    currentPassword = password;
    isHost = !!host;

    /*
     * Karena tidak ada server pusat yang menyimpan room,
     * password digunakan sebagai bagian dari validasi channel.
     *
     * Kita membuat nama channel berdasarkan room + hash password.
     */

    const channelRoomName =
      await createSecureChannelName(
        currentRoomCode,
        currentPassword
      );

    await createRoomChannel(channelRoomName);

    goToRoomScreen(currentRoomCode);

    console.log(
      `Berhasil masuk room ${currentRoomCode}`
    );

  } catch (err) {
    console.error("Join room error:", err);

    showError(
      err.message ||
      "Gagal bergabung ke room."
    );

    currentRoomCode = null;
    currentPassword = null;
    isHost = false;
  }
}

// ================================================================
// CREATE SECURE CHANNEL NAME
// ================================================================

async function createSecureChannelName(
  roomCode,
  password
) {
  const encoder =
    new TextEncoder();

  const data =
    encoder.encode(
      `${roomCode}:${password}`
    );

  const hashBuffer =
    await crypto.subtle.digest(
      "SHA-256",
      data
    );

  const hashArray =
    Array.from(
      new Uint8Array(hashBuffer)
    );

  const hash =
    hashArray
      .map((b) =>
        b.toString(16).padStart(2, "0")
      )
      .join("");

  return `${roomCode}-${hash.substring(0, 16)}`;
}

// ================================================================
// WEBRTC PEER CONNECTION
// ================================================================

async function ensurePeerConnection() {
  if (peerConnection) {
    return peerConnection;
  }

  peerConnection =
    new RTCPeerConnection(
      ICE_SERVERS
    );

  // --------------------------------------------------------------
  // ICE
  // --------------------------------------------------------------

  peerConnection.onicecandidate =
    async (event) => {
      if (!event.candidate || !peerId) {
        return;
      }

      await sendSignal({
        type: "webrtc-ice-candidate",
        to: peerId,
        candidate: event.candidate,
      });
    };

  // --------------------------------------------------------------
  // REMOTE TRACK
  // --------------------------------------------------------------

  peerConnection.ontrack =
    (event) => {
      console.log("Remote track diterima.");

      if (event.streams && event.streams[0]) {
        el.remoteVideo.srcObject =
          event.streams[0];

        el.remoteVideo.classList.remove(
          "hidden"
        );

        el.remotePlaceholder.classList.add(
          "hidden"
        );
      }
    };

  // --------------------------------------------------------------
  // CONNECTION STATE
  // --------------------------------------------------------------

  peerConnection.onconnectionstatechange =
    () => {
      if (!peerConnection) return;

      const state =
        peerConnection.connectionState;

      console.log(
        "PeerConnection state:",
        state
      );

      if (state === "connected") {
        setConnectionStatus("connected");
      }

      if (state === "disconnected") {
        setConnectionStatus("reconnecting");
      }

      if (
        state === "failed" ||
        state === "closed"
      ) {
        setConnectionStatus(
          "disconnected"
        );

        resetRemoteVideo();
      }
    };

  // --------------------------------------------------------------
  // LOCAL TRACK
  // --------------------------------------------------------------

  if (localStream) {
    localStream
      .getTracks()
      .forEach((track) => {
        peerConnection.addTrack(
          track,
          localStream
        );
      });
  }

  return peerConnection;
}

// ================================================================
// FLUSH ICE CANDIDATES
// ================================================================

async function flushPendingIceCandidates() {
  if (
    !peerConnection ||
    !peerConnection.remoteDescription
  ) {
    return;
  }

  while (
    pendingIceCandidates.length > 0
  ) {
    const candidate =
      pendingIceCandidates.shift();

    try {
      await peerConnection.addIceCandidate(
        candidate
      );
    } catch (err) {
      console.warn(
        "Gagal menambahkan queued ICE candidate:",
        err
      );
    }
  }
}

// ================================================================
// CLEANUP PEER CONNECTION
// ================================================================

function cleanupPeerConnection() {
  if (peerConnection) {
    try {
      peerConnection.onicecandidate = null;
      peerConnection.ontrack = null;

      peerConnection.close();
    } catch (err) {
      console.warn(
        "Cleanup peer error:",
        err
      );
    }

    peerConnection = null;
  }

  pendingIceCandidates.length = 0;
}

// ================================================================
// REMOTE VIDEO
// ================================================================

function resetRemoteVideo() {
  el.remoteVideo.srcObject = null;

  el.remoteVideo.classList.add(
    "hidden"
  );

  el.remotePlaceholder.classList.remove(
    "hidden"
  );
}

// ================================================================
// LOCAL VIDEO
// ================================================================

function resetLocalVideo() {
  el.localVideo.srcObject = null;

  el.localVideo.classList.add(
    "hidden"
  );

  el.localPlaceholder.classList.remove(
    "hidden"
  );
}

// ================================================================
// START SCREEN SHARING
// ================================================================

el.btnStartShare.addEventListener(
  "click",
  startSharing
);

el.btnStopShare.addEventListener(
  "click",
  stopSharing
);

async function startSharing() {
  if (!peerId) {
    alert(
      "Tunggu hingga peer lain bergabung ke room terlebih dahulu."
    );

    return;
  }

  try {
    localStream =
      await navigator.mediaDevices.getDisplayMedia(
        {
          video: {
            frameRate: {
              ideal: 30,
              max: 60,
            },
          },

          audio: true,
        }
      );

  } catch (err) {
    console.error(
      "Gagal mengambil layar:",
      err
    );

    alert(
      "Tidak bisa memulai screen sharing. Pastikan izin screen sharing diberikan."
    );

    return;
  }

  // --------------------------------------------------------------
  // LOCAL PREVIEW
  // --------------------------------------------------------------

  el.localVideo.srcObject =
    localStream;

  el.localVideo.classList.remove(
    "hidden"
  );

  el.localPlaceholder.classList.add(
    "hidden"
  );

  // --------------------------------------------------------------
  // PEER CONNECTION
  // --------------------------------------------------------------

  await ensurePeerConnection();

  /*
   * Pastikan semua track masuk ke PeerConnection.
   */

  const senders =
    peerConnection.getSenders();

  localStream
    .getTracks()
    .forEach((track) => {
      const alreadyAdded =
        senders.some(
          (sender) =>
            sender.track === track
        );

      if (!alreadyAdded) {
        peerConnection.addTrack(
          track,
          localStream
        );
      }
    });

  // --------------------------------------------------------------
  // OFFER
  // --------------------------------------------------------------

  const offer =
    await peerConnection.createOffer();

  await peerConnection.setLocalDescription(
    offer
  );

  await sendSignal({
    type: "webrtc-offer",
    to: peerId,
    offer,
  });

  // --------------------------------------------------------------
  // BROWSER STOP BUTTON
  // --------------------------------------------------------------

  const videoTrack =
    localStream.getVideoTracks()[0];

  if (videoTrack) {
    videoTrack.addEventListener(
      "ended",
      () => {
        stopSharing();
      },
      { once: true }
    );
  }

  isSharing = true;

  updateShareButtons();

  await sendSignal({
    type: "sharing-status",
    to: peerId,
    isSharing: true,
  });
}

// ================================================================
// STOP SCREEN SHARING
// ================================================================

async function stopSharing() {
  if (localStream) {
    localStream
      .getTracks()
      .forEach((track) => {
        try {
          track.stop();
        } catch (err) {}
      });

    localStream = null;
  }

  resetLocalVideo();

  isSharing = false;

  updateShareButtons();

  if (peerId) {
    await sendSignal({
      type: "sharing-status",
      to: peerId,
      isSharing: false,
    });
  }

  /*
   * Tutup koneksi lama supaya sesi berikutnya bersih.
   */

  cleanupPeerConnection();
}

// ================================================================
// SHARE BUTTONS
// ================================================================

function updateShareButtons() {
  el.btnStartShare.disabled =
    isSharing;

  el.btnStopShare.disabled =
    !isSharing;

  el.btnStartShare.classList.toggle(
    "opacity-40",
    isSharing
  );

  el.btnStopShare.classList.toggle(
    "opacity-40",
    !isSharing
  );
}

// ================================================================
// LEAVE ROOM
// ================================================================

el.btnLeaveRoom.addEventListener(
  "click",
  async () => {
    try {
      if (localStream) {
        localStream
          .getTracks()
          .forEach((track) => {
            try {
              track.stop();
            } catch (err) {}
          });

        localStream = null;
      }

      cleanupPeerConnection();

      if (channel) {
        try {
          await channel.untrack();
        } catch (err) {
          console.warn(
            "Gagal untrack:",
            err
          );
        }

        try {
          await supabaseClient.removeChannel(
            channel
          );
        } catch (err) {
          console.warn(
            "Gagal remove channel:",
            err
          );
        }

        channel = null;
      }

    } finally {
      currentRoomCode = null;
      currentPassword = null;

      peerId = null;

      isHost = false;
      isSharing = false;

      resetRemoteVideo();
      resetLocalVideo();

      updateShareButtons();

      el.createdRoomInfo.classList.add(
        "hidden"
      );

      el.createRoomCode.value = "";
      el.createRoomPassword.value = "";

      el.joinRoomCode.value = "";
      el.joinRoomPassword.value = "";

      goToEntryScreen();

      setConnectionStatus(
        "waiting"
      );
    }
  }
);

// ================================================================
// PAGE CLOSE
// ================================================================

window.addEventListener(
  "beforeunload",
  () => {
    if (channel) {
      channel.untrack();
    }
  }
);

// ================================================================
// INITIALIZATION
// ================================================================

updateShareButtons();

switchTab("create");

setConnectionStatus("waiting");

console.log(
  "✅ ScreenShare Supabase Realtime initialized."
);
