import { CONFIG, joinUrl } from "./config.js";

async function requestJson(path, { method = "GET", idToken, body } = {}) {
  const url = joinUrl(CONFIG.WORKER_BASE, path);
  const headers = { "Content-Type": "application/json" };
  if (idToken) headers.Authorization = `Bearer ${idToken}`;

  const res = await fetch(url, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });

  const data = await res.json().catch(() => ({}));

  if (!res.ok || data.ok === false) {
    const msg = data?.error || data?.message || `HTTP ${res.status}`;
    // ทำให้ main.js จับได้ง่าย
    if (/expired/i.test(msg)) {
      const err = new Error("IDTOKEN_EXPIRED");
      err.code = "IDTOKEN_EXPIRED";
      throw err;
    }
    throw new Error(msg);
  }

  return data;
}

export async function fetchSubjects({ idToken }) {
  const data = await requestJson("/liff/subjects", { method: "GET", idToken });
  return data.items || [];
}

export async function createHoliday({ idToken, payload }) {
  return requestJson("/liff/holidays/create", { method: "POST", idToken, body: payload });
}
