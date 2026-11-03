"use strict";

const SITE_BASE = process.env.JULZ_BASE || "https://www.julzaexce.my.id";
const WORKER_BASE = process.env.JULZ_WORKER || "https://julz-tempmail.julykomang985.workers.dev";
const TIMEOUT_MS = Number.parseInt(process.env.JULZ_TIMEOUT || "15000", 10);
const PIN_HOST = process.env.PIN_HOST || "nyr-tempmail-jultempmail.vercel.app";
// localhost hanya sementara, dihapus saat SIAP DEPLOY
const ALLOWED_HOSTS = [PIN_HOST, "localhost", "127.0.0.1"];
const MAX_HTML_CHARS = 300000;

const HEADERS = {
  "Content-Type": "application/json",
  Accept: "application/json",
  "User-Agent": "Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36",
  Origin: SITE_BASE,
};

const send = (res, status, body) => res.status(status).json(body);

function isAllowedSource(req) {
  const source = req.headers.origin || req.headers.referer;
  if (!source) return true;
  try {
    return ALLOWED_HOSTS.includes(new URL(source).hostname);
  } catch {
    return false;
  }
}

async function upstream(url, { method = "GET", body, headers } = {}) {
  const attempts = method === "GET" ? 2 : 1;
  let lastError;
  for (let i = 0; i < attempts; i += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    try {
      const response = await fetch(url, {
        method,
        signal: controller.signal,
        headers: { ...HEADERS, ...headers },
        body: body ? JSON.stringify(body) : undefined,
      });
      const data = await response.json().catch(() => ({}));
      return { status: response.status, data };
    } catch (error) {
      lastError = error;
      if (i < attempts - 1) await new Promise((r) => setTimeout(r, 500));
    } finally {
      clearTimeout(timer);
    }
  }
  throw lastError;
}

function parseSender(raw) {
  const text = typeof raw === "string" ? raw.trim() : "";
  const match = text.match(/^(.*?)\s*<\s*([^<>\s]+@\S+?)\s*>$/);
  if (match) return { name: match[1].replace(/^"|"$/g, "") || null, address: match[2] };
  if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(text)) return { name: null, address: text };
  return { name: text || null, address: null };
}

function extractLinks(html, text) {
  const source = `${html || ""}\n${text || ""}`;
  const found = new Set();
  for (const m of source.matchAll(/https?:\/\/[^\s<>'"]+/gi)) found.add(m[0].replace(/[),.;]+$/, ""));
  return [...found].slice(0, 20);
}

function normalizeMessage(m) {
  const html = typeof m.html_body === "string" ? m.html_body.slice(0, MAX_HTML_CHARS) : "";
  return {
    id: m.id,
    from: parseSender(m.sender),
    subject: m.subject || "(tanpa subjek)",
    receivedAt: m.received_at ? new Date(Number(m.received_at) * 1000).toISOString() : null,
    text: m.text_body || "",
    html,
    links: extractLinks(html, m.text_body),
  };
}

async function createInbox(name) {
  const body = name ? { name: String(name).toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 16) } : {};
  let result;
  try {
    result = await upstream(`${SITE_BASE}/api/tempmail/create`, { method: "POST", body });
    if (result.status >= 500) throw new Error("upstream 5xx");
  } catch {
    result = await upstream(`${WORKER_BASE}/api/inbox`, { method: "POST", body });
  }
  if (result.status >= 400) return { status: result.status, error: result.data.error || "Gagal membuat inbox" };
  const inbox = result.data.inbox || {};
  return {
    status: 200,
    data: { ok: true, inbox: { address: inbox.address, token: inbox.token || inbox.key, expiresAt: inbox.expiresAt || null } },
  };
}

async function readInbox(key) {
  const path = `?key=${encodeURIComponent(key)}`;
  let result;
  try {
    result = await upstream(`${SITE_BASE}/api/tempmail/inbox${path}`);
    if (result.status >= 500) throw new Error("upstream 5xx");
  } catch {
    result = await upstream(`${WORKER_BASE}/api/inbox${path}`);
  }
  if (result.status >= 400) return { status: result.status, error: result.data.error || "Inbox tidak ditemukan atau sudah kedaluwarsa" };
  const { inbox = {}, messages = [] } = result.data;
  return {
    status: 200,
    data: {
      ok: true,
      inbox: { address: inbox.address, expiresAt: inbox.expiresAt || null, permanent: Boolean(inbox.permanent) },
      messages: (Array.isArray(messages) ? messages : []).map(normalizeMessage),
    },
  };
}

async function removeInbox(key) {
  const result = await upstream(`${WORKER_BASE}/api/inbox`, { method: "DELETE", headers: { Authorization: `Bearer ${key}` } });
  if (result.status >= 400) return { status: result.status, error: result.data.error || "Gagal menghapus inbox" };
  return { status: 200, data: { ok: true } };
}

module.exports = async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  if (!isAllowedSource(req)) return send(res, 403, { ok: false, error: "link tidak resmi! Tidak dapat dibuka!" });

  const action = String(req.query.action || "");
  const key = String(req.query.key || (req.body && req.body.key) || "");
  const validKey = /^[\w.\-]{8,300}$/.test(key);

  try {
    let out;
    if (action === "create" && req.method === "POST") out = await createInbox(req.body && req.body.name);
    else if (action === "inbox" && req.method === "GET" && validKey) out = await readInbox(key);
    else if (action === "delete" && req.method === "POST" && validKey) out = await removeInbox(key);
    else return send(res, 400, { ok: false, error: "Permintaan tidak valid" });

    return out.error ? send(res, out.status, { ok: false, error: out.error }) : send(res, 200, out.data);
  } catch (error) {
    const timeout = error && error.name === "AbortError";
    return send(res, timeout ? 504 : 502, { ok: false, error: "Server Temp Mail tidak merespons. Coba lagi sebentar." });
  }
};
