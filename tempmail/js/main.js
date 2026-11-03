import { createInbox, fetchInbox, deleteInbox } from "./api.js";

const STORAGE_KEY = "nyr-tempmail-session";
const POLL_MS = 10000;
const $ = (id) => document.getElementById(id);
const el = {
  address: $("address"), expiry: $("expiry"), status: $("status"), count: $("count"),
  list: $("list"), empty: $("empty"), form: $("form-create"), name: $("name"),
  copy: $("btn-copy"), refresh: $("btn-refresh"), remove: $("btn-delete"),
  detail: $("detail"), subject: $("d-subject"), meta: $("d-meta"), body: $("d-body"), links: $("d-links"),
};

let session = loadSession();
let messages = [];
let openId = null;

function loadSession() {
  try { return JSON.parse(localStorage.getItem(STORAGE_KEY)) || null; } catch { return null; }
}

function saveSession() {
  try {
    if (session) localStorage.setItem(STORAGE_KEY, JSON.stringify(session));
    else localStorage.removeItem(STORAGE_KEY);
  } catch { /* penyimpanan tidak tersedia, sesi hanya hidup selama tab terbuka */ }
}

function setStatus(text, isError = false) {
  el.status.textContent = text;
  el.status.classList.toggle("error", isError);
}

function formatDate(iso) {
  return iso ? new Date(iso).toLocaleString("id-ID", { dateStyle: "medium", timeStyle: "short" }) : "-";
}

function renderSession() {
  const active = Boolean(session);
  el.address.textContent = active ? session.address : "Belum ada inbox";
  [el.copy, el.refresh, el.remove].forEach((button) => { button.disabled = !active; });
  if (!active) { messages = []; el.expiry.textContent = ""; }
  renderList();
}

function renderExpiry() {
  if (!session || !session.expiresAt) { el.expiry.textContent = ""; return; }
  const left = new Date(session.expiresAt).getTime() - Date.now();
  if (left <= 0) { endSession("Inbox sudah kedaluwarsa. Buat inbox baru."); return; }
  const minutes = Math.floor(left / 60000);
  const seconds = Math.floor((left % 60000) / 1000);
  el.expiry.textContent = `Berlaku ${minutes} menit ${String(seconds).padStart(2, "0")} detik lagi`;
}

function endSession(message) {
  session = null;
  openId = null;
  saveSession();
  el.detail.hidden = true;
  renderSession();
  setStatus(message, true);
}

function renderList() {
  el.list.replaceChildren();
  el.count.textContent = String(messages.length);
  el.empty.hidden = messages.length > 0 || !session;
  messages.forEach((message) => {
    const item = document.createElement("li");
    const button = document.createElement("button");
    const title = document.createElement("strong");
    const info = document.createElement("span");
    button.type = "button";
    button.className = "message-item";
    button.setAttribute("aria-current", String(message.id === openId));
    title.textContent = message.subject;
    info.textContent = `${message.from.name || message.from.address || "Pengirim tidak diketahui"} - ${formatDate(message.receivedAt)}`;
    button.append(title, info);
    button.addEventListener("click", () => openMessage(message.id));
    item.append(button);
    el.list.append(item);
  });
}

function openMessage(id) {
  const message = messages.find((m) => m.id === id);
  if (!message) return;
  openId = id;
  el.subject.textContent = message.subject;
  el.meta.textContent = `Dari: ${message.from.name || ""} ${message.from.address ? `<${message.from.address}>` : ""} | ${formatDate(message.receivedAt)}`;
  el.body.replaceChildren();
  if (message.html) {
    const frame = document.createElement("iframe");
    frame.setAttribute("sandbox", "");
    frame.title = "Isi email";
    frame.srcdoc = message.html;
    el.body.append(frame);
  } else {
    const pre = document.createElement("pre");
    pre.textContent = message.text || "(pesan kosong)";
    el.body.append(pre);
  }
  el.links.replaceChildren();
  message.links.forEach((url) => {
    const item = document.createElement("li");
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.textContent = url;
    anchor.target = "_blank";
    anchor.rel = "noopener noreferrer nofollow";
    item.append(anchor);
    el.links.append(item);
  });
  el.detail.hidden = false;
  renderList();
  el.detail.scrollIntoView({ behavior: "smooth", block: "start" });
}

async function refresh(manual = false) {
  if (!session) return;
  if (manual) setStatus("Memuat pesan...");
  try {
    const data = await fetchInbox(session.token);
    messages = data.messages;
    if (data.inbox.expiresAt) session.expiresAt = data.inbox.expiresAt;
    saveSession();
    renderList();
    setStatus(manual ? "Kotak masuk diperbarui." : "");
  } catch (error) {
    if (error.status === 404) endSession("Inbox tidak ditemukan atau sudah kedaluwarsa.");
    else setStatus(error.message, true);
  }
}

el.form.addEventListener("submit", async (event) => {
  event.preventDefault();
  const name = el.name.value.trim().toLowerCase();
  if (name && !/^[a-z0-9]{5,16}$/.test(name)) {
    setStatus("Nama harus 5-16 karakter, hanya huruf kecil dan angka.", true);
    return;
  }
  setStatus("Membuat inbox...");
  try {
    const { inbox } = await createInbox(name);
    session = { address: inbox.address, token: inbox.token, expiresAt: inbox.expiresAt };
    messages = [];
    openId = null;
    el.detail.hidden = true;
    el.name.value = "";
    saveSession();
    renderSession();
    renderExpiry();
    setStatus("Inbox berhasil dibuat.");
  } catch (error) {
    setStatus(error.message, true);
  }
});

el.copy.addEventListener("click", async () => {
  try {
    await navigator.clipboard.writeText(session.address);
    setStatus("Alamat disalin.");
  } catch {
    setStatus("Gagal menyalin, salin manual dari kotak alamat.", true);
  }
});

el.refresh.addEventListener("click", () => refresh(true));

el.remove.addEventListener("click", async () => {
  if (!session || !window.confirm("Hapus inbox ini beserta semua pesannya?")) return;
  try {
    await deleteInbox(session.token);
    endSession("Inbox dihapus.");
    el.status.classList.remove("error");
  } catch (error) {
    setStatus(error.message, true);
  }
});

document.addEventListener("visibilitychange", () => { if (!document.hidden) refresh(); });
setInterval(() => { if (!document.hidden) refresh(); }, POLL_MS);
setInterval(renderExpiry, 1000);

renderSession();
renderExpiry();
refresh();
