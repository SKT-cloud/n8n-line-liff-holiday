export const CONFIG = {
  // ✅ Worker base
  WORKER_BASE: "https://study-holiday-api.suwijuck-kat.workers.dev",

  // ✅ n8n webhook (ให้ LIFF ยิงเข้า n8n แล้วให้ n8n เป็นคนบันทึก + ส่ง Flex)
  // ใส่ URL จริงของคุณตรงนี้
  N8N_WEBHOOK_SAVE_HOLIDAY: "",

  // ✅ LIFF IDs (ของคุณ)
  LIFF_ID_ADD: "2009146879-xoNc2sVq",
  LIFF_ID_EDIT: "2009146879-3eBGpF5j",

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
