import { initLiff } from "./auth.js";
import { fetchSubjects, createHoliday } from "./api.js";
import { CONFIG } from "./config.js";
import { initForm } from "./form.js";

const $ = (s) => document.querySelector(s);

function setStatus(text) {
  const el = $("#status");
  if (!el) return;
  el.textContent = text || "";
}

function toast(msg, kind = "info") {
  const el = $("#toast");
  if (!el) return;
  el.hidden = false;
  el.textContent = msg;

  // style by kind (เบา ๆ)
  el.style.borderColor = kind === "err" ? "rgba(239,68,68,.28)" : "rgba(15,23,42,.10)";
  el.style.background = kind === "err" ? "rgba(254,242,242,.92)" : "rgba(255,255,255,.94)";

  clearTimeout(toast._t);
  toast._t = setTimeout(() => (el.hidden = true), 2600);
}

async function run() {
  try {
    setStatus("กำลังเปิดฟอร์ม…");

    const session = await initLiff();
    if (!session) return; // login redirect
    const { idToken, profile } = session;

    // Show profile name
    const profileEl = $("#profileName");
    if (profileEl) profileEl.textContent = profile?.displayName || "ผู้ใช้";

    // Mode badge
    const badge = $("#badge");
    if (badge) badge.textContent = CONFIG.getMode() === "edit" ? "Edit" : "Add";

    // Load subjects
    const subjectsStatus = $("#subjectsStatus");
    if (subjectsStatus) subjectsStatus.textContent = "กำลังโหลดรายวิชา…";

    const subjects = await fetchSubjects({ idToken });

    if (subjectsStatus) {
      subjectsStatus.textContent = subjects.length ? `มี ${subjects.length} รายวิชา` : "ยังไม่มีรายวิชาในระบบ";
    }

    setStatus("");

    // Mount initForm (ใช้ UI + logic ที่คุณทำไว้ใน form.js)
    initForm({
      el: document,
      mode: CONFIG.getMode(),
      profile,
      subjects,

      onSubmit: async (payload) => {
        try {
          setStatus("กำลังบันทึก…");

          // form.js ส่ง subject เป็น object (ถ้าเป็น cancel)
          // แต่ Worker ต้องการ subject_id
          const subject_id = payload?.subject ? (payload.subject.id ?? null) : null;

          const finalPayload = {
            type: payload.type,
            title: payload.title,
            note: payload.note,
            start_at: payload.start_at,
            end_at: payload.end_at,
            all_day: payload.all_day ?? 1,
            subject_id,
            reminders: payload.reminders || [],
          };

          await createHoliday({ idToken, payload: finalPayload });

          setStatus("");
          toast("บันทึกสำเร็จ ✅", "ok");

          try { window.liff.closeWindow(); } catch (_) {}
        } catch (e) {
          console.error(e);
          setStatus("");
          toast(e?.message || String(e), "err");
        }
      },
    });

  } catch (e) {
    console.error(e);
    setStatus("");
    toast(`เปิดฟอร์มไม่สำเร็จ: ${e?.message || e}`, "err");
  }
}

document.addEventListener("DOMContentLoaded", run);