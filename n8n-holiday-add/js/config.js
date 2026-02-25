export const CONFIG = {
  // ✅ Worker base
  WORKER_BASE: "https://study-holiday-api.suwijuck-kat.workers.dev",

  // ✅ LIFF IDs (ของคุณ)
  LIFF_ID_ADD: "2009146879-xoNc2sVq",
  LIFF_ID_EDIT: "2009146879-3eBGpF5j",

  // ✅ n8n webhook (ใช้ webhook-test ไปก่อนตามที่บอก)
  N8N_WEBHOOK_SAVE_HOLIDAY: "https://spu-n8n.spu.ac.th/webhook-test/liff-holiday-add",

  // ✅ Secret key สำหรับกันคนยิงมั่ว (สุ่มให้แล้ว)
  N8N_WEBHOOK_KEY: "n8n_8R6vT9qK2pX7mC4hW1sY5eL0zD3uJ6bA",

  // optional: ถ้าจะให้ worker push confirm เอง (ตั้งใน worker env PUSH_ON_SAVE=1)
  PUSH_ON_SAVE: false,

  getMode() {
    const p = (location.pathname || "/").toLowerCase();
    if (p.includes("edit")) return "edit";
    return "add";
  },

  getLiffId() {
    return this.getMode() === "edit" ? this.LIFF_ID_EDIT : this.LIFF_ID_ADD;
  },
};

export function joinUrl(base, path) {
  return String(base).replace(/\/+$/, "") + "/" + String(path).replace(/^\/+/, "");
}