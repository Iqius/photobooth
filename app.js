'use strict';

/* ================= Pengaturan ================= */
const PREFIX = 'ldrbooth-v2-';       // awalan ID PeerJS agar tidak bentrok dengan aplikasi lain
const COUNT_FROM = 3;                // hitung mundur tiap foto (detik)
const CAPTURE_W = 960;               // lebar potongan foto final per orang
const PREVIEW_W = 480;               // lebar potongan untuk preview live (lebih ringan)
const ICE_SERVERS = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' },
  // Kalau koneksi sering gagal (misalnya di data seluler), tambahkan TURN server di sini:
  // { urls: 'turn:global.relay.metered.ca:80', username: 'USERNAME', credential: 'PASSWORD' },
];

// Penghapus background (MediaPipe Selfie Segmenter, jalan di browser)
const MP_BASE = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14';
// Model dicoba berurutan: dari Google dulu, lalu salinan di repo kamu sendiri (opsional, lihat README)
const MODEL_URLS = [
  'https://storage.googleapis.com/mediapipe-models/image_segmenter/selfie_segmenter/float16/latest/selfie_segmenter.tflite',
  'models/selfie_segmenter.tflite',
];

// Posisi dasar tiap orang di frame (0 = kiri, 1 = kanan). Pembuat room di kiri.
const BASE_X = { host: 0.31, guest: 0.69 };

/* ================= Frame / latar ================= */
const THEMES = {
  klasik: {
    name: 'Klasik', strip: '#ffffff', fg: '#16121c', sub: '#8a8494',
    sw: 'linear-gradient(180deg,#f4f1f9,#d6cde6)',
    scene(ctx, w, h) {
      const g = ctx.createLinearGradient(0, 0, 0, h);
      g.addColorStop(0, '#f4f1f9'); g.addColorStop(1, '#d6cde6');
      ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
      const r = ctx.createRadialGradient(w / 2, h * 1.05, 0, w / 2, h * 1.05, w * 0.6);
      r.addColorStop(0, 'rgba(70,50,110,.18)'); r.addColorStop(1, 'rgba(70,50,110,0)');
      ctx.fillStyle = r; ctx.fillRect(0, 0, w, h);
    },
  },
  malam: {
    name: 'Malam', strip: '#16121c', fg: '#f4f1f7', sub: '#9a93a6',
    sw: 'radial-gradient(circle at 50% 40%,#3b2f63,#120e1c)',
    scene(ctx, w, h) {
      const g = ctx.createRadialGradient(w * 0.5, h * 0.35, 0, w * 0.5, h * 0.35, w * 0.75);
      g.addColorStop(0, '#3b2f63'); g.addColorStop(1, '#120e1c');
      ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
      const rnd = seeded(7);
      for (let i = 0; i < 70; i++) {
        const x = rnd() * w, y = rnd() * h * 0.8, s = (0.4 + rnd() * 1.4) * w / 960;
        ctx.globalAlpha = 0.35 + rnd() * 0.6;
        ctx.fillStyle = '#fff';
        ctx.beginPath(); ctx.arc(x, y, s, 0, Math.PI * 2); ctx.fill();
      }
      ctx.globalAlpha = 1;
      ctx.fillStyle = '#f7ecc6';
      ctx.beginPath(); ctx.arc(w * 0.86, h * 0.17, w * 0.035, 0, Math.PI * 2); ctx.fill();
    },
  },
  pink: {
    name: 'Pink', strip: '#ffd3df', fg: '#5a1630', sub: '#a8516f',
    sw: 'linear-gradient(180deg,#ffc6d5,#ff98b3)',
    scene(ctx, w, h) {
      const g = ctx.createLinearGradient(0, 0, 0, h);
      g.addColorStop(0, '#ffc6d5'); g.addColorStop(1, '#ff98b3');
      ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
      const rnd = seeded(21);
      for (let i = 0; i < 16; i++) {
        const x = rnd() * w, y = rnd() * h * 0.75, r = (0.02 + rnd() * 0.05) * w;
        ctx.globalAlpha = 0.18 + rnd() * 0.25;
        ctx.fillStyle = '#fff';
        ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
      }
      ctx.globalAlpha = 1;
    },
  },
  film: {
    name: 'Film', strip: '#0e0e0e', fg: '#f2e9d8', sub: '#a39a88', holes: true,
    sw: 'linear-gradient(180deg,#6a5440,#2b2119)',
    scene(ctx, w, h) {
      const g = ctx.createLinearGradient(0, 0, 0, h);
      g.addColorStop(0, '#6a5440'); g.addColorStop(1, '#2b2119');
      ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
    },
    overlay(ctx, w, h) {          // vinyet di atas orang, kesan film lama
      const v = ctx.createRadialGradient(w / 2, h / 2, w * 0.3, w / 2, h / 2, w * 0.72);
      v.addColorStop(0, 'rgba(0,0,0,0)'); v.addColorStop(1, 'rgba(0,0,0,.55)');
      ctx.fillStyle = v; ctx.fillRect(0, 0, w, h);
    },
  },
};

function seeded(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/* ================= State ================= */
const $ = (s) => document.querySelector(s);
const state = {
  role: null,            // 'host' (pembuat room, kiri) atau 'guest' (kanan)
  code: null,
  peer: null, conn: null, call: null,
  localStream: null, remoteStream: null,
  cfg: { shots: 4, theme: 'pink', caption: 'jarak cuma angka' },
  pos: { host: { x: 0, s: 1 }, guest: { x: 0, s: 1 } },
  running: false,
  frames: [],
  resultCanvas: null,
  onResult: false,
};
const otherRole = () => (state.role === 'host' ? 'guest' : 'host');

/* ================= Util ================= */
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
function genCode() {
  const abc = 'abcdefghjkmnpqrstuvwxyz23456789';
  let s = '';
  for (let i = 0; i < 6; i++) s += abc[Math.floor(Math.random() * abc.length)];
  return s;
}
function roomUrl(code) { return `${location.origin}${location.pathname}?room=${code}`; }
function parseCode(input) {
  const v = (input || '').trim();
  const m = v.match(/[?&]room=([a-z0-9]+)/i);
  return (m ? m[1] : v).toLowerCase().replace(/[^a-z0-9]/g, '');
}
let toastTimer;
function toast(msg, ms = 3200) {
  const t = $('#toast');
  t.textContent = msg; t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.hidden = true; }, ms);
}
function show(name) {
  for (const id of ['home', 'invite', 'booth', 'result']) $('#screen-' + id).hidden = id !== name;
  state.onResult = name === 'result';
  window.scrollTo(0, 0);
}
function setStatus(text, kind) {
  const el = $('#status');
  el.hidden = false;
  el.className = 'status ' + (kind || '');
  $('#status-text').textContent = text;
}
function waitFor(test, timeout) {
  return new Promise((resolve) => {
    const t0 = Date.now();
    (function tick() {
      if (test() || Date.now() - t0 > timeout) return resolve();
      setTimeout(tick, 100);
    })();
  });
}

/* ================= Penghapus background ================= */
const seg = { ready: false, failed: false, local: null, remote: null, errors: 0 };

function makeFeed() {
  return { mask: document.createElement('canvas'), cut: document.createElement('canvas'),
    mctx: null, idata: null, hasMask: false, lastTime: -1, lastTs: 0, votes: 0, frames: 0, invert: false, decided: false };
}
const feeds = { local: makeFeed(), remote: makeFeed() };

function segChip(text, bad, retry) {
  const chip = $('#seg-chip');
  chip.hidden = false;
  chip.classList.toggle('bad', !!bad);
  $('#seg-text').textContent = text;
  $('#btn-seg-retry').hidden = !retry;
}

function withTimeout(promise, ms, msg) {
  return Promise.race([promise, new Promise((_, rej) => setTimeout(() => rej(new Error(msg)), ms))]);
}

async function loadSegmenter(forceCPU) {
  if (seg.loading) return;
  seg.loading = true; seg.ready = false; seg.failed = false; seg.errors = 0;
  for (const s of [seg.local, seg.remote]) { try { if (s) s.close(); } catch (_) {} }
  seg.local = seg.remote = null;
  for (const f of Object.values(feeds)) { f.hasMask = false; f.lastTime = -1; f.lastTs = 0; }
  segChip('Menyiapkan penghapus background…');
  updateStartBtn();

  let step = 'mengunduh library';
  try {
    const vision = await withTimeout(import(`${MP_BASE}/vision_bundle.mjs`), 30000, 'koneksi terlalu lambat');
    step = 'menyiapkan mesin AI';
    const files = await withTimeout(vision.FilesetResolver.forVisionTasks(`${MP_BASE}/wasm`), 30000, 'koneksi terlalu lambat');
    step = 'mengunduh model';
    const make = (url, delegate) => withTimeout(vision.ImageSegmenter.createFromOptions(files, {
      baseOptions: { modelAssetPath: url, delegate },
      runningMode: 'VIDEO',
      outputCategoryMask: false,
      outputConfidenceMasks: true,
    }), 40000, 'koneksi terlalu lambat');

    let lastErr = null;
    outer:
    for (const url of MODEL_URLS) {
      for (const delegate of forceCPU ? ['CPU'] : ['GPU', 'CPU']) {
        try {
          seg.local = await make(url, delegate);
          seg.remote = await make(url, delegate);
          seg.delegate = delegate;
          break outer;
        } catch (e) { lastErr = e; seg.local = seg.remote = null; }
      }
    }
    if (!seg.local) throw lastErr || new Error('model tidak bisa dimuat');
    seg.ready = true;
    $('#seg-chip').hidden = true;
  } catch (e) {
    console.warn('Penghapus background gagal', step, e);
    segFail(`Penghapus background gagal saat ${step} (${shortErr(e)}). Sementara frame dibagi dua.`);
  } finally {
    seg.loading = false;
    updateStartBtn();
  }
}

function shortErr(e) {
  const m = String((e && e.message) || e || 'tidak diketahui').split('\n')[0];
  return m.length > 90 ? m.slice(0, 90) + '…' : m;
}

function segFail(text) {
  seg.ready = false; seg.failed = true;
  segChip(text || 'Penghapus background berhenti. Sementara frame dibagi dua.', true, true);
  updateStartBtn();
}

function updateMask(feed, segmenter, video) {
  if (!segmenter || video.readyState < 2 || !video.videoWidth) return;
  if (video.currentTime === feed.lastTime) return;
  feed.lastTime = video.currentTime;
  const ts = Math.max(performance.now(), feed.lastTs + 1);
  feed.lastTs = ts;
  try {
    segmenter.segmentForVideo(video, ts, (res) => {
      const masks = res && res.confidenceMasks;
      if (!masks || !masks.length) return;
      const m = masks[masks.length - 1];
      writeMask(feed, m.getAsFloat32Array(), m.width, m.height);
    });
    seg.errors = 0;
  } catch (e) {
    if (++seg.errors > 8) {
      console.warn(e);
      if (seg.delegate === 'GPU') { seg.ready = false; loadSegmenter(true); }   // GPU bermasalah, pindah ke CPU
      else segFail(`Penghapus background berhenti (${shortErr(e)}). Sementara frame dibagi dua.`);
    }
  }
}

// Model tertentu memberi "peluang orang", ada juga "peluang latar". Deteksi otomatis:
// bagian tengah-bawah biasanya orang, pojok atas biasanya latar.
function decidePolarity(feed, d, w, h) {
  const avg = (x0, x1, y0, y1) => {
    let s = 0, n = 0;
    for (let y = Math.floor(y0 * h); y < Math.floor(y1 * h); y += 2)
      for (let x = Math.floor(x0 * w); x < Math.floor(x1 * w); x += 2) { s += d[y * w + x]; n++; }
    return n ? s / n : 0;
  };
  const center = avg(0.38, 0.62, 0.45, 1);
  const corners = (avg(0, 0.14, 0, 0.18) + avg(0.86, 1, 0, 0.18)) / 2;
  if (Math.abs(center - corners) > 0.25) feed.votes += center > corners ? 1 : -1;
  feed.frames++;
  if (Math.abs(feed.votes) >= 3 || feed.frames > 40) {
    feed.invert = feed.votes < 0;
    feed.decided = true;
  }
}

function writeMask(feed, data, w, h) {
  if (!feed.decided) decidePolarity(feed, data, w, h);
  const c = feed.mask;
  if (c.width !== w || c.height !== h || !feed.mctx) {
    c.width = w; c.height = h;
    feed.mctx = c.getContext('2d');
    feed.idata = feed.mctx.createImageData(w, h);
  }
  const px = feed.idata.data;
  const inv = feed.invert;
  for (let i = 0, j = 3; i < data.length; i++, j += 4) {
    const p = inv ? 1 - data[i] : data[i];
    let a = (p - 0.35) / 0.3;               // tepi lembut
    a = a < 0 ? 0 : a > 1 ? 1 : a;
    px[j] = a * 255;
  }
  feed.mctx.putImageData(feed.idata, 0, 0);
  feed.hasMask = true;
}

// Gambar video + mask ke kanvas (orang saja, latar transparan). Tidak dicerminkan di sini.
function buildCut(feed, video, targetW, canvas) {
  const vw = video.videoWidth, vh = video.videoHeight;
  const w = Math.min(targetW, vw), h = Math.round(w * vh / vw);
  const c = canvas || feed.cut;
  if (c.width !== w || c.height !== h) { c.width = w; c.height = h; }
  const x = c.getContext('2d');
  x.globalCompositeOperation = 'copy';
  x.drawImage(video, 0, 0, w, h);
  const cutOk = seg.ready && feed.hasMask;
  if (cutOk) {
    x.globalCompositeOperation = 'destination-in';
    x.imageSmoothingEnabled = true;
    x.drawImage(feed.mask, 0, 0, w, h);
  }
  x.globalCompositeOperation = 'source-over';
  return { canvas: c, cut: cutOk };
}

/* ================= Komposisi frame ================= */
function placeRect(role, sw, sh, W, H) {
  const p = state.pos[role];
  const dh = H * p.s;
  const dw = dh * sw / sh;
  const cx = W * (BASE_X[role] + p.x);
  return { x: cx - dw / 2, y: H - dh, w: dw, h: dh };   // menempel di bawah frame
}

function drawPerson(ctx, src, role, W, H, cut) {
  const sw = src.videoWidth || src.naturalWidth || src.width;
  const sh = src.videoHeight || src.naturalHeight || src.height;
  if (!sw || !sh) return;
  const r = placeRect(role, sw, sh, W, H);
  ctx.save();
  if (!cut) {                                   // tanpa penghapus background: bagi dua frame
    ctx.beginPath();
    if (role === 'host') ctx.rect(0, 0, W / 2, H); else ctx.rect(W / 2, 0, W / 2, H);
    ctx.clip();
  }
  ctx.translate(r.x + r.w, r.y);
  ctx.scale(-1, 1);                             // cermin seperti kamera depan
  ctx.drawImage(src, 0, 0, r.w, r.h);
  ctx.restore();
}

function drawScene(ctx, W, H, themeKey) {
  (THEMES[themeKey] || THEMES.pink).scene(ctx, W, H);
}
function drawOverlay(ctx, W, H, themeKey) {
  const th = THEMES[themeKey] || THEMES.pink;
  if (th.overlay) th.overlay(ctx, W, H);
}

/* ================= Preview live ================= */
const localVideo = () => $('#vid-local');
const remoteVideo = () => $('#vid-remote');
let turn = 0, lastDraw = 0, loopOn = false;

function startLoop() {
  if (loopOn) return;
  loopOn = true;
  requestAnimationFrame(loop);
}
function loop(t) {
  requestAnimationFrame(loop);
  if (!state.localStream || document.hidden || t - lastDraw < 33) return;
  lastDraw = t;
  if (seg.ready) {
    // bergantian antara video sendiri dan pasangan supaya HP tidak terlalu berat
    if (state.remoteStream && turn++ % 2 === 1) updateMask(feeds.remote, seg.remote, remoteVideo());
    else updateMask(feeds.local, seg.local, localVideo());
  }
  if (!state.onResult) drawStage();
}

function drawStage() {
  const cv = $('#stage-canvas');
  const ctx = cv.getContext('2d');
  const W = cv.width, H = cv.height;
  drawScene(ctx, W, H, state.cfg.theme);
  for (const role of ['host', 'guest']) {
    const mine = role === state.role;
    const video = mine ? localVideo() : remoteVideo();
    const feed = mine ? feeds.local : feeds.remote;
    if (!mine && !state.remoteStream) { drawWaiting(ctx, role, W, H); continue; }
    if (!video.videoWidth) continue;
    const { canvas, cut } = buildCut(feed, video, PREVIEW_W);
    drawPerson(ctx, canvas, role, W, H, cut);
  }
  drawOverlay(ctx, W, H, state.cfg.theme);
}

function drawWaiting(ctx, role, W, H) {
  const th = THEMES[state.cfg.theme] || THEMES.pink;
  const cx = W * BASE_X[role];
  ctx.save();
  ctx.globalAlpha = 0.35;
  ctx.strokeStyle = th.strip === '#ffffff' ? '#16121c' : th.fg;
  ctx.setLineDash([10, 8]);
  ctx.lineWidth = 3;
  ctx.beginPath(); ctx.arc(cx, H * 0.42, H * 0.12, 0, Math.PI * 2); ctx.stroke();
  ctx.beginPath(); ctx.ellipse(cx, H * 1.02, H * 0.24, H * 0.42, 0, Math.PI, 0); ctx.stroke();
  ctx.globalAlpha = 0.85;
  ctx.setLineDash([]);
  ctx.fillStyle = ctx.strokeStyle;
  ctx.font = `600 ${Math.round(W * 0.026)}px "Bricolage Grotesque", system-ui, sans-serif`;
  ctx.textAlign = 'center';
  ctx.fillText('Menunggu pasangan…', cx, H * 0.2);
  ctx.restore();
}

/* ================= Kamera ================= */
async function startCamera() {
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    throw new Error('Browser ini tidak mendukung kamera. Coba Chrome atau Safari versi terbaru.');
  }
  const video = { facingMode: 'user', width: { ideal: 1280 }, height: { ideal: 960 } };
  try {
    return await navigator.mediaDevices.getUserMedia({ video, audio: { echoCancellation: true, noiseSuppression: true } });
  } catch (e) {
    if (e.name === 'NotAllowedError') throw e;
    return await navigator.mediaDevices.getUserMedia({ video, audio: false });
  }
}
function cameraError(e) {
  if (e && e.name === 'NotAllowedError') return 'Akses kamera ditolak. Izinkan kamera di pengaturan browser, lalu coba lagi.';
  if (e && e.name === 'NotFoundError') return 'Kamera tidak ditemukan di perangkat ini.';
  if (e && e.name === 'NotReadableError') return 'Kamera sedang dipakai aplikasi lain. Tutup aplikasi itu lalu coba lagi.';
  return (e && e.message) || 'Kamera tidak bisa dinyalakan.';
}

function enterBooth() {
  const lv = localVideo();
  lv.srcObject = state.localStream;
  lv.muted = true;
  lv.play().catch(() => {});
  show('booth');
  loadSegmenter();
  startLoop();
  requestWakeLock();
}

function attachRemote(stream) {
  state.remoteStream = stream;
  feeds.remote.hasMask = false; feeds.remote.decided = false; feeds.remote.votes = 0; feeds.remote.frames = 0;
  const rv = remoteVideo();
  rv.srcObject = stream;
  rv.muted = false;
  rv.play().catch(() => {
    rv.muted = true;                       // Safari kadang memblokir suara otomatis
    rv.play().catch(() => {});
    $('#btn-unmute').hidden = false;
  });
  $('#btn-rejoin').hidden = true;
  updateStartBtn();
}

let wakeLock = null;
async function requestWakeLock() {
  try { if ('wakeLock' in navigator) wakeLock = await navigator.wakeLock.request('screen'); } catch (_) {}
}
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && state.localStream) requestWakeLock();
});

/* ================= Koneksi (PeerJS) ================= */
function newPeer(id) {
  const opts = { config: { iceServers: ICE_SERVERS } };
  return id ? new Peer(id, opts) : new Peer(opts);
}

function openHostPeer(code) {
  state.code = code;
  setStatus('Menyiapkan room…', 'wait');
  const peer = newPeer(PREFIX + code);
  state.peer = peer;

  peer.on('open', () => {
    $('#share-link').value = roomUrl(code);
    $('#share-bar').hidden = false;
    if (navigator.share) $('#btn-share-link').hidden = false;
    setStatus('Menunggu pasangan', 'wait');
  });
  peer.on('connection', (conn) => {
    if (state.conn && state.conn.open) {
      conn.on('open', () => { conn.send({ type: 'busy' }); setTimeout(() => conn.close(), 500); });
      return;
    }
    setupConn(conn);
  });
  peer.on('call', (call) => {
    if (state.call && state.remoteStream && state.call.open) { call.close(); return; }
    if (state.call) state.call.close();
    state.call = call;
    call.answer(state.localStream);
    setupCall(call);
  });
  peer.on('disconnected', () => { if (!peer.destroyed) peer.reconnect(); });
  peer.on('error', (err) => {
    if (err.type === 'unavailable-id') { peer.destroy(); openHostPeer(genCode()); return; }
    handlePeerError(err);
  });
}

function openGuestPeer() {
  setStatus('Menghubungkan…', 'wait');
  const peer = newPeer();
  state.peer = peer;
  peer.on('open', connectToHost);
  peer.on('disconnected', () => { if (!peer.destroyed) peer.reconnect(); });
  peer.on('error', handlePeerError);
}

function connectToHost() {
  if (!state.peer || state.peer.destroyed) return;
  setStatus('Menghubungkan…', 'wait');
  const id = PREFIX + state.code;
  setupConn(state.peer.connect(id, { reliable: true }));
  if (state.call) state.call.close();
  const call = state.peer.call(id, state.localStream);
  state.call = call;
  setupCall(call);
}

function setupConn(conn) {
  state.conn = conn;
  conn.on('open', () => {
    setStatus('Terhubung', 'ok');
    $('#btn-rejoin').hidden = true;
    if (state.role === 'host') sendCfg();
    sendPos();
    updateStartBtn();
  });
  conn.on('data', onData);
  conn.on('close', () => { if (state.conn === conn) { state.conn = null; partnerGone(); } });
  conn.on('error', () => {});
}

function setupCall(call) {
  if (!call) return;
  call.on('stream', attachRemote);
  call.on('close', () => {
    if (state.call !== call) return;
    state.remoteStream = null;
    remoteVideo().srcObject = null;
    updateStartBtn();
  });
  call.on('error', () => {});
}

function partnerGone() {
  state.remoteStream = null;
  remoteVideo().srcObject = null;
  updateStartBtn();
  if (state.role === 'host') {
    setStatus('Menunggu pasangan', 'wait');
    toast('Pasanganmu terputus. Room masih terbuka, dia bisa buka link yang sama lagi.');
  } else {
    setStatus('Terputus', 'bad');
    $('#btn-rejoin').hidden = false;
    toast('Koneksi terputus. Tekan "Sambung lagi".');
  }
}

function handlePeerError(err) {
  const t = err && err.type;
  if (t === 'peer-unavailable') {
    setStatus('Room tidak ditemukan', 'bad');
    toast('Room belum aktif. Pastikan pasanganmu sudah membuka room dan linknya benar.', 6000);
    $('#btn-rejoin').hidden = false;
    return;
  }
  if (t === 'browser-incompatible') { toast('Browser ini tidak mendukung video call. Coba Chrome atau Safari terbaru.', 6000); return; }
  if (t === 'network' || t === 'server-error' || t === 'socket-error' || t === 'socket-closed') {
    setStatus('Gangguan jaringan', 'bad');
    toast('Gagal menghubungi server penghubung. Periksa internet, lalu muat ulang halaman.', 6000);
    return;
  }
  console.warn('PeerJS error', err);
}

function sendSafe(msg) {
  if (state.conn && state.conn.open) { try { state.conn.send(msg); } catch (_) {} }
}

/* ================= Pesan antar perangkat ================= */
function cleanCfg(c) {
  const shots = Number(c && c.shots) === 3 ? 3 : 4;
  const theme = c && THEMES[c.theme] ? c.theme : 'pink';
  const caption = typeof (c && c.caption) === 'string' ? c.caption.slice(0, 40) : '';
  return { shots, theme, caption };
}
function cleanPos(p) {
  const x = clamp(Number(p && p.x) || 0, -0.3, 0.3);
  const s = clamp(Number(p && p.s) || 1, 0.6, 1.5);
  return { x, s };
}
const IMG_PREFIXES = ['data:image/webp;base64,', 'data:image/png;base64,', 'data:image/jpeg;base64,'];

function onData(msg) {
  if (!msg || typeof msg !== 'object') return;
  switch (msg.type) {
    case 'cfg':
      if (state.running) return;
      state.cfg = cleanCfg(msg.cfg);
      renderCfg();
      break;
    case 'pos':
      if (state.running) return;
      state.pos[otherRole()] = cleanPos(msg.pos);   // pasangan hanya mengatur posisinya sendiri
      break;
    case 'start':
      if (msg.pos) state.pos[otherRole()] = cleanPos(msg.pos);
      runSession(cleanCfg(msg.cfg));
      break;
    case 'shot':
      receiveShot(msg);
      break;
    case 'busy':
      toast('Room ini sudah berisi dua orang.', 6000);
      setStatus('Room penuh', 'bad');
      break;
  }
}

function sendCfg() { sendSafe({ type: 'cfg', cfg: state.cfg }); }
function sendPos() { if (state.role) sendSafe({ type: 'pos', pos: state.pos[state.role] }); }

function receiveShot(msg) {
  const i = Number(msg.i);
  const img = msg.img;
  if (!Number.isInteger(i) || !state.frames[i]) return;
  if (typeof img !== 'string' || img.length > 12e6 || !IMG_PREFIXES.some((p) => img.startsWith(p))) return;
  const other = otherRole();
  state.frames[i][other] = { img, cut: !!msg.cut };
  state.frames[i].provisional[other] = false;
  if (state.onResult && !state.running) buildResult();   // ganti foto sementara dengan versi asli
}

/* ================= Sesi foto ================= */
function toImageURL(canvas, cut) {
  if (cut) {
    const webp = canvas.toDataURL('image/webp', 0.85);   // webp menyimpan transparansi dan lebih kecil
    return webp.startsWith('data:image/webp') ? webp : canvas.toDataURL('image/png');
  }
  return canvas.toDataURL('image/jpeg', 0.88);
}

function captureOwn() {
  const v = localVideo();
  if (!v.videoWidth) return null;
  if (seg.ready) { feeds.local.lastTime = -1; updateMask(feeds.local, seg.local, v); }   // mask untuk frame persis ini
  const { canvas, cut } = buildCut(feeds.local, v, CAPTURE_W, document.createElement('canvas'));
  return { img: toImageURL(canvas, cut), cut };
}
function captureRemoteFallback() {
  const v = remoteVideo();
  if (!state.remoteStream || !v.videoWidth) return null;
  const { canvas, cut } = buildCut(feeds.remote, v, 640, document.createElement('canvas'));
  return { img: toImageURL(canvas, cut), cut };
}

async function runSession(cfg) {
  if (state.running) return;
  state.running = true;
  state.cfg = cfg;
  renderCfg();
  lockControls(true);
  show('booth');

  const mine = state.role, other = otherRole();
  state.frames = Array.from({ length: cfg.shots }, () => ({ host: null, guest: null, provisional: {} }));
  const counter = $('#shot-counter');
  counter.hidden = false;

  for (let i = 0; i < cfg.shots; i++) {
    counter.textContent = `FOTO ${i + 1} / ${cfg.shots}`;
    for (let c = COUNT_FROM; c >= 1; c--) { showCount(c); await sleep(1000); }
    flash();
    const own = captureOwn();
    if (own) {
      state.frames[i][mine] = own;
      sendSafe({ type: 'shot', i, img: own.img, cut: own.cut });
    }
    // Foto sementara dari video pasangan, diganti saat foto asli dari HP-nya tiba
    if (!state.frames[i][other]) {
      const fb = captureRemoteFallback();
      if (fb) { state.frames[i][other] = fb; state.frames[i].provisional[other] = true; }
    }
    await sleep(i < cfg.shots - 1 ? 1100 : 300);
  }

  counter.textContent = 'MENYUSUN STRIP…';
  await waitFor(() => state.frames.every((f) => f[other] && !f.provisional[other]), 5000);
  counter.hidden = true;
  state.running = false;
  lockControls(false);
  await buildResult();
  show('result');
}

function showCount(n) {
  const el = $('#countdown');
  el.textContent = n;
  el.classList.remove('show');
  void el.offsetWidth;
  el.classList.add('show');
}
function flash() {
  const el = $('#flash');
  el.classList.remove('go');
  void el.offsetWidth;
  el.classList.add('go');
}

/* ================= Photo strip ================= */
const imgCache = new Map();
function loadImg(src) {
  if (imgCache.has(src)) return imgCache.get(src);
  const p = new Promise((res) => {
    const im = new Image();
    im.onload = () => res(im);
    im.onerror = () => res(null);
    im.src = src;
  });
  imgCache.set(src, p);
  return p;
}

async function renderStrip(frames, cfg) {
  const th = THEMES[cfg.theme] || THEMES.pink;
  try {
    await Promise.all([
      document.fonts.load('600 30px "Bricolage Grotesque"'),
      document.fonts.load('400 14px "DM Mono"'),
    ]);
  } catch (_) {}

  const S = 2;                                      // skala ekspor
  const FW = 520, FH = 390, PAD = 22, ROWGAP = 12, FOOT = 118;
  const SIDE = th.holes ? 30 : 0;
  const n = frames.length;
  const W = SIDE * 2 + PAD * 2 + FW;
  const H = PAD + n * FH + (n - 1) * ROWGAP + FOOT;

  const c = document.createElement('canvas');
  c.width = W * S; c.height = H * S;
  const ctx = c.getContext('2d');
  ctx.scale(S, S);
  ctx.fillStyle = th.strip;
  ctx.fillRect(0, 0, W, H);

  if (th.holes) {
    ctx.fillStyle = '#f2e9d8';
    for (let y = 14; y < H - 14; y += 30) {
      roundRect(ctx, 9, y, 12, 16, 3); ctx.fill();
      roundRect(ctx, W - 21, y, 12, 16, 3); ctx.fill();
    }
  }

  // Tiap frame digambar penuh resolusi lalu ditempel ke strip
  const fc = document.createElement('canvas');
  fc.width = FW * S; fc.height = FH * S;
  const fctx = fc.getContext('2d');
  for (let i = 0; i < n; i++) {
    drawScene(fctx, fc.width, fc.height, cfg.theme);
    for (const role of ['host', 'guest']) {
      const data = frames[i][role];
      if (!data) continue;
      const im = await loadImg(data.img);
      if (im) drawPerson(fctx, im, role, fc.width, fc.height, data.cut);
    }
    drawOverlay(fctx, fc.width, fc.height, cfg.theme);
    const y = PAD + i * (FH + ROWGAP);
    ctx.drawImage(fc, SIDE + PAD, y, FW, FH);
  }

  const footTop = PAD + n * FH + (n - 1) * ROWGAP;
  const cx = W / 2;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'alphabetic';
  const caption = (cfg.caption || '').trim();
  if (caption) {
    let size = 30;
    ctx.fillStyle = th.fg;
    do { ctx.font = `600 ${size}px "Bricolage Grotesque", system-ui, sans-serif`; size -= 1; }
    while (ctx.measureText(caption).width > W - SIDE * 2 - 40 && size > 14);
    ctx.fillText(caption, cx, footTop + 56);
  }
  const d = new Date();
  const pad2 = (v) => String(v).padStart(2, '0');
  const stamp = `${pad2(d.getDate())} · ${pad2(d.getMonth() + 1)} · ${d.getFullYear()}   ♡   BOOTH LDR`;
  ctx.fillStyle = th.sub;
  ctx.font = '400 13px "DM Mono", ui-monospace, monospace';
  ctx.fillText(stamp, cx, footTop + (caption ? 88 : 66));
  return c;
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

async function buildResult() {
  const canvas = await renderStrip(state.frames, state.cfg);
  state.resultCanvas = canvas;
  $('#result-img').src = canvas.toDataURL('image/png');
  $('#btn-share-img').hidden = !(navigator.canShare && navigator.share);
}

function stripFileName() {
  const d = new Date();
  const p = (v) => String(v).padStart(2, '0');
  return `booth-ldr-${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}.png`;
}
function stripBlob() {
  return new Promise((res) => state.resultCanvas.toBlob(res, 'image/png'));
}
async function downloadStrip() {
  if (!state.resultCanvas) return;
  const blob = await stripBlob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = stripFileName();
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}
async function shareStrip() {
  if (!state.resultCanvas) return;
  const file = new File([await stripBlob()], stripFileName(), { type: 'image/png' });
  if (navigator.canShare && navigator.canShare({ files: [file] })) {
    try { await navigator.share({ files: [file], title: 'Booth LDR' }); } catch (_) {}
  } else {
    downloadStrip();
  }
}

/* ================= Kontrol ================= */
function buildThemeChips() {
  const wrap = $('#themes');
  wrap.innerHTML = '';
  for (const [key, th] of Object.entries(THEMES)) {
    const label = document.createElement('label');
    label.innerHTML = `<input type="radio" name="theme" value="${key}"><span><i></i>${th.name}</span>`;
    label.querySelector('i').style.setProperty('--sw', th.sw);
    wrap.appendChild(label);
  }
}

function renderCfg() {
  document.querySelectorAll('input[name="shots"]').forEach((r) => (r.checked = Number(r.value) === state.cfg.shots));
  document.querySelectorAll('input[name="theme"]').forEach((r) => (r.checked = r.value === state.cfg.theme));
  const cap = $('#caption');
  if (document.activeElement !== cap) cap.value = state.cfg.caption;
}
function renderPos() {
  if (!state.role) return;
  const p = state.pos[state.role];
  $('#pos-x').value = Math.round(p.x * 100);
  $('#pos-s').value = Math.round(p.s * 100);
}

function lockControls(on) {
  $('.controls').classList.toggle('locked', on);
  document.querySelectorAll('.controls input, .pose input').forEach((el) => (el.disabled = on));
  updateStartBtn();
}

function updateStartBtn() {
  const connected = !!(state.conn && state.conn.open && state.remoteStream);
  const segSettled = seg.ready || seg.failed;
  const btn = $('#btn-start');
  btn.disabled = !connected || !segSettled || state.running;
  let hint = 'Menunggu pasangan terhubung.';
  if (state.running) hint = 'Lagi foto… tetap di depan kamera.';
  else if (connected && !segSettled) hint = 'Sebentar, penghapus background masih disiapkan.';
  else if (connected) hint = 'Siapa pun boleh menekan. Hitung mundur muncul di kedua layar.';
  $('#start-hint').textContent = hint;
}

let capTimer, posTimer;
function bindControls() {
  document.querySelectorAll('input[name="shots"]').forEach((r) => r.addEventListener('change', () => {
    state.cfg.shots = Number(r.value) === 3 ? 3 : 4; sendCfg();
  }));
  $('#themes').addEventListener('change', (e) => {
    if (e.target.name === 'theme') { state.cfg.theme = e.target.value; sendCfg(); }
  });
  $('#caption').addEventListener('input', (e) => {
    state.cfg.caption = e.target.value.slice(0, 40);
    clearTimeout(capTimer); capTimer = setTimeout(sendCfg, 300);
  });
  const onPos = () => {
    if (!state.role) return;
    state.pos[state.role] = cleanPos({ x: $('#pos-x').value / 100, s: $('#pos-s').value / 100 });
    clearTimeout(posTimer); posTimer = setTimeout(sendPos, 80);
  };
  $('#pos-x').addEventListener('input', onPos);
  $('#pos-s').addEventListener('input', onPos);
  $('#btn-pos-reset').addEventListener('click', () => {
    if (!state.role || state.running) return;
    state.pos[state.role] = { x: 0, s: 1 };
    renderPos(); sendPos();
  });
  $('#btn-start').addEventListener('click', () => {
    if (state.running || !(state.conn && state.conn.open)) return;
    const cfg = cleanCfg(state.cfg);
    sendSafe({ type: 'start', cfg, pos: state.pos[state.role] });
    runSession(cfg);
  });
}

/* ================= Alur halaman ================= */
async function begin(role, btn, label) {
  btn.disabled = true; btn.textContent = 'Menyalakan kamera…';
  try {
    state.localStream = await startCamera();
  } catch (e) {
    toast(cameraError(e), 6000);
    btn.disabled = false; btn.textContent = label;
    return false;
  }
  state.role = role;
  renderPos();
  enterBooth();
  return true;
}
async function createRoom() {
  if (await begin('host', $('#btn-create'), 'Buat room')) openHostPeer(genCode());
}
async function joinRoom() {
  if (await begin('guest', $('#btn-join'), 'Nyalakan kamera & gabung')) openGuestPeer();
}

function leaveRoom() {
  try { if (state.conn) state.conn.close(); } catch (_) {}
  try { if (state.call) state.call.close(); } catch (_) {}
  try { if (state.peer) state.peer.destroy(); } catch (_) {}
  if (state.localStream) state.localStream.getTracks().forEach((t) => t.stop());
  location.href = location.pathname;
}

async function copyLink() {
  const input = $('#share-link');
  try {
    await navigator.clipboard.writeText(input.value);
    toast('Link disalin. Kirim ke pasanganmu.');
  } catch (_) {
    input.select();
    toast('Tekan Ctrl+C (atau tahan lalu Salin) untuk menyalin.');
  }
}

function init() {
  if (typeof Peer === 'undefined') toast('Library video gagal dimuat. Periksa internet lalu muat ulang.', 8000);
  buildThemeChips();
  renderCfg();
  bindControls();

  const room = parseCode(new URLSearchParams(location.search).get('room'));
  if (room) {
    state.code = room;
    $('#invite-code').textContent = room.toUpperCase();
    show('invite');
  } else {
    show('home');
  }

  $('#btn-create').addEventListener('click', createRoom);
  $('#btn-join').addEventListener('click', joinRoom);
  $('#join-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const code = parseCode($('#join-code').value);
    if (code.length < 4) { toast('Masukkan kode room atau link dari pasanganmu.'); return; }
    location.href = roomUrl(code);
  });
  $('#btn-copy').addEventListener('click', copyLink);
  $('#btn-share-link').addEventListener('click', () => {
    navigator.share({ title: 'Booth LDR', text: 'Yuk foto bareng di photobooth!', url: $('#share-link').value }).catch(() => {});
  });
  $('#btn-unmute').addEventListener('click', () => {
    const rv = remoteVideo(); rv.muted = false; rv.play().catch(() => {});
    $('#btn-unmute').hidden = true;
  });
  $('#btn-rejoin').addEventListener('click', () => {
    $('#btn-rejoin').hidden = true;
    if (state.peer && state.peer.disconnected && !state.peer.destroyed) state.peer.reconnect();
    connectToHost();
  });
  $('#btn-seg-retry').addEventListener('click', () => loadSegmenter(seg.delegate === 'GPU'));
  $('#btn-leave').addEventListener('click', leaveRoom);
  $('#btn-download').addEventListener('click', downloadStrip);
  $('#btn-share-img').addEventListener('click', shareStrip);
  $('#btn-again').addEventListener('click', () => show('booth'));
}

init();
