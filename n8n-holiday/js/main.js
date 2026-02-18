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
  function initSingleDatePicker(inputId, placeholderText) {
    const input = document.getElementById(inputId);
    if (!input) return;

    flatpickr(input, {
      dateFormat: "Y-m-d",
      altInput: true,
      altFormat: "d/m/Y",
      allowInput: true,
      disableMobile: true,
      onReady: (_, __, instance) => {
        if (instance.altInput) {
          instance.altInput.placeholder = placeholderText;
          instance.altInput.autocomplete = "off";
        }
      }
    });
  }

  // Keep all date fields in the same format and behavior.
  initSingleDatePicker("startDate", "กรุณาเลือกวันที่เริ่ม");
  initSingleDatePicker("endDate", "หากหยุดวันเดียว สามารถเว้นไว้ได้");
  initSingleDatePicker("cancelDate", "กรุณาเลือกวันที่ยกคลาส");
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
      subjectsUrl: CONFIG.N8N_SUBJECTS_URL,
      submitUrl: CONFIG.N8N_SUBMIT_URL,
      onDone: () => {
        try {
          liff.closeWindow();
        } catch {}
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
