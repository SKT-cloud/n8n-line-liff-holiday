// main.js
import { loadConfig } from "./config.js";
import { initAuth, relogin } from "./auth.js";
import { initHolidayForm } from "./form.js";
import { apiSaveHoliday } from "./api.js";

// ===== helpers =====
const $ = (sel) => document.querySelector(sel);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function setStatus(text = "") {
  const el = $("#status");
  if (el) el.textContent = text || "";
}

// ===== toast (ยังเก็บไว้ใช้ตอน success/info ได้) =====
function toast(msg, type = "ok") {
  const el = $("#toast");
  if (!el) return;

  el.textContent = msg;
  el.classList.remove("ok", "err", "show");
  el.classList.add(type);
  el.classList.add("show");

  clearTimeout(toast._t);
  toast._t = setTimeout(() => el.classList.remove("show"), 2600);
}

// ===== overlay =====
function showOverlay(kind = "loading", title = "", detail = "") {
  const ov = $("#overlay");
  if (!ov) return;

  ov.classList.remove("hidden", "closing");
  ov.dataset.kind = kind;

  const t = $("#overlayTitle");
  const d = $("#overlayDetail");
  if (t) t.textContent = title || "";
  if (d) d.textContent = detail || "";
}

function hideOverlay(instant = false) {
  const ov = $("#overlay");
  if (!ov) return;

  if (instant) {
    ov.classList.add("hidden");
    ov.classList.remove("closing");
    return;
  }

  ov.classList.add("closing");
  setTimeout(() => {
    ov.classList.add("hidden");
    ov.classList.remove("closing");
  }, 220);
}

async function bootstrap() {
  try {
    setStatus("กำลังโหลด...");

    const cfg = await loadConfig();
    await initAuth(cfg);

    setStatus("");

    // init form
    initHolidayForm({
      onSubmit: async (payload) => {
        // payload คือสิ่งที่ form.js สร้าง (type, subject_id, start_at, end_at, title, note, reminders, etc.)
        try {
          setStatus("");
          showOverlay("loading", "กำลังบันทึก...", "รอสักครู่นะคะ 🥺✨");

          const res = await apiSaveHoliday(payload);

          // ✅ success
          showOverlay("ok", "บันทึกเรียบร้อยแล้วค่ะ 💖", res?.message || "เสร็จแล้ว!");
          await sleep(700);

          // ปิด LIFF เมื่อ success เท่านั้น
          if (window.liff?.isInClient?.()) {
            try {
              window.liff.closeWindow();
              return;
            } catch (e) {
              console.warn("closeWindow failed", e);
            }
          }

          hideOverlay(true);
          return;
        } catch (err) {
          console.error(err);
          setStatus("");

          // ❗ สำคัญ: แสดง “ที่เดียว” = overlay เท่านั้น
          const msg = (err?.message || String(err) || "บันทึกไม่สำเร็จ").slice(0, 220);
          showOverlay("err", "บันทึกไม่สำเร็จ 😿", msg);
          await sleep(1600);
          hideOverlay(true);
          return;
        }
      },

      onTokenExpired: relogin,

      onError: (err) => {
        console.error(err);

        // ❗ แสดง error ที่เดียว (overlay)
        const msg = (err?.message || String(err) || "เกิดข้อผิดพลาด").slice(0, 220);
        try {
          showOverlay("err", "เกิดข้อผิดพลาด 😿", msg);
        } catch (_) {
          // fallback เงียบ ๆ
        }
        setStatus("");
      },
    });
  } catch (e) {
    console.error(e);
    setStatus("");
    try {
      hideOverlay(true);
    } catch (_) {}
    // กรณีเปิดหน้าไม่ขึ้นจริง ๆ ค่อย toast ได้
    toast(`เปิดฟอร์มไม่สำเร็จ: ${e?.message || e}`, "err");
  }
}

bootstrap();