/* =====================================================================
   gate.js — shared Firebase auth gate + admin console + troll commands.

   Loaded by BOTH sites (same origin → shared login session):
     • https://pinaple123.github.io/            (the launcher, index.html)
     • https://pinaple123.github.io/aple.github.io/   (the MonkeyGG2 fork)

   It is fully self-contained: if the host page already has the gate /
   admin / header elements (the launcher does), it reuses them; otherwise
   it injects everything itself (the monkey site). So kicking, banning,
   messages, jumpscares, progress-resets and trolls all work on both.
   ===================================================================== */
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import {
  getAuth, createUserWithEmailAndPassword, signInWithEmailAndPassword,
  signOut, onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";
import {
  getDatabase, ref, set, get, update, remove, onValue, onDisconnect, serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-database.js";

/* ---- Firebase config (web keys are public by design) ---- */
const firebaseConfig = {
  apiKey:            "AIzaSyAQnzxU2g3HPxVIS16OZALUphrYKj4_ps4",
  authDomain:        "thing-a64a1.firebaseapp.com",
  databaseURL:       "https://thing-a64a1-default-rtdb.asia-southeast1.firebasedatabase.app",
  projectId:         "thing-a64a1",
  storageBucket:     "thing-a64a1.firebasestorage.app",
  messagingSenderId: "31043180242",
  appId:             "1:31043180242:web:46119b626ddd5b08527f0b"
};
const ADMIN_EMAIL = "taamatthewpuvis@gmail.com";

/* =====================================================================
   1. Make sure the DOM + CSS this script needs exist (inject if missing)
   ===================================================================== */
injectStyles();
ensureDom();

const gate      = document.getElementById("gate");
const authTitle = document.getElementById("authTitle");
const authEmail = document.getElementById("authEmail");
const authPass  = document.getElementById("authPass");
const authSubmit= document.getElementById("authSubmit");
const authMsg   = document.getElementById("authMsg");
const toggleLink= document.getElementById("toggleLink");
const authToggle= document.getElementById("authToggle");
const setupNote = document.getElementById("setupNote");
const whoEl     = document.getElementById("who");
const logoutBtn = document.getElementById("logoutBtn");
const adminBtn  = document.getElementById("adminBtn");
const adminPane = document.getElementById("admin");
const adminClose= document.getElementById("adminClose");
const moreGames = document.getElementById("moreGames"); // launcher-only, may be null

const app  = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db   = getDatabase(app);

let mode = "signin";
let me   = null;
let myProfile = null;
let sessionKickBaseline = null;
let cmdBaseline = null;
let selfUnsub = null;
let usersUnsub = null, statusUnsub = null;
let statusMap = {};

/* ---------------- Auth form ---------------- */
function setMode(m) {
  mode = m;
  authTitle.textContent = m === "signin" ? "Sign in" : "Create account";
  authSubmit.textContent = m === "signin" ? "Sign in" : "Sign up";
  authToggle.innerHTML = m === "signin"
    ? 'No account? <a id="toggleLink">Create one</a>'
    : 'Already have an account? <a id="toggleLink">Sign in</a>';
  document.getElementById("toggleLink").onclick = () => setMode(m === "signin" ? "signup" : "signin");
  authMsg.textContent = "";
}
toggleLink.onclick = () => setMode("signup");

function showMsg(text, kind) { authMsg.textContent = text; authMsg.className = "msg " + (kind || ""); }

authSubmit.onclick = async () => {
  const email = authEmail.value.trim();
  const pass  = authPass.value;
  if (!email || !pass) { showMsg("Enter email and password.", "err"); return; }
  if (mode === "signup" && pass.length < 6) { showMsg("Password must be at least 6 characters.", "err"); return; }
  authSubmit.disabled = true;
  showMsg(mode === "signin" ? "Signing in…" : "Creating account…", "");
  try {
    if (mode === "signin") {
      await signInWithEmailAndPassword(auth, email, pass);
    } else {
      const cred = await createUserWithEmailAndPassword(auth, email, pass);
      const isAdmin = email.toLowerCase() === ADMIN_EMAIL.toLowerCase();
      await set(ref(db, "users/" + cred.user.uid), {
        email,
        role: isAdmin ? "admin" : "user",
        banned: false,
        allowSecondSite: isAdmin ? true : false,
        createdAt: serverTimestamp()
      });
    }
  } catch (e) {
    showMsg(prettyError(e), "err");
  } finally {
    authSubmit.disabled = false;
  }
};
authPass.addEventListener("keydown", e => { if (e.key === "Enter") authSubmit.click(); });

function prettyError(e) {
  const c = (e && e.code) || "";
  if (c.includes("invalid-credential") || c.includes("wrong-password") || c.includes("user-not-found"))
    return "Wrong email or password.";
  if (c.includes("email-already-in-use")) return "That email already has an account — sign in instead.";
  if (c.includes("invalid-email")) return "That's not a valid email.";
  if (c.includes("weak-password")) return "Password too weak (min 6 characters).";
  if (c.includes("too-many-requests")) return "Too many attempts — wait a bit and try again.";
  if (c.includes("network")) return "Network error — check your connection.";
  return (e && e.message) || "Something went wrong.";
}

/* ---------------- Auth state ---------------- */
onAuthStateChanged(auth, async (user) => {
  if (selfUnsub) { selfUnsub(); selfUnsub = null; }
  if (usersUnsub) { usersUnsub(); usersUnsub = null; }
  if (statusUnsub) { statusUnsub(); statusUnsub = null; }

  if (!user) { showLoggedOut(); return; }
  me = user;

  const uref = ref(db, "users/" + user.uid);
  let snap = await get(uref);
  if (!snap.exists()) {
    const isAdmin = (user.email || "").toLowerCase() === ADMIN_EMAIL.toLowerCase();
    await set(uref, {
      email: user.email || "",
      role: isAdmin ? "admin" : "user",
      banned: false,
      allowSecondSite: isAdmin ? true : false,
      createdAt: serverTimestamp()
    });
    snap = await get(uref);
  }
  if ((user.email || "").toLowerCase() === ADMIN_EMAIL.toLowerCase() && snap.val().role !== "admin") {
    await update(uref, { role: "admin", allowSecondSite: true });
  }

  startPresence(user.uid);

  sessionKickBaseline = undefined;
  cmdBaseline = undefined;
  selfUnsub = onValue(uref, (s) => {
    const u = s.val();
    if (!u) { forceOut("Your account was removed by an admin."); return; }
    myProfile = u;

    if (u.banned) { forceOut("You have been banned from this site."); return; }

    if (sessionKickBaseline === undefined) {
      sessionKickBaseline = u.kickAt || 0;
    } else if ((u.kickAt || 0) > sessionKickBaseline) {
      forceOut("You were kicked by an admin. Reloading…", true);
      return;
    }

    // Live commands (message / jumpscare / reset / troll) — fire once each
    const c = u.cmd;
    if (cmdBaseline === undefined) {
      cmdBaseline = (c && c.at) || 0;
    } else if (c && (c.at || 0) > cmdBaseline) {
      cmdBaseline = c.at;
      runCommand(c);
    }

    applyProfileToUI(u);
  });
});

function showLoggedOut() {
  me = null; myProfile = null;
  gate.classList.remove("hidden");
  setMode("signin");
  authEmail.value = ""; authPass.value = "";
  whoEl.textContent = "";
  logoutBtn.style.display = "none";
  adminBtn.style.display = "none";
  adminPane.classList.remove("open");
  if (moreGames) moreGames.classList.add("disabled");
  document.getElementById("authForm").style.display = "";
}

function applyProfileToUI(u) {
  gate.classList.add("hidden");
  logoutBtn.style.display = "";
  const admin = u.role === "admin";
  whoEl.innerHTML = "Hi, <b>" + escapeHtml(u.email || me.email) + "</b>" + (admin ? " (admin)" : "");
  adminBtn.style.display = admin ? "" : "none";
  if (admin) startAdminFeed();
  if (moreGames) {
    if (u.allowSecondSite || admin) moreGames.classList.remove("disabled");
    else moreGames.classList.add("disabled");
  }
}

async function forceOut(message, reload) {
  try { await goOffline(); } catch {}
  await signOut(auth);
  alert(message);
  if (reload) location.reload();
}

logoutBtn.onclick = async () => { try { await goOffline(); } catch {} await signOut(auth); };

/* ---------------- Presence ---------------- */
let myStatusRef = null;
function startPresence(uid) {
  myStatusRef = ref(db, "status/" + uid);
  const connRef = ref(db, ".info/connected");
  onValue(connRef, (s) => {
    if (s.val() === false) return;
    onDisconnect(myStatusRef).set({ online: false, lastSeen: serverTimestamp() }).then(() => {
      set(myStatusRef, { online: true, lastSeen: serverTimestamp() });
    });
  });
}
async function goOffline() {
  if (myStatusRef) await set(myStatusRef, { online: false, lastSeen: serverTimestamp() });
}

/* ---------------- Admin console ---------------- */
adminBtn.onclick = () => adminPane.classList.add("open");
adminClose.onclick = () => adminPane.classList.remove("open");

let usersMap = {};
function startAdminFeed() {
  if (usersUnsub || statusUnsub) return;
  usersUnsub  = onValue(ref(db, "users"),  (s) => { usersMap = s.val() || {}; renderUsers(); });
  statusUnsub = onValue(ref(db, "status"), (s) => { statusMap = s.val() || {}; renderUsers(); });
}

function renderUsers() {
  const tbody = document.getElementById("userRows");
  if (!tbody) return;
  const uids = Object.keys(usersMap);
  document.getElementById("adminCount").textContent = uids.length + " user" + (uids.length === 1 ? "" : "s");
  tbody.innerHTML = "";
  uids.sort((a, b) => {
    const oa = (statusMap[a] && statusMap[a].online) ? 0 : 1;
    const ob = (statusMap[b] && statusMap[b].online) ? 0 : 1;
    if (oa !== ob) return oa - ob;
    return (usersMap[a].email || "").localeCompare(usersMap[b].email || "");
  });
  for (const uid of uids) {
    const u = usersMap[uid];
    const st = statusMap[uid] || {};
    const online = !!st.online;
    const isMe = uid === me.uid;
    const isAdmin = u.role === "admin";
    const allowed = !!u.allowSecondSite || isAdmin;

    const tr = document.createElement("tr");
    tr.innerHTML =
      '<td><span class="dot ' + (online ? "on" : "off") + '"></span>' + (online ? "Online" : "Offline") + '</td>' +
      '<td class="email">' + escapeHtml(u.email || "(no email)") + (isMe ? ' <span class="muted">(you)</span>' : "") + '</td>' +
      '<td>' + (u.banned ? '<span class="pill banned">banned</span> ' : "") +
               '<span class="pill ' + (isAdmin ? "admin" : "user") + '">' + (isAdmin ? "admin" : "user") + '</span></td>' +
      '<td class="muted">' + (online ? "now" : timeAgo(st.lastSeen)) + '</td>' +
      '<td><button class="b-toggle ' + (allowed ? "on" : "") + '" data-act="site" data-uid="' + uid + '"' + (isAdmin ? " disabled title='admins always allowed'" : "") + '>' +
          (allowed ? "Allowed ✓" : "Blocked") + '</button></td>' +
      '<td>' +
        (isMe ? '<span class="muted">—</span>' :
          (u.banned
            ? '<button class="b-unban" data-act="unban" data-uid="' + uid + '">Unban</button>'
            : '<button class="b-ban" data-act="ban" data-uid="' + uid + '">Ban</button>') +
          '<button class="b-kick" data-act="kick" data-uid="' + uid + '"' + (online ? "" : " disabled") + '>Kick</button>' +
          '<button class="b-msg"   data-act="msg"   data-uid="' + uid + '">💬 Msg</button>' +
          '<button class="b-scare" data-act="scare" data-uid="' + uid + '"' + (online ? "" : " disabled title='only works while online'") + '>😱 Scare</button>' +
          '<button class="b-reset" data-act="reset" data-uid="' + uid + '">🔄 Reset</button>' +
          '<button class="b-troll" data-act="troll" data-uid="' + uid + '"' + (online ? "" : " disabled title='only works while online'") + '>🤡 Troll</button>' +
          '<button class="b-admin" data-act="role" data-uid="' + uid + '">' + (isAdmin ? "Remove admin" : "Make admin") + '</button>' +
          '<button class="b-del"   data-act="del"   data-uid="' + uid + '">🗑 Delete</button>'
        ) +
      '</td>';
    tbody.appendChild(tr);
  }
  tbody.querySelectorAll("button[data-act]").forEach(btn => {
    btn.onclick = () => adminAction(btn.dataset.act, btn.dataset.uid);
  });
}

async function adminAction(act, uid) {
  const u = usersMap[uid] || {};
  const uref = ref(db, "users/" + uid);
  try {
    if (act === "site") {
      await update(uref, { allowSecondSite: !u.allowSecondSite });
    } else if (act === "ban") {
      if (!confirm("Ban " + (u.email || uid) + "? They'll be logged out and can't sign back in.")) return;
      await update(uref, { banned: true, kickAt: serverTimestamp() });
    } else if (act === "unban") {
      await update(uref, { banned: false });
    } else if (act === "kick") {
      await update(uref, { kickAt: serverTimestamp() });
    } else if (act === "role") {
      const makeAdmin = u.role !== "admin";
      if (!confirm((makeAdmin ? "Make " : "Remove admin from ") + (u.email || uid) + "?")) return;
      await update(uref, { role: makeAdmin ? "admin" : "user" });
    } else if (act === "msg") {
      const text = prompt("Send a message to " + (u.email || uid) + ":");
      if (!text) return;
      await update(uref, { cmd: { type: "message", text, at: serverTimestamp() } });
    } else if (act === "scare") {
      await update(uref, { cmd: { type: "jumpscare", at: serverTimestamp() } });
    } else if (act === "reset") {
      if (!confirm("Reset ALL game progress for " + (u.email || uid) + "? (clears their saved games; their page reloads)")) return;
      await update(uref, { cmd: { type: "resetProgress", at: serverTimestamp() } });
    } else if (act === "troll") {
      const kind = prompt(
        "Troll " + (u.email || uid) + " with which effect?\n\n" +
        "flip · spin · invert · shrink · rickroll · reset", "flip");
      if (!kind) return;
      await update(uref, { cmd: { type: "troll", kind: kind.trim().toLowerCase(), at: serverTimestamp() } });
    } else if (act === "del") {
      if (!confirm("Delete " + (u.email || uid) + "?\n\nRemoves their account record and logs them out. " +
                   "(Note: if they sign in again with the same email/password they reappear as a new user — " +
                   "fully deleting the login needs the Firebase Admin SDK, which a static site can't run. " +
                   "Use Ban to keep someone out for good.)")) return;
      await remove(ref(db, "users/" + uid));
      try { await remove(ref(db, "status/" + uid)); } catch {}
    }
  } catch (e) {
    alert("Action failed: " + (e.message || e));
  }
}

/* =====================================================================
   2. Command reactions — run on the TARGET user's screen, any page
   ===================================================================== */
function runCommand(c) {
  if (!c || !c.type) return;
  if (c.type === "message")        showAdminMessage(c.text || "");
  else if (c.type === "jumpscare") jumpscare();
  else if (c.type === "resetProgress") resetProgress();
  else if (c.type === "troll")     applyTroll(c.kind || "flip");
}

function showAdminMessage(text) {
  let o = document.getElementById("gateMsgOverlay");
  if (!o) { o = document.createElement("div"); o.id = "gateMsgOverlay"; o.className = "gate-modal"; document.body.appendChild(o); }
  o.innerHTML =
    '<div class="gate-modal-box">' +
      '<div class="gate-modal-title">📢 Message from admin</div>' +
      '<div class="gate-modal-text"></div>' +
      '<button class="gate-modal-ok">OK</button>' +
    '</div>';
  o.querySelector(".gate-modal-text").textContent = text;
  o.style.display = "flex";
  o.querySelector(".gate-modal-ok").onclick = () => { o.style.display = "none"; };
}

function jumpscare() {
  const o = document.createElement("div");
  o.className = "gate-scare";
  o.innerHTML = '<div class="gate-scare-face">😱</div>';
  document.body.appendChild(o);
  playScream();
  setTimeout(() => o.remove(), 2600);
}

function playScream() {
  try {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    const ctx = new AC();
    const dur = 2.2;
    const buffer = ctx.createBuffer(1, Math.floor(ctx.sampleRate * dur), ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < data.length; i++) {
      data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / data.length, 0.25);
    }
    const src = ctx.createBufferSource(); src.buffer = buffer;
    const bp = ctx.createBiquadFilter(); bp.type = "bandpass"; bp.frequency.value = 1600; bp.Q.value = 0.6;
    const g = ctx.createGain(); g.gain.value = 0.7;
    src.connect(bp); bp.connect(g); g.connect(ctx.destination);
    const osc = ctx.createOscillator(); osc.type = "sawtooth"; osc.frequency.value = 140;
    const og = ctx.createGain(); og.gain.value = 0.18; osc.connect(og); og.connect(ctx.destination);
    src.start(); osc.start();
    osc.stop(ctx.currentTime + dur); src.stop(ctx.currentTime + dur);
  } catch (e) {}
}

function resetProgress() {
  try { localStorage.clear(); } catch {}
  try {
    if (window.indexedDB && indexedDB.databases) {
      indexedDB.databases().then(dbs => dbs.forEach(d => {
        // keep Firebase's own auth store so we don't log them out
        if (d.name && !/firebase|firebaseLocalStorage/i.test(d.name)) indexedDB.deleteDatabase(d.name);
      })).catch(() => {});
    }
  } catch {}
  alert("Your game progress has been reset by an admin.");
  location.reload();
}

function applyTroll(kind) {
  const r = document.documentElement;
  r.style.transition = "transform .8s ease";
  removeSpin();
  switch (kind) {
    case "flip":     r.style.transform = "rotate(180deg)"; break;
    case "spin":     r.style.transform = ""; injectSpin(); break;
    case "invert":   r.style.filter = "invert(1) hue-rotate(180deg)"; break;
    case "shrink":   r.style.transformOrigin = "top left"; r.style.transform = "scale(0.18)"; break;
    case "rickroll": rickroll(); break;
    case "reset":
    case "normal":   r.style.transform = ""; r.style.filter = ""; removeSpin(); removeRick(); break;
    default:         r.style.transform = "rotate(180deg)";
  }
}
function injectSpin() { document.documentElement.classList.add("gate-spinning"); }
function removeSpin() { document.documentElement.classList.remove("gate-spinning"); }
function rickroll() {
  if (document.getElementById("gateRick")) return;
  const o = document.createElement("div");
  o.id = "gateRick"; o.className = "gate-modal"; o.style.zIndex = "100003"; o.style.display = "flex";
  o.innerHTML =
    '<div style="position:relative;width:90vw;max-width:900px;aspect-ratio:16/9">' +
      '<iframe width="100%" height="100%" src="https://www.youtube.com/embed/dQw4w9WgXcQ?autoplay=1" ' +
      'frameborder="0" allow="autoplay; encrypted-media" allowfullscreen></iframe>' +
      '<button class="gate-modal-ok" style="position:absolute;top:-42px;right:0">Close</button>' +
    '</div>';
  document.body.appendChild(o);
  o.querySelector("button").onclick = () => o.remove();
}
function removeRick() { const o = document.getElementById("gateRick"); if (o) o.remove(); }

/* ---------------- helpers ---------------- */
function timeAgo(ts) {
  if (!ts) return "never";
  const diff = Date.now() - ts;
  if (diff < 0) return "just now";
  const s = Math.floor(diff / 1000);
  if (s < 60) return s + "s ago";
  const m = Math.floor(s / 60);
  if (m < 60) return m + "m ago";
  const h = Math.floor(m / 60);
  if (h < 24) return h + "h ago";
  const d = Math.floor(h / 24);
  if (d < 30) return d + "d ago";
  return new Date(ts).toLocaleDateString();
}
function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({ "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;" }[c]));
}

window.addEventListener("beforeunload", () => { if (myStatusRef) set(myStatusRef, { online: false, lastSeen: Date.now() }); });

setMode("signin");

/* =====================================================================
   DOM / CSS injection (only fills in what the host page is missing)
   ===================================================================== */
function ensureDom() {
  // --- gate (login) ---
  if (!document.getElementById("gate")) {
    const g = document.createElement("div");
    g.id = "gate";
    g.innerHTML =
      '<div class="card-auth">' +
        '<h2 id="authTitle">Sign in</h2>' +
        '<p class="sub">You need an account to use this site.</p>' +
        '<div id="authForm">' +
          '<label>Email</label>' +
          '<input id="authEmail" type="email" autocomplete="email" placeholder="you@example.com">' +
          '<label>Password</label>' +
          '<input id="authPass" type="password" autocomplete="current-password" placeholder="••••••••">' +
          '<button class="primary" id="authSubmit">Sign in</button>' +
          '<div class="toggle" id="authToggle">No account? <a id="toggleLink">Create one</a></div>' +
          '<div class="msg" id="authMsg"></div>' +
        '</div>' +
        '<div class="setup-note" id="setupNote" style="display:none"></div>' +
      '</div>';
    document.body.appendChild(g);
  }
  // --- admin console ---
  if (!document.getElementById("admin")) {
    const a = document.createElement("div");
    a.id = "admin";
    a.innerHTML =
      '<div class="abar">' +
        '<h2>Admin console</h2><span class="muted" id="adminCount"></span>' +
        '<span class="spacer"></span><button id="adminClose">Close</button>' +
      '</div>' +
      '<div class="wrap"><table class="users"><thead><tr>' +
        '<th>Status</th><th>Email</th><th>Role</th><th>Last seen</th><th>2nd site</th><th>Actions</th>' +
      '</tr></thead><tbody id="userRows"></tbody></table></div>';
    document.body.appendChild(a);
  }
  // --- floating control widget (only if host has no header controls) ---
  if (!document.getElementById("who") || !document.getElementById("logoutBtn") || !document.getElementById("adminBtn")) {
    const w = document.createElement("div");
    w.id = "gateWidget";
    w.innerHTML =
      '<span class="who" id="who"></span>' +
      '<button id="adminBtn" class="btn-admin" style="display:none">Admin</button>' +
      '<button id="logoutBtn" style="display:none">Log out</button>';
    document.body.appendChild(w);
  }
}

function injectStyles() {
  if (document.getElementById("gate-shared-css")) return;
  const css = `
  #gate { position: fixed; inset: 0; z-index: 1000; display: flex; align-items: center; justify-content: center;
    background: radial-gradient(1200px 600px at 50% -10%, #1b2740, #0e0f13); color:#eee; font-family: system-ui, sans-serif; }
  #gate.hidden { display: none; }
  .card-auth { width: 360px; max-width: calc(100vw - 32px); background: #15171d; border: 1px solid #23262e;
    border-radius: 14px; padding: 26px 24px; box-shadow: 0 20px 60px rgba(0,0,0,.5); }
  .card-auth h2 { margin: 0 0 4px; font-size: 22px; }
  .card-auth p.sub { margin: 0 0 18px; color: #8b93a3; font-size: 13px; }
  .card-auth label { display: block; font-size: 12px; color: #9aa; margin: 12px 0 5px; }
  .card-auth input { width: 100%; padding: 10px 12px; font-size: 14px; background: #0e0f13;
    border: 1px solid #2a2d36; border-radius: 8px; color: #eee; outline: none; }
  .card-auth input:focus { border-color: #4a90e2; }
  .card-auth .primary { width: 100%; margin-top: 18px; padding: 11px; font-size: 15px; font-weight: 600;
    background: #4a90e2; border: 0; border-radius: 8px; color: #fff; cursor: pointer; }
  .card-auth .primary:hover { background: #5aa3f0; }
  .card-auth .primary:disabled { opacity: .6; cursor: default; }
  .card-auth .toggle { margin-top: 14px; text-align: center; font-size: 13px; color: #8b93a3; }
  .card-auth .toggle a { color: #6aa8ee; cursor: pointer; text-decoration: none; }
  .card-auth .msg { margin-top: 12px; font-size: 13px; min-height: 16px; }
  .card-auth .msg.err { color: #ff6b6b; }
  .card-auth .msg.ok { color: #6bd28b; }
  .setup-note { margin-top: 16px; padding: 12px; border: 1px solid #5a3; border-radius: 8px;
    background: #0f1a12; color: #bfe; font-size: 12px; line-height: 1.5; }

  #admin { position: fixed; inset: 0; z-index: 500; background: #0e0f13; color:#eee;
    display: none; flex-direction: column; font-family: system-ui, sans-serif; }
  #admin.open { display: flex; }
  #admin .abar { display: flex; align-items: center; gap: 12px; padding: 12px 16px;
    background: #15171d; border-bottom: 1px solid #23262e; }
  #admin .abar h2 { margin: 0; font-size: 17px; }
  #admin .abar .spacer { flex: 1; }
  #admin .abar button { padding: 8px 14px; background: #2a2d36; border: 0; border-radius: 6px; color: #eee; cursor: pointer; font-size: 14px; }
  #admin .wrap { flex: 1; overflow: auto; padding: 16px; }
  table.users { width: 100%; border-collapse: collapse; font-size: 13px; }
  table.users th, table.users td { padding: 9px 10px; text-align: left; border-bottom: 1px solid #23262e; white-space: nowrap; }
  table.users th { color: #8b93a3; font-weight: 600; position: sticky; top: 0; background: #0e0f13; }
  table.users td.email { white-space: normal; word-break: break-all; }
  .dot { display: inline-block; width: 9px; height: 9px; border-radius: 50%; margin-right: 6px; vertical-align: middle; }
  .dot.on { background: #3ddc84; box-shadow: 0 0 6px #3ddc84; }
  .dot.off { background: #555; }
  .pill { font-size: 11px; padding: 2px 8px; border-radius: 999px; font-weight: 600; }
  .pill.admin { background: #4d3a00; color: #ffcf5a; }
  .pill.user { background: #1d2733; color: #8fb8ee; }
  .pill.banned { background: #3a1414; color: #ff8080; }
  table.users button { padding: 5px 9px; margin: 0 2px; font-size: 12px; border: 0; border-radius: 6px; cursor: pointer; background: #2a2d36; color: #eee; }
  table.users button:hover { filter: brightness(1.2); }
  table.users button:disabled { opacity: .45; cursor: default; }
  button.b-toggle { background: #1d3a5f !important; }
  button.b-toggle.on { background: #1f6f3f !important; }
  button.b-ban { background: #6a2222 !important; }
  button.b-unban { background: #2a5a2a !important; }
  button.b-kick { background: #6a4a12 !important; }
  button.b-admin { background: #4a2a6a !important; }
  button.b-msg { background: #1d4f5f !important; }
  button.b-scare { background: #7a1f1f !important; }
  button.b-reset { background: #5a4a12 !important; }
  button.b-troll { background: #3a2a6a !important; }
  button.b-del { background: #3a0f0f !important; color: #ff9c9c !important; }
  .muted { color: #8b93a3; }

  #gateWidget { position: fixed; top: 10px; right: 12px; z-index: 400; display: flex; align-items: center; gap: 10px;
    background: rgba(21,23,29,.92); border: 1px solid #23262e; border-radius: 10px; padding: 6px 10px;
    font-family: system-ui, sans-serif; }
  #gateWidget .who { font-size: 13px; color: #9aa; white-space: nowrap; }
  #gateWidget .who b { color: #eee; }
  #gateWidget button { padding: 6px 12px; background: #2a2d36; border: 0; border-radius: 6px; color: #eee; cursor: pointer; font-size: 13px; }
  #gateWidget button:hover { filter: brightness(1.2); }
  #gateWidget button.btn-admin { background: #b8860b; color: #111; font-weight: 600; }

  .gate-modal { position: fixed; inset: 0; z-index: 100001; display: none; align-items: center; justify-content: center;
    background: rgba(0,0,0,.75); font-family: system-ui, sans-serif; }
  .gate-modal-box { background: #15171d; border: 1px solid #23262e; border-radius: 14px; padding: 24px;
    max-width: 440px; width: calc(100vw - 40px); box-shadow: 0 20px 60px rgba(0,0,0,.6); }
  .gate-modal-title { font-size: 18px; font-weight: 700; margin-bottom: 10px; color: #fff; }
  .gate-modal-text { font-size: 15px; color: #ddd; white-space: pre-wrap; line-height: 1.5; margin-bottom: 18px; }
  .gate-modal-ok { padding: 10px 18px; background: #4a90e2; border: 0; border-radius: 8px; color: #fff; font-weight: 600; cursor: pointer; }

  .gate-scare { position: fixed; inset: 0; z-index: 100002; display: flex; align-items: center; justify-content: center;
    background: #000; overflow: hidden; animation: gate-flash .12s steps(2) infinite, gate-shake .25s infinite; }
  .gate-scare-face { font-size: 60vh; line-height: 1; filter: drop-shadow(0 0 40px red); animation: gate-zoom .4s ease-out; }
  @keyframes gate-flash { 0% { background:#000 } 50% { background:#7a0000 } 100% { background:#000 } }
  @keyframes gate-shake { 0%{transform:translate(0,0)} 25%{transform:translate(-14px,9px)} 50%{transform:translate(11px,-11px)} 75%{transform:translate(-9px,-7px)} 100%{transform:translate(0,0)} }
  @keyframes gate-zoom { 0%{transform:scale(.15);opacity:.2} 100%{transform:scale(1);opacity:1} }
  @keyframes gate-spin { from{transform:rotate(0)} to{transform:rotate(360deg)} }
  html.gate-spinning { animation: gate-spin 3s linear infinite; }
  `;
  const style = document.createElement("style");
  style.id = "gate-shared-css";
  style.textContent = css;
  document.head.appendChild(style);
}
