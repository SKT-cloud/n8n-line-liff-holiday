import { CONFIG } from "./config.js";
import { initAndRequireLogin } from "./auth.js";
import { initHolidayForm } from "./form.js";

function showLoading(text) {
  const loading = document.getElementById("loading");
  const subtitle = loading.querySelector(".loading__subtitle");
  subtitle.textContent = text || "กำลังทำงาน...";
}

function showApp() {
  document.getElementById("loading").classList.add("hidden");
  document.getElementById("app").classList.remove("hidden");
}

function initDatePickers() {
  const common = (placeholderText) => ({
    dateFormat: "Y-m-d",
    altInput: true,
    altFormat: "d/m/Y",

    // ✅ กดเลือกอย่างเดียว ห้ามพิมพ์
    allowInput: false,

    // ✅ บังคับใช้ flatpickr แม้บนมือถือ
    disableMobile: true,

    // ✅ ห้ามเลือกย้อนหลัง
    minDate: "today",

    onReady: (_, __, instance) => {
      // ล็อก input ทั้งตัวจริงและ altInput (ตัวที่ผู้ใช้เห็น)
      const lock = (el) => {
        if (!el) return;
        el.readOnly = true;
        el.setAttribute("inputmode", "none");
        el.setAttribute("autocomplete", "off");
        el.placeholder = placeholderText || el.placeholder || "";
        el.addEventListener("keydown", (e) => e.preventDefault());
        el.addEventListener("paste", (e) => e.preventDefault());
      };
      lock(instance.input);
      lock(instance.altInput);
    }
  });

  const startEl = document.getElementById("startDate");
  const endEl = document.getElementById("endDate");
  const cancelEl = document.getElementById("cancelDate");

  let endPicker = null;

  const startPicker = startEl
    ? flatpickr(startEl, {
        ...common("กรุณาเลือกวันที่เริ่ม"),
        onChange: (selectedDates, dateStr) => {
          // เมื่อเลือกวันเริ่ม -> บังคับให้วันสิ้นสุดเลือกได้ไม่ก่อนวันเริ่ม
          if (endPicker) {
            endPicker.set("minDate", dateStr || "today");

            // ถ้า endDate มีค่าอยู่แล้วแต่ดันน้อยกว่า start -> เคลียร์ให้
            if (endPicker.input.value && endPicker.input.value < dateStr) {
              endPicker.clear();
              // trigger change ให้ form.js refresh/validate
              endPicker.input.dispatchEvent(new Event("change", { bubbles: true }));
            }
          }
        }
      })
    : null;

  if (endEl) {
    endPicker = flatpickr(endEl, {
      ...common("หากหยุดวันเดียว สามารถเว้นไว้ได้"),
      // minDate ของ endDate ต้องตาม startDate ถ้ามี
      minDate: startPicker?.input?.value || "today"
    });
  }

  if (cancelEl) {
    flatpickr(cancelEl, {
      ...common("กรุณาเลือกวันที่ยกคลาส")
    });
  }
}

(async () => {
  try {
    showLoading("กำลังตรวจสอบการเข้าสู่ระบบ LINE 🔐");

    const profile = await initAndRequireLogin(CONFIG.LIFF_ID);
    if (!profile) {
      showLoading("กำลังพาไปหน้า Login… ถ้าไม่เด้ง ให้เช็ก Allowed domains/Endpoint URL");
      return;
    }

    showLoading("กำลังโหลดฟอร์ม…");
    showApp();
    initDatePickers();

    initHolidayForm({
      userId: profile.userId,
      displayName: profile.displayName,
      subjectsUrl: CONFIG.N8N_SUBJECTS_URL, // ✅ webhook-test ยังเหมือนเดิม
      submitUrl: CONFIG.N8N_SUBMIT_URL,     // ✅ webhook-test ยังเหมือนเดิม
      onDone: () => {
        try { liff.closeWindow(); } catch {}
      }
    });
  } catch (e) {
    const loading = document.getElementById("loading");
    loading.innerHTML = `
      <div class="loading__box">
        <div class="loading__title">เกิดข้อผิดพลาด ❌</div>
        <div class="loading__subtitle">${String(e?.message || e)}</div>
        <div style="margin-top:10px;color:#666;font-size:12px;">
          ตรวจสอบ CONFIG (LIFF_ID/URLs) และเปิดจากใน LINE LIFF
        </div>
      </div>
    `;
  }
})();
