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
 * ✅ ส่งข้อมูลไปให้ n8n ตรวจ + ส่งต่อเข้า worker + ตอบกลับ
 * n8n/worker ควรตอบกลับ:
 *  - 200: { ok:true, ... }
 *  - 4xx/409: { ok:false, code:"DUPLICATE"|..., error:"..." }
 */
export async function submitHolidayToN8n({ payload, context }) {
  const url = CONFIG.N8N_WEBHOOK_SAVE_HOLIDAY;

  // อ่าน response ให้ปลอดภัย: บางทีเป็น JSON, บางทีเป็น text
  const safeRead = async (res) => {
    const text = await res.text().catch(() => "");
    if (!text) return { text: "", json: null };
    try {
      return { text, json: JSON.parse(text) };
    } catch {
      return { text, json: null };
    }
  };

  // ทำ Error ที่มี field เพิ่มเพื่อให้ UI ใช้ได้
  const makeErr = ({ status, code, message, raw }) => {
    const e = new Error(message || "บันทึกไม่สำเร็จ");
    e.code = code || "UNKNOWN";
    e.status = status || 0;
    e.userMessage = message || "บันทึกไม่สำเร็จ";
    e.raw = raw;
    return e;
  };

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

  // ✅ สำคัญ: อย่า throw ดิบ ๆ ตอน non-2xx
  // เพราะ worker/n8n อาจส่ง { ok:false, code, error } กลับมาพร้อม status 409/400
  const { text, json } = await safeRead(res);
  const data = json ?? {};

  if (!res.ok) {
    // ถ้าเป็น JSON ที่มีรูปแบบมาตรฐาน ให้ยกข้อความ user-friendly
    if (data && typeof data === "object") {
      const msg = data.error || data.message || `HTTP ${res.status}`;
      const code = data.code || "HTTP_ERROR";
      throw makeErr({ status: res.status, code, message: msg, raw: data });
    }

    // ถ้าไม่ใช่ JSON
    throw makeErr({
      status: res.status,
      code: "HTTP_ERROR",
      message: `เกิดข้อผิดพลาด (${res.status})`,
      raw: text,
    });
  }

  // res.ok === true แต่ payload ok=false
  if (data?.ok === false) {
    const msg = data?.error || data?.message || "บันทึกไม่สำเร็จ";
    throw makeErr({
      status: res.status,
      code: data?.code || "FAILED",
      message: msg,
      raw: data,
    });
  }

  return data;
}