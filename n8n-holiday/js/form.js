import { fetchSubjectGroups, submitHoliday } from "./api.js";

const DRAFT_KEY = "holiday_draft_v1";

function qs(id) {
  const el = document.getElementById(id);
  if (!el) throw new Error(`Missing element #${id}`);
  return el;
}

function setMsg(el, type, text) {
  el.className = "msg" + (type === "ok" ? " msg--ok" : type === "err" ? " msg--err" : "");
  el.textContent = text || "";
}

function toISOAllDayStart(dateStr) {
  return `${dateStr}T00:00:00+07:00`;
}

function toISOAllDayEnd(dateStr) {
  return `${dateStr}T23:59:59+07:00`;
}

function formatDDMMYYYY(dateStr) {
  if (!dateStr) return "";
  const [y, m, d] = dateStr.split("-");
  if (!y || !m || !d) return "";
  return `${d}/${m}/${y}`;
}

function readDraft() {
  try {
    const raw = sessionStorage.getItem(DRAFT_KEY);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function writeDraft(draft) {
  sessionStorage.setItem(DRAFT_KEY, JSON.stringify(draft));
}

function clearDraft() {
  sessionStorage.removeItem(DRAFT_KEY);
}

function escapeHtml(s) {
  return String(s)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function normalize(s) {
  return String(s || "").toLowerCase().trim();
}

function shortLabel(opt) {
  const m = opt?.meta || {};
  const start = m.start_time || "";
  const end = m.end_time || "";
  const code = m.subject_code || "";
  const name = m.subject_name || "";
  const type = m.type || "";
  const time = start && end ? `${start}-${end}` : start || end || "";

  return { time, code, name, type };
}

export function initHolidayForm({ userId, displayName, subjectsUrl, submitUrl, onDone }) {
  const titleEl = qs("title");
  const modeEl = qs("mode");

  const allDayBox = qs("allDayBox");
  const startDateEl = qs("startDate");
  const endDateEl = qs("endDate");
  const startPretty = qs("startDatePretty");
  const endPretty = qs("endDatePretty");

  const cancelBox = qs("cancelBox");
  const subjectsListEl = qs("subjectsList");
  const subjectSearchEl = qs("subjectSearch");
  const subjectSelectedEl = qs("subjectSelected");
  const cancelDateBox = qs("cancelDateBox");
  const cancelDateEl = qs("cancelDate");
  const cancelPretty = qs("cancelDatePretty");

  const submitBtn = qs("submitBtn");
  const resetBtn = qs("resetBtn");
  const msgEl = qs("msg");
  const whoEl = qs("who");

  whoEl.textContent = displayName ? `ล็อกอินแล้ว: ${displayName}` : "ล็อกอินแล้ว ✅";

  // Local UI state for subject options and current selection.
  let groupsCache = [];
  let selectedSubjectId = "";

  function getDraftFromUI() {
    return {
      title: titleEl.value || "",
      mode: modeEl.value || "all_day",
      startDate: startDateEl.value || "",
      endDate: endDateEl.value || "",
      subjectId: selectedSubjectId || "",
      cancelDate: cancelDateEl.value || "",
      search: subjectSearchEl.value || ""
    };
  }

  function applyDraftToUI(draft) {
    if (!draft) return;
    titleEl.value = draft.title || "";
    modeEl.value = draft.mode || "all_day";
    startDateEl.value = draft.startDate || "";
    endDateEl.value = draft.endDate || "";
    cancelDateEl.value = draft.cancelDate || "";
    subjectSearchEl.value = draft.search || "";
    selectedSubjectId = draft.subjectId || "";
  }

  function refreshPrettyDates() {
    const startPrettyText = startDateEl.value ? formatDDMMYYYY(startDateEl.value) : "";
    const endPrettyText = endDateEl.value ? formatDDMMYYYY(endDateEl.value) : "";
    startPretty.textContent = startPrettyText ? `เลือก: ${startPrettyText}` : "";
    endPretty.textContent = endPrettyText
      ? `เลือก: ${endPrettyText}`
      : startPrettyText
        ? "เว้นช่องวันที่สิ้นสุดได้ หากหยุดวันเดียว"
        : "";

    cancelPretty.textContent = cancelDateEl.value ? `เลือก: ${formatDDMMYYYY(cancelDateEl.value)}` : "";
  }

  function setModeUI() {
    const mode = modeEl.value;
    if (mode === "all_day") {
      allDayBox.classList.remove("hidden");
      cancelBox.classList.add("hidden");
    } else {
      allDayBox.classList.add("hidden");
      cancelBox.classList.remove("hidden");
    }
    validate();
    writeDraft(getDraftFromUI());
  }

  // Check required values before enabling submit.
  function validate() {
    setMsg(msgEl, "", "");

    const mode = modeEl.value;
    let ok = false;

    if (mode === "all_day") {
      ok = !!startDateEl.value;
      if (startDateEl.value && endDateEl.value && endDateEl.value < startDateEl.value) {
        ok = false;
        setMsg(msgEl, "err", "วันที่สิ้นสุดต้องไม่ก่อนวันที่เริ่ม ❌");
      }
    } else {
      ok = !!selectedSubjectId && !!cancelDateEl.value;
    }

    submitBtn.disabled = !ok;
  }

  function renderSelectedInfo() {
    if (!selectedSubjectId) {
      subjectSelectedEl.classList.add("hidden");
      subjectSelectedEl.innerHTML = "";
      return;
    }

    let found = null;
    for (const g of groupsCache) {
      for (const opt of g.options || []) {
        if (opt.subject_id === selectedSubjectId) {
          found = opt;
          break;
        }
      }
      if (found) break;
    }

    if (!found) {
      subjectSelectedEl.classList.remove("hidden");
      subjectSelectedEl.innerHTML = `<b>เลือกแล้ว:</b> ${escapeHtml(selectedSubjectId)}`;
      return;
    }

    const { time, code, name, type } = shortLabel(found);
    subjectSelectedEl.classList.remove("hidden");
    subjectSelectedEl.innerHTML =
      `<b>เลือกแล้ว:</b> ${escapeHtml(time)} • ${escapeHtml(code)} • ${escapeHtml(name)} • ${escapeHtml(type)}`;
  }

  function setActiveButton() {
    subjectsListEl
      .querySelectorAll(".subjectItem.isActive")
      .forEach((el) => el.classList.remove("isActive"));

    if (!selectedSubjectId) return;

    const btn = subjectsListEl.querySelector(`[data-subject-id="${CSS.escape(selectedSubjectId)}"]`);
    if (btn) btn.classList.add("isActive");
  }

  function matchesSearch(opt, q) {
    if (!q) return true;
    const m = opt?.meta || {};
    const hay = normalize(
      [m.subject_code, m.subject_name, m.type, m.start_time, m.end_time, m.day]
        .filter(Boolean)
        .join(" ")
    );
    return hay.includes(q);
  }

  // Render grouped subject buttons and bind click handlers.
  function buildSubjectsBlocks(groups) {
    const q = normalize(subjectSearchEl.value);

    let html = "";
    let totalShown = 0;

    for (const g of groups) {
      const day = g.day || "อื่นๆ";
      const options = (g.options || []).filter((opt) => matchesSearch(opt, q));
      if (options.length === 0) continue;

      html += `
        <div class="dayGroup">
          <div class="dayHeader">${escapeHtml(day)}</div>
      `;

      for (const opt of options) {
        const { time, code, name, type } = shortLabel(opt);
        html += `
          <button type="button" class="subjectItem" data-subject-id="${escapeHtml(opt.subject_id)}">
            <div class="subjectTime">${escapeHtml(time || "--:--- --:--")}</div>
            <div class="subjectMain">
              <div class="subjectLine1">
                <span class="subjectCode">${escapeHtml(code || "-")}</span>
                <span class="subjectTypePill">${escapeHtml(type || "-")}</span>
              </div>
              <div class="subjectName" title="${escapeHtml(name)}">${escapeHtml(name || "-")}</div>
            </div>
          </button>
        `;
        totalShown++;
      }

      html += `</div>`;
    }

    if (totalShown === 0) {
      html = `<div class="subjects__loading">ไม่พบวิชาที่ค้นหา 😅</div>`;
    }

    subjectsListEl.innerHTML = html;
    subjectsListEl.querySelectorAll(".subjectItem").forEach((btn) => {
      btn.addEventListener("click", () => {
        selectedSubjectId = btn.getAttribute("data-subject-id") || "";
        cancelDateBox.classList.remove("hidden");
        setActiveButton();
        renderSelectedInfo();
        validate();
        writeDraft(getDraftFromUI());
      });
    });

    setActiveButton();
  }

  async function loadSubjectsAndRender() {
    subjectsListEl.innerHTML = `<div class="subjects__loading">กำลังโหลดรายชื่อวิชา…</div>`;

    try {
      const groups = await fetchSubjectGroups({ subjectsUrl, userId });
      groupsCache = Array.isArray(groups) ? groups : [];
      buildSubjectsBlocks(groupsCache);

      if (selectedSubjectId) {
        cancelDateBox.classList.remove("hidden");
        setActiveButton();
        renderSelectedInfo();
      } else {
        cancelDateBox.classList.add("hidden");
        renderSelectedInfo();
      }

      validate();
    } catch (e) {
      subjectsListEl.innerHTML = `<div class="subjects__loading" style="color:#b00020">โหลดรายชื่อวิชาไม่สำเร็จ ❌</div>`;
      setMsg(msgEl, "err", String(e?.message || e));
    }
  }

  const draft = readDraft();
  applyDraftToUI(draft);
  refreshPrettyDates();
  setModeUI();

  modeEl.addEventListener("change", () => {
    setModeUI();
    if (modeEl.value === "cancel_subject") {
      cancelDateBox.classList.toggle("hidden", !selectedSubjectId);
      renderSelectedInfo();
    }
  });

  titleEl.addEventListener("input", () => writeDraft(getDraftFromUI()));

  startDateEl.addEventListener("change", () => {
    refreshPrettyDates();
    validate();
    writeDraft(getDraftFromUI());
  });

  endDateEl.addEventListener("change", () => {
    refreshPrettyDates();
    validate();
    writeDraft(getDraftFromUI());
  });

  cancelDateEl.addEventListener("change", () => {
    refreshPrettyDates();
    validate();
    writeDraft(getDraftFromUI());
  });

  subjectSearchEl.addEventListener("input", () => {
    buildSubjectsBlocks(groupsCache);
    setActiveButton();
    renderSelectedInfo();
    writeDraft(getDraftFromUI());
  });

  resetBtn.addEventListener("click", () => {
    titleEl.value = "";
    modeEl.value = "all_day";
    startDateEl.value = "";
    endDateEl.value = "";
    cancelDateEl.value = "";
    subjectSearchEl.value = "";
    selectedSubjectId = "";
    cancelDateBox.classList.add("hidden");
    clearDraft();

    const startPicker = startDateEl._flatpickr;
    if (startPicker) startPicker.clear();
    const endPicker = endDateEl._flatpickr;
    if (endPicker) endPicker.clear();
    const cancelPicker = cancelDateEl._flatpickr;
    if (cancelPicker) cancelPicker.clear();

    refreshPrettyDates();
    setModeUI();
    renderSelectedInfo();
    setMsg(msgEl, "", "");
    buildSubjectsBlocks(groupsCache);
    validate();
  });

  // Build payload and submit to n8n endpoint.
  submitBtn.addEventListener("click", async () => {
    submitBtn.disabled = true;
    setMsg(msgEl, "", "กำลังบันทึก...");

    const mode = modeEl.value;
    const title = titleEl.value?.trim() || null;
    let payload;

    if (mode === "all_day") {
      const start = startDateEl.value;
      const end = endDateEl.value || start;
      payload = {
        user_id: userId,
        type: "holiday",
        all_day: 1,
        start_at: toISOAllDayStart(start),
        end_at: toISOAllDayEnd(end),
        title,
        note: null,
        reminders: []
      };
    } else {
      const date = cancelDateEl.value;
      payload = {
        user_id: userId,
        type: "cancel",
        subject_id: selectedSubjectId,
        all_day: 1,
        start_at: toISOAllDayStart(date),
        end_at: toISOAllDayEnd(date),
        title,
        note: null,
        reminders: []
      };
    }

    try {
      const res = await submitHoliday({ submitUrl, payload });
      clearDraft();
      setMsg(msgEl, "ok", "บันทึกสำเร็จ ✅");
      try {
        onDone?.(res);
      } catch {}
    } catch (e) {
      setMsg(msgEl, "err", String(e?.message || e));
      validate();
    }
  });

  loadSubjectsAndRender();
}
