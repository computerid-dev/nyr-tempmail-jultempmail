async function call(path, options = {}) {
  const response = await fetch(path, { headers: { "Content-Type": "application/json" }, ...options });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || data.ok === false) {
    const error = new Error(data.error || "Permintaan gagal, coba lagi.");
    error.status = response.status;
    throw error;
  }
  return data;
}

export const createInbox = (name) =>
  call("/api/tempmail/create", { method: "POST", body: JSON.stringify(name ? { name } : {}) });

export const fetchInbox = (key) => call(`/api/tempmail/inbox?key=${encodeURIComponent(key)}`);

export const deleteInbox = (key) =>
  call("/api/tempmail/delete", { method: "POST", body: JSON.stringify({ key }) });
