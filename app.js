import { initializeApp } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js";
import { getAuth, createUserWithEmailAndPassword, signInWithEmailAndPassword, onAuthStateChanged, signOut, updateProfile }
  from "https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js";
import { getFirestore, doc, setDoc, getDocs, query, where, collection, addDoc, onSnapshot, orderBy, serverTimestamp }
  from "https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js";
import { firebaseConfig } from "./firebase-config.js";

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);
const $ = id => document.getElementById(id);
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

onAuthStateChanged(auth, u => {
  user = u;
  $("auth").classList.toggle("hidden", !!u);
  $("app").classList.toggle("hidden", !u);
  unsubChats && unsubChats(); unsubMsgs && unsubMsgs();
  if (!u) return;
  $("me").textContent = u.displayName || u.email;
  const q = query(collection(db, "chats"), where("members", "array-contains", u.uid));
  unsubChats = onSnapshot(q, snap => {
    const ul = $("chats"); ul.innerHTML = "";
    snap.docs.forEach(d => {
      const data = d.data();
      const li = document.createElement("li");
      const nama = data.names[data.members.find(x => x !== u.uid)] || "Teman";
      li.innerHTML = `${nama}<small></small>`;
      li.querySelector("small").textContent = data.last || "";
      li.onclick = () => openChat(d.id, nama);
      ul.appendChild(li);
    });
  });
});

$("btnFind").onclick = async () => {
  $("findErr").textContent = "";
  const email = $("findEmail").value.trim().toLowerCase();
  if (!email) return;
  try {
    const r = await getDocs(query(collection(db, "users"), where("email", "==", email)));
    if (r.empty) { $("findErr").textContent = "Email itu belum terdaftar di Chatku."; return; }
    const peer = r.docs[0], pid = peer.id;
    if (pid === user.uid) { $("findErr").textContent = "Itu email kamu sendiri."; return; }
    const id = [user.uid, pid].sort().join("_");
    await setDoc(doc(db, "chats", id), {
      members: [user.uid, pid],
      names: { [user.uid]: user.displayName || user.email, [pid]: peer.data().name }
    }, { merge: true });
    $("findEmail").value = "";
    openChat(id, peer.data().name);
  } catch (e) { $("findErr").textContent = pesan(e); }
};

function openChat(id, nama) {
  unsubMsgs && unsubMsgs();
  $("peer").textContent = nama;
  $("room").classList.remove("hidden");
  $("app").classList.add("inroom");
  $("room").dataset.id = id;
  const q = query(collection(db, "chats", id, "messages"), orderBy("createdAt"));
  unsubMsgs = onSnapshot(q, snap => {
    const box = $("msgs"); box.innerHTML = "";
    snap.docs.forEach(d => {
      const m = d.data(), el = document.createElement("div");
      el.className = "m" + (m.from === user.uid ? " me" : "");
      const t = m.createdAt ? m.createdAt.toDate().toLocaleTimeString("id-ID", { hour: "2-digit", minute: "2-digit" }) : "…";
      el.textContent = m.text;
      const tm = document.createElement("time"); tm.textContent = t; el.appendChild(tm);
      box.appendChild(el);
    });
    box.scrollTop = box.scrollHeight;
  });
}
$("btnBack").onclick = () => $("app").classList.remove("inroom");

async function kirim() {
  const t = $("text").value.trim(), id = $("room").dataset.id;
  if (!t || !id) return;
  $("text").value = "";
  await addDoc(collection(db, "chats", id, "messages"), { text: t, from: user.uid, createdAt: serverTimestamp() });
  await setDoc(doc(db, "chats", id), { last: t }, { merge: true });
}
$("btnSend").onclick = kirim;
$("text").addEventListener("keydown", e => { if (e.key === "Enter") kirim(); });
