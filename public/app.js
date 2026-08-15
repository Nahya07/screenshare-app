/**
 * app.js
 * P2P ScreenShare menggunakan:
 *
 * - Supabase Database:
 *   Menyimpan room code + password
 *
 * - Supabase Realtime:
 *   Signaling WebRTC:
 *   offer, answer, ICE candidate, status sharing
 *
 * - WebRTC:
 *   Video/audio screen sharing langsung P2P
 *
 * Supabase TIDAK membawa video screen sharing.
 */

// ================================================================
// SUPABASE CONFIG
// ================================================================

const SUPABASE_URL = "https://yoehxwgradptpvpgujlx.supabase.co";

const SUPABASE_PUBLISHABLE_KEY =
  "sb_publishable_sZv6Aj53i98DPKDoMA3sTw_ZMGODu4a";

const supabaseClient = supabase.createClient(
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
    { urls: "stun:stun.services.mozilla.com" }
  ]
};


// ================================================================
// GLOBAL STATE
// ================================================================

let currentRoomCode = null;
let selfId = crypto.randomUUID();
let peerId = null;

let roomChannel = null;
let peerConnection = null;
let localStream = null;

let isSharing = false;
let isInRoom = false;


// ================================================================
// DOM
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

  createdRoomInfo:
    document.getElementById("created-room-info"),

  displayRoomCode:
    document.getElementById("display-room-code"),

  displayRoomPassword:
    document.getElementById("display-room-password"),

  btnEnterCreatedRoom:
    document.getElementById("btn-enter-created-room"),

  joinRoomCode:
    document.getElementById("join-room-code"),

  joinRoomPassword:
    document.getElementById("join-room-password"),

  btnJoinRoom:
    document.getElementById("btn-join-room"),

  entryError:
    document.getElementById("entry-error"),

  headerRoomCode:
    document.getElementById("header-room-code"),

  statusDot:
    document.getElementById("status-dot"),

  statusText:
    document.getElementById("status-text"),

  btnLeaveRoom:
    document.getElementById("btn-leave-room"),

  remoteVideo:
    document.getElementById("remote-video"),

  remotePlaceholder:
    document.getElementById("remote-placeholder"),

  localVideo:
    document.getElementById("local-video"),

  localPlaceholder:
    document.getElementById("local-placeholder"),

  btnStartShare:
    document.getElementById("btn-start-share"),

  btnStopShare:
    document.getElementById("btn-stop-share")
};


// ================================================================
// UI HELPERS
// ================================================================

function showError(message) {

  el.entryError.textContent = message;

  el.entryError.classList.remove("hidden");
}


function clearError() {

  el.entryError.textContent = "";

  el.entryError.classList.add("hidden");
}


function switchTab(tab) {

  clearError();

  if (tab === "create") {

    el.tabCreate.classList.add(
      "bg-indigo-600",
      "text-white"
    );

    el.tabCreate.classList.remove(
      "text-slate-300"
    );

    el.tabJoin.classList.remove(
      "bg-indigo-600",
      "text-white"
    );

    el.tabJoin.classList.add(
      "text-slate-300"
    );

    el.panelCreate.classList.remove("hidden");
    el.panelJoin.classList.add("hidden");

  } else {

    el.tabJoin.classList.add(
      "bg-indigo-600",
      "text-white"
    );

    el.tabJoin.classList.remove(
      "text-slate-300"
    );

    el.tabCreate.classList.remove(
      "bg-indigo-600",
      "text-white"
    );

    el.tabCreate.classList.add(
      "text-slate-300"
    );

    el.panelJoin.classList.remove("hidden");
    el.panelCreate.classList.add("hidden");
  }
}


function setConnectionStatus(status) {

  const map = {

    waiting: {
      color: "bg-yellow-400",
      text: "Menunggu peer bergabung...",
      pulse: true
    },

    connected: {
      color: "bg-emerald-400",
      text: "Connected",
      pulse: false
    },

    reconnecting: {
      color: "bg-orange-400",
      text: "Reconnecting...",
      pulse: true
    },

    disconnected: {
      color: "bg-red-400",
      text: "Disconnected — peer keluar",
      pulse: false
    }
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

  setConnectionStatus(
    peerId ? "connected" : "waiting"
  );
}


function goToEntryScreen() {

  el.screenRoom.classList.add("hidden");

  el.screenEntry.classList.remove("hidden");
}


// ================================================================
// ROOM CODE GENERATOR
// ================================================================

function generateRoomCode() {

  const chars =
    "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

  let code = "";

  for (let i = 0; i < 6; i++) {

    code += chars[
      Math.floor(Math.random() * chars.length)
    ];
  }

  return code;
}


function generatePassword() {

  const chars =
    "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789";

  let password = "";

  for (let i = 0; i < 6; i++) {

    password += chars[
      Math.floor(Math.random() * chars.length)
    ];
  }

  return password;
}


// ================================================================
// CREATE ROOM
// ================================================================

el.btnCreateRoom.addEventListener(
  "click",
  createRoom
);


async function createRoom() {

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

  el.btnCreateRoom.textContent =
    "Membuat room...";

  try {

    // Cek apakah kode sudah ada

    const { data: existingRoom, error: checkError } =
      await supabaseClient
        .from("rooms")
        .select("room_code")
        .eq("room_code", roomCode)
        .maybeSingle();

    if (checkError) {

      console.error(checkError);

      throw new Error(
        "Gagal menghubungi database Supabase."
      );
    }

    if (existingRoom) {

      throw new Error(
        "Kode room sudah digunakan. Gunakan kode lain."
      );
    }


    // Buat room

    const { error } =
      await supabaseClient
        .from("rooms")
        .insert({

          room_code: roomCode,

          password: password,

          created_at: new Date().toISOString()
        });

    if (error) {

      console.error(error);

      throw new Error(
        "Gagal membuat room: " +
        error.message
      );
    }


    // Tampilkan informasi room

    el.displayRoomCode.textContent =
      roomCode;

    el.displayRoomPassword.textContent =
      password;

    el.createdRoomInfo.classList.remove(
      "hidden"
    );


    el.btnEnterCreatedRoom.dataset.roomCode =
      roomCode;

    el.btnEnterCreatedRoom.dataset.password =
      password;

    console.log(
      `Room ${roomCode} berhasil dibuat oleh ${name}`
    );

  } catch (error) {

    console.error(error);

    showError(
      error.message ||
      "Gagal membuat room."
    );

  } finally {

    el.btnCreateRoom.disabled = false;

    el.btnCreateRoom.textContent =
      "Buat Room Baru";
  }
}


// ================================================================
// ENTER CREATED ROOM
// ================================================================

el.btnEnterCreatedRoom.addEventListener(
  "click",
  () => {

    const roomCode =
      el.btnEnterCreatedRoom.dataset.roomCode;

    const password =
      el.btnEnterCreatedRoom.dataset.password;

    const name =
      el.inputName.value.trim() || "Anonim";

    doJoinRoom(
      roomCode,
      password,
      name
    );
  }
);


// ================================================================
// JOIN ROOM BUTTON
// ================================================================

el.btnJoinRoom.addEventListener(
  "click",
  () => {

    clearError();

    const name =
      el.inputName.value.trim() || "Anonim";

    const roomCode =
      el.joinRoomCode.value
        .trim()
        .toUpperCase();

    const password =
      el.joinRoomPassword.value.trim();

    if (!roomCode || !password) {

      showError(
        "Kode room dan password wajib diisi."
      );

      return;
    }

    doJoinRoom(
      roomCode,
      password,
      name
    );
  }
);


// ================================================================
// JOIN ROOM
// ================================================================

async function doJoinRoom(
  roomCode,
  password,
  name
) {

  clearError();

  el.btnJoinRoom.disabled = true;

  try {

    // Ambil room dari Supabase

    const { data: room, error } =
      await supabaseClient
        .from("rooms")
        .select("*")
        .eq("room_code", roomCode)
        .maybeSingle();

    if (error) {

      console.error(error);

      throw new Error(
        "Gagal menghubungi database."
      );
    }

    if (!room) {

      throw new Error(
        "Room tidak ditemukan. Periksa kembali kode room."
      );
    }


    // Validasi password

    if (room.password !== password) {

      throw new Error(
        "Password salah."
      );
    }


    // Masuk room

    currentRoomCode = roomCode;

    isInRoom = true;

    peerId = null;

    await connectToRoomChannel(
      roomCode,
      name
    );

    goToRoomScreen(
      roomCode
    );

  } catch (error) {

    console.error(error);

    showError(
      error.message ||
      "Gagal bergabung ke room."
    );

  } finally {

    el.btnJoinRoom.disabled = false;
  }
}


// ================================================================
// SUPABASE REALTIME ROOM
// ================================================================

async function connectToRoomChannel(
  roomCode,
  name
) {

  // Jika masih ada channel lama

  if (roomChannel) {

    await supabaseClient
      .removeChannel(roomChannel);

    roomChannel = null;
  }


  roomChannel =
    supabaseClient.channel(
      `screenshare-${roomCode}`,
      {

        config: {

          broadcast: {
            self: false
          },

          presence: {
            key: selfId
          }
        }
      }
    );


  // ============================================================
  // PRESENCE
  // ============================================================

  roomChannel.on(
    "presence",
    {
      event: "sync"
    },
    () => {

      const state =
        roomChannel.presenceState();

      const peers = [];

      Object.keys(state).forEach(
        (key) => {

          if (key !== selfId) {

            const users =
              state[key];

            if (
              users &&
              users.length > 0
            ) {

              peers.push({
                id: key,
                name:
                  users[0].name ||
                  "Anonim"
              });
            }
          }
        }
      );


      if (peers.length > 0) {

        peerId =
          peers[0].id;

        setConnectionStatus(
          "connected"
        );

        console.log(
          "Peer ditemukan:",
          peers[0]
        );

      } else {

        peerId = null;

        setConnectionStatus(
          "waiting"
        );
      }
    }
  );


  // ============================================================
  // WEBRTC OFFER
  // ============================================================

  roomChannel.on(
    "broadcast",
    {
      event: "webrtc-offer"
    },
    async ({ payload }) => {

      if (
        payload.from === selfId
      ) {
        return;
      }

      console.log(
        "Menerima WebRTC offer"
      );

      peerId =
        payload.from;

      await ensurePeerConnection();

      await peerConnection
        .setRemoteDescription(
          new RTCSessionDescription(
            payload.offer
          )
        );

      const answer =
        await peerConnection.createAnswer();

      await peerConnection
        .setLocalDescription(
          answer
        );

      await sendSignal(
        "webrtc-answer",
        {
          from: selfId,

          to: payload.from,

          answer
        }
      );
    }
  );


  // ============================================================
  // WEBRTC ANSWER
  // ============================================================

  roomChannel.on(
    "broadcast",
    {
      event: "webrtc-answer"
    },
    async ({ payload }) => {

      if (
        payload.to !== selfId
      ) {
        return;
      }

      console.log(
        "Menerima WebRTC answer"
      );

      if (!peerConnection) {
        return;
      }

      await peerConnection
        .setRemoteDescription(
          new RTCSessionDescription(
            payload.answer
          )
        );
    }
  );


  // ============================================================
  // ICE CANDIDATE
  // ============================================================

  roomChannel.on(
    "broadcast",
    {
      event: "webrtc-ice-candidate"
    },
    async ({ payload }) => {

      if (
        payload.to !== selfId
      ) {
        return;
      }

      if (
        !peerConnection ||
        !payload.candidate
      ) {
        return;
      }

      try {

        await peerConnection
          .addIceCandidate(
            new RTCIceCandidate(
              payload.candidate
            )
          );

      } catch (error) {

        console.warn(
          "Gagal menambahkan ICE candidate:",
          error
        );
      }
    }
  );


  // ============================================================
  // SHARING STATUS
  // ============================================================

  roomChannel.on(
    "broadcast",
    {
      event: "sharing-status"
    },
    ({ payload }) => {

      if (
        payload.to !== selfId
      ) {
        return;
      }

      if (
        !payload.isSharing
      ) {

        resetRemoteVideo();
      }
    }
  );


  // ============================================================
  // RECONNECT SIGNAL
  // ============================================================

  roomChannel.on(
    "broadcast",
    {
      event: "reconnect-signal"
    },
    ({ payload }) => {

      if (
        payload.to !== selfId
      ) {
        return;
      }

      setConnectionStatus(
        "reconnecting"
      );
    }
  );


  // ============================================================
  // SUBSCRIBE
  // ============================================================

  const status =
    await new Promise(
      (resolve, reject) => {

        roomChannel.subscribe(
          async (status) => {

            console.log(
              "Supabase channel:",
              status
            );

            if (
              status === "SUBSCRIBED"
            ) {

              // Masukkan diri ke Presence

              await roomChannel.track({

                id: selfId,

                name: name,

                joinedAt:
                  new Date().toISOString()
              });

              resolve(status);

            } else if (
              status === "CHANNEL_ERROR"
            ) {

              reject(
                new Error(
                  "Gagal terhubung ke Supabase Realtime."
                )
              );

            } else if (
              status === "TIMED_OUT"
            ) {

              reject(
                new Error(
                  "Koneksi Supabase timeout."
                )
              );
            }
          }
        );
      }
    );


  return status;
}


// ================================================================
// SEND SIGNAL
// ================================================================

async function sendSignal(
  event,
  payload
) {

  if (!roomChannel) {

    console.warn(
      "Room channel belum tersedia."
    );

    return;
  }

  await roomChannel.send({

    type: "broadcast",

    event: event,

    payload: payload
  });
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


  // ============================================================
  // ICE
  // ============================================================

  peerConnection.onicecandidate =
    async (event) => {

      if (
        !event.candidate ||
        !peerId
      ) {
        return;
      }

      await sendSignal(
        "webrtc-ice-candidate",
        {

          from: selfId,

          to: peerId,

          candidate:
            event.candidate
        }
      );
    };


  // ============================================================
  // REMOTE TRACK
  // ============================================================

  peerConnection.ontrack =
    (event) => {

      console.log(
        "Remote track diterima."
      );

      if (
        event.streams &&
        event.streams[0]
      ) {

        el.remoteVideo.srcObject =
          event.streams[0];

      } else {

        if (
          !el.remoteVideo.srcObject
        ) {

          el.remoteVideo.srcObject =
            new MediaStream();
        }

        el.remoteVideo.srcObject.addTrack(
          event.track
        );
      }

      el.remoteVideo.classList.remove(
        "hidden"
      );

      el.remotePlaceholder.classList.add(
        "hidden"
      );
    };


  // ============================================================
  // CONNECTION STATE
  // ============================================================

  peerConnection.onconnectionstatechange =
    () => {

      const state =
        peerConnection.connectionState;

      console.log(
        "WebRTC state:",
        state
      );

      if (
        state === "connected"
      ) {

        setConnectionStatus(
          "connected"
        );

      } else if (
        state === "connecting"
      ) {

        setConnectionStatus(
          "waiting"
        );

      } else if (
        state === "disconnected"
      ) {

        setConnectionStatus(
          "reconnecting"
        );

      } else if (
        state === "failed"
      ) {

        setConnectionStatus(
          "disconnected"
        );

        resetRemoteVideo();

      } else if (
        state === "closed"
      ) {

        setConnectionStatus(
          "disconnected"
        );
      }
    };


  // ============================================================
  // ADD EXISTING LOCAL STREAM
  // ============================================================

  if (localStream) {

    localStream
      .getTracks()
      .forEach(
        (track) => {

          peerConnection.addTrack(
            track,
            localStream
          );
        }
      );
  }


  return peerConnection;
}


// ================================================================
// CLEANUP WEBRTC
// ================================================================

function cleanupPeerConnection() {

  if (peerConnection) {

    peerConnection.ontrack = null;

    peerConnection.onicecandidate = null;

    peerConnection.close();

    peerConnection = null;
  }
}


// ================================================================
// REMOTE VIDEO RESET
// ================================================================

function resetRemoteVideo() {

  el.remoteVideo.srcObject =
    null;

  el.remoteVideo.classList.add(
    "hidden"
  );

  el.remotePlaceholder.classList.remove(
    "hidden"
  );
}


// ================================================================
// LOCAL VIDEO RESET
// ================================================================

function resetLocalVideo() {

  el.localVideo.srcObject =
    null;

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


async function startSharing() {

  if (!peerId) {

    alert(
      "Tunggu hingga peer lain bergabung ke room terlebih dahulu."
    );

    return;
  }


  if (isSharing) {

    return;
  }


  try {

    localStream =
      await navigator.mediaDevices.getDisplayMedia({

        video: {

          frameRate: {

            ideal: 30,

            max: 60
          }
        },

        audio: true
      });

  } catch (error) {

    console.error(
      "Gagal mengambil layar:",
      error
    );

    alert(
      "Tidak bisa memulai screen sharing. Pastikan izin layar diberikan."
    );

    return;
  }


  // ============================================================
  // LOCAL PREVIEW
  // ============================================================

  el.localVideo.srcObject =
    localStream;

  el.localVideo.classList.remove(
    "hidden"
  );

  el.localPlaceholder.classList.add(
    "hidden"
  );


  // ============================================================
  // CREATE PEER CONNECTION
  // ============================================================

  cleanupPeerConnection();

  await ensurePeerConnection();


  // ============================================================
  // ADD TRACKS
  // ============================================================

  localStream
    .getTracks()
    .forEach(
      (track) => {

        peerConnection.addTrack(
          track,
          localStream
        );
      }
    );


  // ============================================================
  // CREATE OFFER
  // ============================================================

  const offer =
    await peerConnection.createOffer();


  await peerConnection
    .setLocalDescription(
      offer
    );


  // ============================================================
  // SEND OFFER VIA SUPABASE
  // ============================================================

  await sendSignal(
    "webrtc-offer",
    {

      from: selfId,

      to: peerId,

      offer
    }
  );


  // ============================================================
  // SHARING STATUS
  // ============================================================

  isSharing = true;

  updateShareButtons();


  await sendSignal(
    "sharing-status",
    {

      from: selfId,

      to: peerId,

      isSharing: true
    }
  );


  // ============================================================
  // BROWSER STOP SHARING
  // ============================================================

  const videoTrack =
    localStream.getVideoTracks()[0];

  if (videoTrack) {

    videoTrack.addEventListener(
      "ended",
      () => {

        stopSharing();
      },
      {
        once: true
      }
    );
  }
}


// ================================================================
// STOP SCREEN SHARING
// ================================================================

async function stopSharing() {

  if (
    localStream
  ) {

    localStream
      .getTracks()
      .forEach(
        (track) => {

          track.stop();
        }
      );

    localStream = null;
  }


  resetLocalVideo();


  isSharing = false;

  updateShareButtons();


  if (peerId) {

    await sendSignal(
      "sharing-status",
      {

        from: selfId,

        to: peerId,

        isSharing: false
      }
    );
  }


  cleanupPeerConnection();
}


// ================================================================
// SHARE BUTTON UI
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
  leaveRoom
);


async function leaveRoom() {

  try {

    // Stop local stream

    if (localStream) {

      localStream
        .getTracks()
        .forEach(
          (track) => {

            track.stop();
          }
        );

      localStream = null;
    }


    // Close WebRTC

    cleanupPeerConnection();


    // Remove presence + channel

    if (roomChannel) {

      try {

        await roomChannel.untrack();

      } catch (error) {

        console.warn(
          "Gagal untrack presence:",
          error
        );
      }


      await supabaseClient
        .removeChannel(
          roomChannel
        );

      roomChannel = null;
    }


  } catch (error) {

    console.error(
      "Leave room error:",
      error
    );
  }


  // Reset state

  currentRoomCode = null;

  peerId = null;

  isInRoom = false;

  isSharing = false;


  resetRemoteVideo();

  resetLocalVideo();

  updateShareButtons();


  // Reset form

  el.createdRoomInfo.classList.add(
    "hidden"
  );

  el.createRoomCode.value =
    "";

  el.createRoomPassword.value =
    "";

  el.joinRoomCode.value =
    "";

  el.joinRoomPassword.value =
    "";


  setConnectionStatus(
    "waiting"
  );


  goToEntryScreen();
}


// ================================================================
// BROWSER / TAB CLOSED
// ================================================================

window.addEventListener(
  "beforeunload",
  () => {

    if (localStream) {

      localStream
        .getTracks()
        .forEach(
          (track) => {

            track.stop();
          }
        );
    }

    if (roomChannel) {

      roomChannel.untrack();
    }
  }
);


// ================================================================
// INITIALIZATION
// ================================================================

updateShareButtons();

switchTab("create");

setConnectionStatus(
  "waiting"
);


console.log(
  "✅ P2P ScreenShare Supabase initialized."
);
