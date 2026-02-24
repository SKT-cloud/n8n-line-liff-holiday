import { CONFIG } from "./config.js?v=20260224_02";
import { initLiff } from "./auth.js?v=20260224_02";
import { fetchSubjects, createHoliday } from "./api.js?v=20260224_01";
import { initForm } from "./form.js?v=20260224_01";

const $ = (s) => document.querySelector(s);

function toast(msg, kind = "info") {
  const el = $("#toast");
  if (!el) return;
  el.textContent = msg;
  el.className = `toast ${kind}`;
  el.hidden = false;
  clearTimeout(toast._t);
  toast._t = setTimeout(() => (el.hidden = true), 2800);
}

function setStatus(text) {
  const el = $("#status");
  if (!el) return;
  el.textContent = text || "";
}

function ymdToDDMMYYYY(ymd) {
  if (!ymd) return "-";
  const [y, m, d] = String(ymd).split("-");
  if (!y || !m || !d) return "-";
  return `${d}/${m}/${y}`;
}

function buildConfirmText(payload) {
  const typeText = payload.type === "cancel" ? "ยกคลาส" : "หยุดทั้งวัน";
  const s = (payload.start_at || "").slice(0, 10);
  const e = (payload.end_at || "").slice(0, 10);
  const dateText =
    s && e ? (s === e ? ymdToDDMMYYYY(s) : `${ymdToDDMMYYYY(s)} – ${ymdToDDMMYYYY(e)}`) : "-";
  const remindCount = Array.isArray(payload.reminders) ? payload.reminders.length : 0;

  return [
    "ยืนยันการบันทึกใช่ไหม?",
    "",
    `ประเภท: ${typeText}`,
    `วันที่: ${dateText}`,
    `หัวข้อ: ${payload.title || "-"}`,
    `แจ้งเตือน: ${remindCount ? `${remindCount} เวลา` : "ไม่แจ้งเตือน"}`,
  ].join("\n");
}

async function closeLiffSafely() {
  try {
    if (window.liff?.isInClient?.() === true) {
      window.liff.closeWindow();
      return true;
    }
  } catch {}
  return false;
}

async function run() {
  try {
    setStatus("กำลังเปิดฟอร์ม…");

    const session = await initLiff();
    if (!session) return; // redirect to login
    const { idToken, profile } = session;

    const pill = $("#profileName");
    if (pill) pill.textContent = profile?.displayName || "ผู้ใช้";

    // preview date format
    const startDate = $("#startDate");
    const endDate = $("#endDate");
    const startPreview = $("#startPreview");
    const endPreview = $("#endPreview");
    const updatePreview = () => {
      if (startPreview) startPreview.textContent = startDate?.value ? ymdToDDMMYYYY(startDate.value) : "-";
      if (endPreview) endPreview.textContent = endDate?.value ? ymdToDDMMYYYY(endDate.value) : "-";
    };
    startDate?.addEventListener("change", updatePreview);
    endDate?.addEventListener("change", updatePreview);
    updatePreview();

    // load subjects (ถ้าเจอ IdToken expired → force relogin)
    setStatus("กำลังโหลดตารางวิชา…");
    let items = [];
    try {
      items = await fetchSubjects({ idToken });
    } catch (e) {
      const msg = e?.message || String(e);
      if (/IdToken expired/i.test(msg)) {
        toast("โทเคนหมดอายุ กำลังเข้าสู่ระบบใหม่…", "info");
        await initLiff({ forceRelogin: true });
        return;
      }
      throw e;
    }

    const subjectsStatus = $("#subjectsStatus");
    if (subjectsStatus) subjectsStatus.textContent = items.length ? `มี ${items.length} รายวิชา` : "ยังไม่มีรายวิชาในระบบ";

    setStatus("");

    initForm({
      el: document,
      mode: CONFIG.getMode(),
      profile,
      subjects: items,
      onSubmit: async (payload) => {
        const ok = window.confirm(buildConfirmText(payload));
        if (!ok) {
          toast("ยกเลิกแล้ว 👌", "info");
          return;
        }

        try {
          setStatus("กำลังบันทึก…");
          toast("กำลังบันทึก…", "info");

          await createHoliday({ idToken, payload });

          setStatus("");
          toast("บันทึกสำเร็จ ✅", "ok");
          setTimeout(() => closeLiffSafely(), 650);
        } catch (e) {
          const msg = e?.message || String(e);
          if (/IdToken expired/i.test(msg)) {
            toast("โทเคนหมดอายุ กำลังเข้าสู่ระบบใหม่…", "info");
            await initLiff({ forceRelogin: true });
            return;
          }
          console.error(e);
          setStatus("");
          toast(msg, "err");
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