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

/**
 * ✅ ส่งข้อมูลไปให้ n8n ตรวจ + บันทึก + push flex (ตาม flow ใหม่)
 * n8n ควรตอบกลับ:
 *  - { ok:true, message?:string }
 *  - { ok:false, error:"..." }
 */
export async function submitHolidayToN8n({ payload, context }) {
  const url = CONFIG.N8N_WEBHOOK_SAVE_HOLIDAY;

  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": CONFIG.N8N_WEBHOOK_KEY,
    },
    body: JSON.stringify({
      action: "save_holiday",
      payload,
      context: {
        userId: context?.userId || null,
        displayName: context?.displayName || null,
        idToken: context?.idToken || null,
        ts: Date.now(),
      },
    }),
  });

  // ถ้า n8n ตอบไม่ใช่ 2xx ให้โชว์ raw text ไปเลย (ดีบักง่าย)
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`n8n error (${res.status}): ${text || "no body"}`.slice(0, 300));
  }

  const data = await res.json().catch(() => ({}));
  if (!data?.ok) {
    throw new Error(data?.error || data?.message || "บันทึกไม่สำเร็จ");
  }

  return data;
}