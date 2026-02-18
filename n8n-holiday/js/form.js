import { fetchSubjectGroups, submitHoliday } from "./api.js";

function qs(id) {
  const el = document.getElementById(id);
  if (!el) throw new Error(`Missing element #${id}`);
  return el;
}

function showMsg(text, type = "") {
  const msg = qs("msg");
  msg.className = "msg" + (type ? ` msg--${type}` : "");
  msg.textContent = text || "";
}

function setSubmitting(isSubmitting) {
  const btn = qs("submitBtn");
  btn.disabled = isSubmitting;
  btn.textContent = isSubmitting ? "กำลังบันทึก…" : "บันทึก";
}

function setModeUI(mode) {
  const allDayBox = qs("allDayBox");
  const cancelBox = qs("cancelBox");

  if (mode === "cancel_subject") {
    allDayBox.classList.add("hidden");
    cancelBox.classList.remove("hidden");
  } else {
    cancelBox.classList.add("hidden");
    allDayBox.classList.remove("hidden");
  }
}

function toIsoBangkokStartEnd(startDateYYYYMMDD, endDateYYYYMMDD) {
  const start = `${startDateYYYYMMDD}T00:00:00+07:00`;
  const end = `${endDateYYYYMMDD}T23:59:59+07:00`;
  return { start_at: start, end_at: end };
}

function normalizeDayOrder(day) {
  const order = ["จันทร์", "อังคาร", "พุธ", "พฤหัสบดี", "ศุกร์", "เสาร์", "อาทิตย์"];
  const idx = order.indexOf(day);
  return idx === -1 ? 999 : idx;
}

function normalizeOption(raw, fallbackDay) {
  if (raw && (raw.id || raw.subject_id) && (raw.code || raw.meta || raw.label)) {
    const meta = raw.meta || {};
    const id = raw.id || raw.subject_id;

    const day = raw.day || meta.day || fallbackDay || "";
    const start = raw.start_time || meta.start_time || "";
    const end = raw.end_time || meta.end_time || "";
    const time = raw.time || (start && end ? `${start}-${end}` : "");

    const code = raw.code || meta.subject_code || "";
    const name = raw.name || meta.subject_name || "";
    const section = raw.section || meta.section || "";
    const type = raw.type || meta.type || "";

    return {
      id,
      day,
      time,
      code,
      name,
      section,
      type,
      label: raw.label || `${time} | ${code} | ${name} | ${type}`
    };
  }

  return {
    id: raw?.id || raw?.subject_id || crypto.randomUUID(),
    day: fallbackDay || "",
    time: "",
    code: "",
    name: raw?.label || "",
    section: "",
    type: "",
    label: raw?.label || ""
  };
}

function renderSubjects(groups, state, onPick) {
  const subjectsListEl = qs("subjectsList");
  subjectsListEl.innerHTML = "";

  const sortedGroups = (groups || [])
    .slice()
    .sort((a, b) => normalizeDayOrder(a.day) - normalizeDayOrder(b.day));

  for (const g of sortedGroups) {
    const dayWrap = document.createElement("div");
    dayWrap.className = "dayGroup";

    const header = document.createElement("div");
    header.className = "dayHeader";
    header.textContent = g.day || "ไม่ระบุวัน";
    dayWrap.appendChild(header);

    const options = (g.options || []).map((o) => normalizeOption(o, g.day));

    for (const opt of options) {
      const item = document.createElement("button");
      item.type = "button";
      item.className = "subjectItem";
      if (state.selectedSubject?.id === opt.id) item.classList.add("isActive");

      const searchable = [
        opt.time, opt.code, opt.name, opt.type, opt.day, opt.section, opt.label
      ].filter(Boolean).join(" ").toLowerCase();
      item.dataset.search = searchable;

      item.innerHTML = `
        <div class="subjectTime">${opt.time || ""}</div>
        <div class="subjectMain">
          <div class="subjectLine1">
            <span class="subjectCode">${opt.code || ""}</span>
            <span class="subjectTypePill">${opt.type || ""}</span>
          </div>
          <div class="subjectName">${opt.name || opt.label || ""}</div>
        </div>
      `;

      item.addEventListener("click", () => onPick(opt));
      dayWrap.appendChild(item);
    }

    subjectsListEl.appendChild(dayWrap);
  }
}

function applySubjectSearch() {
  const q = qs("subjectSearch").value.trim().toLowerCase();
  const items = qs("subjectsList").querySelectorAll(".subjectItem");
  items.forEach((el) => {
    const hit = !q || (el.dataset.search || "").includes(q);
    el.style.display = hit ? "" : "none";
  });
}

function setSelectedSubjectUI(subject) {
  const box = qs("subjectSelected");
  if (!subject) {
    box.classList.add("hidden");
    box.textContent = "";
    return;
  }
  box.classList.remove("hidden");
  box.innerHTML = `
    <div><b>เลือกแล้ว ✅</b></div>
    <div>${subject.day || ""} • ${subject.time || ""}</div>
    <div><b>${subject.code || ""}</b> ${subject.name || ""} (${subject.type || ""})</div>
  `;
}

// ===== NEW: Post-save reminder flow =====
function openOverlay(id) { document.getElementById(id)?.classList.remove("hidden"); }
function closeOverlay(id) { document.getElementById(id)?.classList.add("hidden"); }

function buildSummaryText(payload, selectedSubject) {
  // สรุปสั้น ๆ ไปแสดงใน modal
  const start = String(payload.start_at || "").slice(0, 10);
  const end = String(payload.end_at || "").slice(0, 10);
  const dateText = start === end ? start : `${start} – ${end}`;

  if (payload.type === "cancel") {
    const subj = selectedSubject
      ? `${selectedSubject.code} ${selectedSubject.name} (${selectedSubject.type})`
      : "ยกคลาส";
    return `${subj}\nวันที่: ${dateText}`;
  }
  return `วันหยุด\nวันที่: ${dateText}`;
}

function saveReminderDraft({ userId, payload, preset }) {
  const draft = {
    user_id: userId,
    created_at: new Date().toISOString(),
    preset,
    // เก็บ key สำคัญเพื่อไปผูกกับ holiday ที่เพิ่งสร้าง (Phase ต่อไป)
    type: payload.type,
    subject_id: payload.subject_id ?? null,
    start_at: payload.start_at,
    end_at: payload.end_at,
    title: payload.title ?? null
  };
  localStorage.setItem("holiday_reminder_draft", JSON.stringify(draft));
}

export function initHolidayForm({ userId, displayName, subjectsUrl, submitUrl, onDone }) {
  qs("who").textContent = displayName ? `คุณ ${displayName}` : "ผู้ใช้ LINE";

  const modeEl = qs("mode");
  const resetBtn = qs("resetBtn");
  const titleEl = qs("title");

  const startDateEl = qs("startDate");
  const endDateEl = qs("endDate");
  const cancelDateEl = qs("cancelDate");
  const cancelDateBox = qs("cancelDateBox");

  const state = {
    groups: [],
    selectedSubject: null,
    submitting: false
  };

  function validate() {
    const btn = qs("submitBtn");
    if (state.submitting) {
      btn.disabled = true;
      return;
    }
    if (modeEl.value === "cancel_subject") {
      btn.disabled = !(state.selectedSubject && cancelDateEl.value);
    } else {
      btn.disabled = !startDateEl.value;
    }
  }

  function pickSubject(opt) {
    state.selectedSubject = opt;
    setSelectedSubjectUI(opt);
    cancelDateBox.classList.remove("hidden");

    renderSubjects(state.groups, state, pickSubject);
    applySubjectSearch();
    validate();
  }

  modeEl.addEventListener("change", () => {
    setModeUI(modeEl.value);
    showMsg("");
    validate();
  });

  qs("subjectSearch").addEventListener("input", applySubjectSearch);

  resetBtn.addEventListener("click", () => {
    titleEl.value = "";
    startDateEl.value = "";
    endDateEl.value = "";
    cancelDateEl.value = "";

    state.selectedSubject = null;
    setSelectedSubjectUI(null);
    cancelDateBox.classList.add("hidden");

    if (state.groups.length) {
      renderSubjects(state.groups, state, pickSubject);
      applySubjectSearch();
    }

    showMsg("ล้างฟอร์มแล้ว ✅", "ok");
    validate();
  });

  startDateEl.addEventListener("change", validate);
  endDateEl.addEventListener("change", validate);
  cancelDateEl.addEventListener("change", validate);
  titleEl.addEventListener("input", validate);

  // ===== bind reminder modal buttons once =====
  const askCloseBtn = document.getElementById("reminderCloseBtn");
  const askSetBtn = document.getElementById("reminderSetBtn");
  const pickBackBtn = document.getElementById("reminderPickBackBtn");
  const pickSaveBtn = document.getElementById("reminderPickSaveBtn");
  const askSummaryEl = document.getElementById("reminderAskSummary");

  function getSelectedPreset() {
    const el = document.querySelector('input[name="remPreset"]:checked');
    return el?.value || "1d";
  }

  qs("submitBtn").addEventListener("click", async () => {
    if (state.submitting) return;

    try {
      validate();
      if (qs("submitBtn").disabled) {
        showMsg("กรอกข้อมูลให้ครบก่อนนะ 🙂", "err");
        return;
      }

      state.submitting = true;
      setSubmitting(true);
      showMsg("กำลังบันทึก…");

      const mode = modeEl.value;
      const title = titleEl.value.trim();

      let payload;

      if (mode === "cancel_subject") {
        const date = cancelDateEl.value;
        const { start_at, end_at } = toIsoBangkokStartEnd(date, date);

        payload = {
          user_id: userId,
          type: "cancel",
          subject_id: state.selectedSubject.id,
          all_day: 1,
          start_at,
          end_at,
          title: title || `${state.selectedSubject.code} ${state.selectedSubject.name}`,
          note: null,
          reminders: []
        };
      } else {
        const start = startDateEl.value;
        const end = endDateEl.value || start;
        const { start_at, end_at } = toIsoBangkokStartEnd(start, end);

        payload = {
          user_id: userId,
          type: "holiday",
          subject_id: null,
          all_day: 1,
          start_at,
          end_at,
          title: title || "วันหยุด",
          note: null,
          reminders: []
        };
      }

      await submitHoliday({ submitUrl, payload }); // api.js ของคุณ :contentReference[oaicite:4]{index=4}

      // 1) show check animation
      openOverlay("successOverlay");

      // 2) after a short beat -> ask reminders
      setTimeout(() => {
        closeOverlay("successOverlay");

        // แสดงสรุปใน dialog
        if (askSummaryEl) {
          askSummaryEl.textContent = buildSummaryText(payload, state.selectedSubject);
        }

        openOverlay("reminderAskOverlay");

        // bind actions (reset handlers)
        if (askCloseBtn) {
          askCloseBtn.onclick = () => {
            closeOverlay("reminderAskOverlay");
            try { onDone?.(); } catch {}
          };
        }

        if (askSetBtn) {
          askSetBtn.onclick = () => {
            closeOverlay("reminderAskOverlay");
            openOverlay("reminderPickOverlay");
          };
        }

        if (pickBackBtn) {
          pickBackBtn.onclick = () => {
            closeOverlay("reminderPickOverlay");
            openOverlay("reminderAskOverlay");
          };
        }

        if (pickSaveBtn) {
          pickSaveBtn.onclick = () => {
            const preset = getSelectedPreset();
            saveReminderDraft({ userId, payload, preset });

            // ปิด modal แล้วปิด LIFF
            closeOverlay("reminderPickOverlay");
            showMsg("บันทึกการตั้งค่าแจ้งเตือนไว้แล้ว 🔔", "ok");
            setTimeout(() => {
              try { onDone?.(); } catch {}
            }, 600);
          };
        }

      }, 900);

    } catch (e) {
      showMsg(`บันทึกไม่สำเร็จ: ${String(e?.message || e)}`, "err");
    } finally {
      state.submitting = false;
      setSubmitting(false);
      validate();
    }
  });

  async function loadSubjects() {
    try {
      showMsg("กำลังโหลดรายชื่อวิชา…");
      const groups = await fetchSubjectGroups({ subjectsUrl, userId }); // api.js :contentReference[oaicite:5]{index=5}
      state.groups = Array.isArray(groups) ? groups : [];

      renderSubjects(state.groups, state, pickSubject);
      applySubjectSearch();
      showMsg("");
    } catch (e) {
      showMsg(`โหลดวิชาไม่สำเร็จ: ${String(e?.message || e)}`, "err");
    } finally {
      validate();
    }
  }

  setModeUI(modeEl.value);
  showMsg("");
  validate();
  loadSubjects();
}
