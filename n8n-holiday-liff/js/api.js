import { CONFIG, joinUrl } from "./config.js";

export const API_VERSION = "20260224_01";

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
    throw new Error(msg);
  }
  return data;
}

export async function fetchSubjects({ idToken }) {
  const data = await requestJson("/liff/subjects", { method: "GET", idToken });
  return data.items || [];
}

// ✅ export นี้ต้องมีแน่ๆ ไม่งั้น main.js import พัง
export async function createHoliday({ idToken, payload }) {
  return requestJson("/liff/holidays/create", { method: "POST", idToken, body: payload });
}

export async function listHolidays({ idToken, from, to }) {
  const qs = new URLSearchParams({ from, to }).toString();
  const data = await requestJson(`/liff/holidays/list?${qs}`, { method: "GET", idToken });
  return data.items || [];
}

export async function setReminders({ idToken, holiday_id, reminders }) {
  return requestJson("/liff/holidays/reminders/set", {
    method: "POST",
    idToken,
    body: { holiday_id, reminders },
  });
}

export async function deleteHoliday({ idToken, id }) {
  return requestJson("/liff/holidays/delete", { method: "POST", idToken, body: { id } });
}