import { initializeApp } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js";
import { getAuth, createUserWithEmailAndPassword, signInWithEmailAndPassword, onAuthStateChanged, signOut, updateProfile }
  from "https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js";
import { getFirestore, doc, setDoc, getDoc, updateDoc, runTransaction, writeBatch, increment, arrayUnion, query, where, collection, addDoc, onSnapshot, orderBy, serverTimestamp }
  from "https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js";
import { firebaseConfig } from "./firebase-config.js";

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);
const $ = id => document.getElementById(id);
let user = null, meData = {}, peers = {}, chatsSnap = null, prevUnread = {}, firstLoad = true;
let currentChat = null, peerId = null, peerData = null, peerTyping = 0, lastSnap = null, replyTo = null, lastTypingSent = 0, pendingPhoto = null, hb = null;
let unsubChats = null, unsubMsgs = null, unsubChat = null, unsubPeer = null;

const pesan = e => ({
  "auth/invalid-email": "Format email salah.",
  "auth/missing-password": "Kata sandi belum diisi.",
  "auth/weak-password": "Kata sandi minimal 6 karakter.",
  "auth/email-already-in-use": "Email sudah terdaftar. Coba masuk.",
  "auth/invalid-credential": "Email atau kata sandi salah.",
  "permission-denied": "Ditolak oleh aturan Firestore. Cek Rules di Firebase."
}[e.code] || e.message);

function avatar(d, big) {
  const el = document.createElement("span");
  el.className = "av" + (big ? " lg" : "");
  if (d && d.photo) { const i = document.createElement("img"); i.src = d.photo; el.appendChild(i); }
  else el.textContent = ((d && d.name) || "?").charAt(0).toUpperCase();
  return el;
}
function fmt(ms) {
  const d = new Date(ms), now = new Date();
  const jam = d.toLocaleTimeString("id-ID", { hour: "2-digit", minute: "2-digit" });
  if (d.toDateString() === now.toDateString()) return "hari ini " + jam;
  if (d.toDateString() === new Date(now - 864e5).toDateString()) return "kemarin " + jam;
  return d.toLocaleDateString("id-ID", { day: "numeric", month: "short" }) + " " + jam;
}

// ---------- Login / daftar ----------
$("btnReg").onclick = async () => {
  $("err").textContent = "";
  try {
    const name = $("name").value.trim() || $("email").value.split("@")[0];
    const c = await createUserWithEmailAndPassword(auth, $("email").value.trim(), $("pass").value);
    await updateProfile(c.user, { displayName: name });
    await setDoc(doc(db, "users", c.user.uid), { name, email: c.user.email.toLowerCase() });
  } catch (e) { $("err").textContent = pesan(e); }
};
$("btnLogin").onclick = async () => {
  $("err").textContent = "";
  try { await signInWithEmailAndPassword(auth, $("email").value.trim(), $("pass").value); }
  catch (e) { $("err").textContent = pesan(e); }
};
$("btnOut").onclick = () => signOut(auth);

onAuthStateChanged(auth, async u => {
  user = u;
  unsubChats && unsubChats(); closeRoom(); clearInterval(hb);
  $("auth").classList.toggle("hidden", !!u);
  $("setname").classList.add("hidden");
  $("app").classList.add("hidden");
  if (!u) return;
  try { meData = (await getDoc(doc(db, "users", u.uid))).data() || {}; } catch (e) { meData = {}; }
  if (!meData.username) { $("setname").classList.remove("hidden"); return; }
  startApp(u);
});

$("btnUname").onclick = async () => {
  $("unameErr").textContent = "";
  const un = $("uname").value.trim().toLowerCase().replace(/^@/, "");
  if (!/^[a-z0-9_]{3,20}$/.test(un)) { $("unameErr").textContent = "Gunakan huruf kecil, angka, atau _ (3-20 karakter)."; return; }
  try {
    await runTransaction(db, async tx => {
      const ref = doc(db, "usernames", un);
      if ((await tx.get(ref)).exists()) throw { code: "taken" };
      tx.set(ref, { uid: user.uid });
      tx.set(doc(db, "users", user.uid), {
        name: user.displayName || user.email.split("@")[0], email: user.email.toLowerCase(), username: un
      }, { merge: true });
    });
    meData = (await getDoc(doc(db, "users", user.uid))).data() || {};
    $("setname").classList.add("hidden");
    startApp(user);
  } catch (e) { $("unameErr").textContent = e.code === "taken" ? "Username sudah dipakai. Coba yang lain." : pesan(e); }
};

// ---------- Aplikasi ----------
function renderMe() {
  $("me").textContent = meData.name || user.email;
  $("meAv").replaceChildren(avatar(meData));
}
function beat() {
  if (user && !document.hidden) setDoc(doc(db, "users", user.uid), { lastSeen: serverTimestamp() }, { merge: true }).catch(() => {});
}
function startApp(u) {
  $("app").classList.remove("hidden");
  renderMe();
  beat(); hb = setInterval(beat, 30000);
  firstLoad = true; prevUnread = {};
  const q = query(collection(db, "chats"), where("members", "array-contains", u.uid));
  unsubChats = onSnapshot(q, snap => {
    chatsSnap = snap;
    snap.docs.forEach(d => {
      const data = d.data(), n = (data.unread && data.unread[u.uid]) || 0;
      const pid = data.members.find(x => x !== u.uid);
      if (!peers[pid]) ensurePeer(pid);
      if (!firstLoad && n > (prevUnread[d.id] || 0) && (d.id !== currentChat || document.hidden))
        notif((peers[pid] && peers[pid].name) || data.names[pid] || "Teman", data.last || "Pesan baru");
      prevUnread[d.id] = n;
    });
    firstLoad = false;
    renderChats();
  });
}
async function ensurePeer(pid) {
  peers[pid] = { name: "…" };
  try { peers[pid] = (await getDoc(doc(db, "users", pid))).data() || { name: "Teman" }; } catch (e) {}
  renderChats();
}
function renderChats() {
  if (!chatsSnap) return;
  const ul = $("chats"); ul.innerHTML = ""; let total = 0;
  chatsSnap.docs.forEach(d => {
    const data = d.data(), pid = data.members.find(x => x !== user.uid), p = peers[pid] || {};
    const n = d.id === currentChat && !document.hidden ? 0 : ((data.unread && data.unread[user.uid]) || 0);
    total += n;
    const li = document.createElement("li");
    li.appendChild(avatar(p));
    const t = document.createElement("div"); t.className = "t";
    t.textContent = p.name || data.names[pid] || "Teman";
    const sm = document.createElement("small"); sm.textContent = data.last || ""; t.appendChild(sm);
    li.appendChild(t);
    if (n) { const b = document.createElement("b"); b.className = "badge"; b.textContent = n; li.appendChild(b); }
    li.onclick = () => openChat(d.id);
    ul.appendChild(li);
  });
  document.title = (total ? "(" + total + ") " : "") + "Chatku";
}

$("btnFind").onclick = async () => {
  $("findErr").textContent = "";
  const un = $("findEmail").value.trim().toLowerCase().replace(/^@/, "");
  if (!un) return;
  try {
    const m = await getDoc(doc(db, "usernames", un));
    if (!m.exists()) { $("findErr").textContent = "Username itu tidak ditemukan."; return; }
    const pid = m.data().uid;
    if (pid === user.uid) { $("findErr").textContent = "Itu username kamu sendiri."; return; }
    const peer = await getDoc(doc(db, "users", pid));
    peers[pid] = peer.data();
    const id = [user.uid, pid].sort().join("_");
    await setDoc(doc(db, "chats", id), {
      members: [user.uid, pid],
      names: { [user.uid]: user.displayName || user.email, [pid]: peer.data().name }
    }, { merge: true });
    $("findEmail").value = "";
    openChat(id);
  } catch (e) { $("findErr").textContent = pesan(e); }
};

function notif(judul, isi) {
  try { navigator.vibrate && navigator.vibrate(200); } catch (e) {}
  try { if ("Notification" in window && Notification.permission === "granted") new Notification(judul, { body: isi }); } catch (e) {}
}
document.addEventListener("click", () => {
  if ("Notification" in window && Notification.permission === "default") Notification.requestPermission();
}, { once: true });

// ---------- Ruang chat ----------
function renderStatus() {
  if (!currentChat) return;
  const p = peerData || {};
  $("peer").textContent = p.name || "…";
  $("peerAv").replaceChildren(avatar(p));
  let s = "";
  const ls = p.lastSeen && p.lastSeen.toMillis ? p.lastSeen.toMillis() : 0;
  if (peerTyping && Date.now() - peerTyping < 5000) s = "mengetik…";
  else if (ls && Date.now() - ls < 45000) s = "online";
  else if (ls) s = "terakhir dilihat " + fmt(ls);
  $("status").textContent = s;
}
setInterval(renderStatus, 8000);

async function tandaiDibaca() {
  if (!currentChat || !lastSnap || document.hidden) return;
  const b = writeBatch(db); let ada = false;
  lastSnap.docs.forEach(d => {
    const m = d.data();
    if (m.from !== user.uid && !m.read && !m.deleted) { b.update(d.ref, { read: true }); ada = true; }
  });
  try {
    if (ada) await b.commit();
    await setDoc(doc(db, "chats", currentChat), { unread: { [user.uid]: 0 } }, { merge: true });
  } catch (e) {}
}
document.addEventListener("visibilitychange", () => { if (!document.hidden) beat(); tandaiDibaca(); renderChats(); });

function closeRoom() {
  [unsubMsgs, unsubChat, unsubPeer].forEach(f => f && f());
  unsubMsgs = unsubChat = unsubPeer = null;
  currentChat = peerId = peerData = lastSnap = null; peerTyping = 0;
  setReply(null);
}
function setReply(r) {
  replyTo = r;
  $("replybar").classList.toggle("hidden", !r);
  $("replytxt").textContent = r ? "Membalas " + r.name + ": " + r.text : "";
}
$("btnNoReply").onclick = () => setReply(null);
$("btnBack").onclick = () => { closeRoom(); $("app").classList.remove("inroom"); renderChats(); };

function openChat(id) {
  closeRoom();
  currentChat = id;
  peerId = id.split("_").find(x => x !== user.uid);
  peerData = peers[peerId] || null;
  $("room").classList.remove("hidden");
  $("app").classList.add("inroom");
  $("room").dataset.id = id;
  renderStatus();
  unsubPeer = onSnapshot(doc(db, "users", peerId), s => { peerData = s.data(); peers[peerId] = peerData; renderStatus(); renderChats(); });
  unsubChat = onSnapshot(doc(db, "chats", id), s => {
    const t = s.data() && s.data().typing; peerTyping = (t && t[peerId]) || 0; renderStatus();
  });
  const q = query(collection(db, "chats", id, "messages"), orderBy("createdAt"));
  unsubMsgs = onSnapshot(q, snap => {
    lastSnap = snap;
    const box = $("msgs"); box.innerHTML = "";
    snap.docs.forEach(d => {
      const m = d.data(), mine = m.from === user.uid;
      if (m.hiddenFor && m.hiddenFor.includes(user.uid)) return;
      const el = document.createElement("div");
      el.className = "m" + (mine ? " me" : "") + (m.deleted ? " del" : "");
      if (m.deleted) el.textContent = "🚫 Pesan ini dihapus";
      else {
        if (m.reply) { const q2 = document.createElement("div"); q2.className = "q"; q2.textContent = m.reply.name + ": " + m.reply.text; el.appendChild(q2); }
        el.appendChild(document.createTextNode(m.text));
      }
      const t = m.createdAt ? m.createdAt.toDate().toLocaleTimeString("id-ID", { hour: "2-digit", minute: "2-digit" }) : "…";
      const tm = document.createElement("time");
      tm.textContent = mine && !m.deleted ? t + (m.read ? "  ✓✓ dibaca" : "  ✓ terkirim") : t;
      if (mine && m.read) tm.className = "r";
      el.appendChild(tm);
      el.onclick = () => openMenu(d, m, mine);
      box.appendChild(el);
    });
    box.scrollTop = box.scrollHeight;
    tandaiDibaca();
  });
}

function openMenu(d, m, mine) {
  $("menu").classList.remove("hidden");
  $("mReply").classList.toggle("hidden", !!m.deleted);
  $("mAll").classList.toggle("hidden", !(mine && !m.deleted));
  const tutup = () => $("menu").classList.add("hidden");
  $("mCancel").onclick = tutup;
  $("mReply").onclick = () => { tutup(); setReply({ text: m.text.slice(0, 80), name: mine ? "kamu" : ((peerData && peerData.name) || "teman") }); $("text").focus(); };
  $("mMe").onclick = async () => { tutup(); try { await updateDoc(d.ref, { hiddenFor: arrayUnion(user.uid) }); } catch (e) {} };
  $("mAll").onclick = async () => { tutup(); try { await updateDoc(d.ref, { deleted: true, text: "" }); } catch (e) {} };
}

$("text").addEventListener("input", () => {
  const n = Date.now();
  if (currentChat && n - lastTypingSent > 2500) {
    lastTypingSent = n;
    setDoc(doc(db, "chats", currentChat), { typing: { [user.uid]: n } }, { merge: true }).catch(() => {});
  }
});
async function kirim() {
  const t = $("text").value.trim(), id = currentChat;
  if (!t || !id) return;
  $("text").value = "";
  const data = { text: t, from: user.uid, read: false, createdAt: serverTimestamp() };
  if (replyTo) data.reply = replyTo;
  setReply(null);
  await addDoc(collection(db, "chats", id, "messages"), data);
  await setDoc(doc(db, "chats", id), { last: t, typing: { [user.uid]: 0 }, unread: { [peerId]: increment(1) } }, { merge: true });
}
$("btnSend").onclick = kirim;
$("text").addEventListener("keydown", e => { if (e.key === "Enter") kirim(); });

// ---------- Profil ----------
function kompres(file) {
  return new Promise((ok, no) => {
    const img = new Image(), url = URL.createObjectURL(file);
    img.onload = () => {
      const s = Math.min(img.width, img.height), c = document.createElement("canvas");
      c.width = c.height = 128;
      c.getContext("2d").drawImage(img, (img.width - s) / 2, (img.height - s) / 2, s, s, 0, 0, 128, 128);
      URL.revokeObjectURL(url); ok(c.toDataURL("image/jpeg", 0.7));
    };
    img.onerror = no; img.src = url;
  });
}
function openProfile(d, editable) {
  pendingPhoto = null;
  $("profile").classList.remove("hidden");
  $("pfAv").replaceChildren(avatar(d, true));
  $("pfName").value = d.name || ""; $("pfBio").value = d.bio || "";
  $("pfUser").textContent = d.username ? "@" + d.username : "";
  $("pfErr").textContent = "";
  ["pfName", "pfBio"].forEach(i => $(i).disabled = !editable);
  $("pfFile").classList.toggle("hidden", !editable);
  $("pfSave").classList.toggle("hidden", !editable);
}
$("btnMe").onclick = () => openProfile(meData, true);
$("peerBox").onclick = () => peerData && openProfile(peerData, false);
$("pfClose").onclick = () => $("profile").classList.add("hidden");
$("pfFile").onchange = async e => {
  const f = e.target.files[0]; if (!f) return;
  try { pendingPhoto = await kompres(f); $("pfAv").replaceChildren(avatar({ photo: pendingPhoto, name: $("pfName").value }, true)); }
  catch (x) { $("pfErr").textContent = "Gambar tidak bisa dibaca."; }
};
$("pfSave").onclick = async () => {
  const name = $("pfName").value.trim() || meData.name, bio = $("pfBio").value.trim();
  const upd = { name, bio }; if (pendingPhoto) upd.photo = pendingPhoto;
  try {
    await setDoc(doc(db, "users", user.uid), upd, { merge: true });
    await updateProfile(auth.currentUser, { displayName: name });
    meData = { ...meData, ...upd }; renderMe();
    $("profile").classList.add("hidden");
  } catch (e) { $("pfErr").textContent = pesan(e); }
};
