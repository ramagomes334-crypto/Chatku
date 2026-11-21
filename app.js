import { initializeApp } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js";
import { getAuth, createUserWithEmailAndPassword, signInWithEmailAndPassword, onAuthStateChanged, signOut, updateProfile }
  from "https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js";
import { getFirestore, doc, setDoc, getDoc, getDocs, runTransaction, writeBatch, increment, query, where, collection, addDoc, onSnapshot, orderBy, serverTimestamp }
  from "https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js";
import { firebaseConfig } from "./firebase-config.js";

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);
const $ = id => document.getElementById(id);
let currentChat = null, lastSnap = null, prevUnread = {}, firstLoad = true;
let user = null, unsubChats = null, unsubMsgs = null, peerNames = {};

const pesan = e => ({
  "auth/invalid-email": "Format email salah.",
  "auth/missing-password": "Kata sandi belum diisi.",
  "auth/weak-password": "Kata sandi minimal 6 karakter.",
  "auth/email-already-in-use": "Email sudah terdaftar. Coba masuk.",
  "auth/invalid-credential": "Email atau kata sandi salah.",
  "permission-denied": "Ditolak oleh aturan Firestore. Cek Rules di Firebase."
}[e.code] || e.message);

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
  unsubChats && unsubChats(); unsubMsgs && unsubMsgs();
  $("auth").classList.toggle("hidden", !!u);
  $("setname").classList.add("hidden");
  $("app").classList.add("hidden");
  if (!u) return;
  let uname = null;
  try { uname = (await getDoc(doc(db, "users", u.uid))).data()?.username; } catch (e) {}
  if (!uname) { $("setname").classList.remove("hidden"); return; }
  startApp(u, uname);
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
        name: user.displayName || user.email.split("@")[0],
        email: user.email.toLowerCase(), username: un
      }, { merge: true });
    });
    $("setname").classList.add("hidden");
    startApp(user, un);
  } catch (e) { $("unameErr").textContent = e.code === "taken" ? "Username sudah dipakai. Coba yang lain." : pesan(e); }
};

function startApp(u, uname) {
  $("app").classList.remove("hidden");
  $("me").textContent = (u.displayName || u.email) + " (@" + uname + ")";
  const q = query(collection(db, "chats"), where("members", "array-contains", u.uid));
  firstLoad = true; prevUnread = {};
  unsubChats = onSnapshot(q, snap => {
    const ul = $("chats"); ul.innerHTML = ""; let total = 0;
    snap.docs.forEach(d => {
      const data = d.data();
      const nama = data.names[data.members.find(x => x !== u.uid)] || "Teman";
      const n = (data.unread && data.unread[u.uid]) || 0;
      if (!firstLoad && n > (prevUnread[d.id] || 0) && (d.id !== currentChat || document.hidden)) notif(nama, data.last || "Pesan baru");
      prevUnread[d.id] = n;
      const shown = d.id === currentChat && !document.hidden ? 0 : n;
      total += shown;
      const li = document.createElement("li");
      li.textContent = nama;
      if (shown) { const b = document.createElement("b"); b.className = "badge"; b.textContent = shown; li.appendChild(b); }
      const sm = document.createElement("small"); sm.textContent = data.last || ""; li.appendChild(sm);
      li.onclick = () => openChat(d.id, nama);
      ul.appendChild(li);
    });
    firstLoad = false;
    document.title = (total ? "(" + total + ") " : "") + "Chatku";
  });
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
    const id = [user.uid, pid].sort().join("_");
    await setDoc(doc(db, "chats", id), {
      members: [user.uid, pid],
      names: { [user.uid]: user.displayName || user.email, [pid]: peer.data().name }
    }, { merge: true });
    $("findEmail").value = "";
    openChat(id, peer.data().name);
  } catch (e) { $("findErr").textContent = pesan(e); }
};

function notif(judul, isi) {
  try { navigator.vibrate && navigator.vibrate(200); } catch (e) {}
  try { if ("Notification" in window && Notification.permission === "granted") new Notification(judul, { body: isi }); } catch (e) {}
}
document.addEventListener("click", () => {
  if ("Notification" in window && Notification.permission === "default") Notification.requestPermission();
}, { once: true });

async function tandaiDibaca() {
  if (!currentChat || !lastSnap || document.hidden) return;
  const b = writeBatch(db); let ada = false;
  lastSnap.docs.forEach(d => {
    const m = d.data();
    if (m.from !== user.uid && !m.read) { b.update(d.ref, { read: true }); ada = true; }
  });
  try {
    if (ada) await b.commit();
    await setDoc(doc(db, "chats", currentChat), { unread: { [user.uid]: 0 } }, { merge: true });
  } catch (e) {}
}
document.addEventListener("visibilitychange", tandaiDibaca);

function openChat(id, nama) {
  unsubMsgs && unsubMsgs();
  currentChat = id; lastSnap = null;
  $("peer").textContent = nama;
  $("room").classList.remove("hidden");
  $("app").classList.add("inroom");
  $("room").dataset.id = id;
  const q = query(collection(db, "chats", id, "messages"), orderBy("createdAt"));
  unsubMsgs = onSnapshot(q, snap => {
    lastSnap = snap;
    const box = $("msgs"); box.innerHTML = "";
    snap.docs.forEach(d => {
      const m = d.data(), el = document.createElement("div"), mine = m.from === user.uid;
      el.className = "m" + (mine ? " me" : "");
      const t = m.createdAt ? m.createdAt.toDate().toLocaleTimeString("id-ID", { hour: "2-digit", minute: "2-digit" }) : "…";
      el.textContent = m.text;
      const tm = document.createElement("time");
      tm.textContent = mine ? t + (m.read ? "  ✓✓ dibaca" : "  ✓ terkirim") : t;
      if (mine && m.read) tm.className = "r";
      el.appendChild(tm);
      box.appendChild(el);
    });
    box.scrollTop = box.scrollHeight;
    tandaiDibaca();
  });
}
$("btnBack").onclick = () => { currentChat = null; $("app").classList.remove("inroom"); };

async function kirim() {
  const t = $("text").value.trim(), id = $("room").dataset.id;
  if (!t || !id) return;
  $("text").value = "";
  const pid = id.split("_").find(x => x !== user.uid);
  await addDoc(collection(db, "chats", id, "messages"), { text: t, from: user.uid, read: false, createdAt: serverTimestamp() });
  await setDoc(doc(db, "chats", id), { last: t, unread: { [pid]: increment(1) } }, { merge: true });
}
$("btnSend").onclick = kirim;
$("text").addEventListener("keydown", e => { if (e.key === "Enter") kirim(); });
