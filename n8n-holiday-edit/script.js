"use strict";

/* =========================
   Config
   ========================= */
const LIFF_ID_FROM_WINDOW = (typeof window !== "undefined" && window.__LIFF_ID__)
  ? String(window.__LIFF_ID__).trim()
  : "";
const LIFF_ID_FROM_QS = new URLSearchParams(location.search).get("liffId") || "";
const LIFF_ID = LIFF_ID_FROM_WINDOW || LIFF_ID_FROM_QS;

const API_BASE_FROM_WINDOW = (typeof window !== "undefined" && window.__API_BASE__)
  ? String(window.__API_BASE__).trim()
  : "";
const API_BASE_FROM_QS = new URLSearchParams(location.search).get("apiBase") || "";

function normalizeBase(u) {
  const s = (u || "").trim();
  if (!s) return "";
  if (/^https?:\/\//i.test(s)) return s.replace(/\/+$/, "");
  return `https://${s.replace(/\/+$/, "")}`;
}

const API_BASE = normalizeBase(API_BASE_FROM_WINDOW || API_BASE_FROM_QS);
if (!API_BASE) console.warn("API_BASE is empty -> will hit Pages origin (wrong).");

/* =========================
   Helpers
   ========================= */
const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => Array.from(document.querySelectorAll(sel));

function toast(msg, type = "ok") {
  const t = $("#toast");
  t.textContent = msg;
  t.className = `toast ${type === "err" ? "err" : "ok"}`;
  t.hidden = false;
  clearTimeout(toast._tm);
  toast._tm = setTimeout(() => (t.hidden = true), 3200);
}

function ymdToThai(ymd) {
  if (!ymd) return "-";
  const [y, m, d] = String(ymd).split("-");
  if (!y || !m || !d) return "-";
  return `${d}/${m}/${y}`;
}

function isoToThaiDateTime(iso) {
  if (!iso || typeof iso !== "string") return "-";
  const ymd = iso.slice(0, 10);
  const hhmm = iso.slice(11, 16);
  return `${ymdToThai(ymd)} ${hhmm} น.`;
}

function dateToYmdLocal(d) {
  const yy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yy}-${mm}-${dd}`;
}
function dateToYmdHmLocal(d) {
  const yy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  const hh = String(d.getHours()).padStart(2, "0");
  const mi = String(d.getMinutes()).padStart(2, "0");
  return `${yy}-${mm}-${dd} ${hh}:${mi}`;
}

function nowBangkok() {
  return new Date();
}
function startOfMonth(d) {
  return new Date(d.getFullYear(), d.getMonth(), 1);
}
function addMonths(d, n) {
  return new Date(d.getFullYear(), d.getMonth() + n, 1);
}

function thaiDowIndexFromSubjectDay(day) {
  const map = {
    "อาทิตย์": 0,
    "จันทร์": 1,
    "อังคาร": 2,
    "พุธ": 3,
    "พฤ": 4,
    "พฤหัสบดี": 4,
    "ศุกร์": 5,
    "เสาร์": 6,
  };
  return (day in map) ? map[day] : null;
}

function toIsoBangkokAllDayStart(ymd) {
  return `${ymd}T00:00:00+07:00`;
}
function toIsoBangkokAllDayEnd(ymd) {
  return `${ymd}T23:59:59+07:00`;
}

/* =========================
   State
   ========================= */
const state = {
  token: "",
  idToken: "",
  profile: null,

  subjects: [],
  holidays: [],

  editing: null,
  editingType: "cancel",
  allowDow: null,
  calMonth: startOfMonth(nowBangkok()),
  cancelYmd: null,
};

/* =========================
   API (Worker)
   ========================= */
async function apiFetch(path, opts = {}) {
  const base = API_BASE || location.origin;
  const url = new URL(path, base);

  const headers = new Headers(opts.headers || {});
  if (state.token) headers.set("Authorization", `Bearer ${state.token}`);
  if (!headers.has("Content-Type") && opts.body) headers.set("Content-Type", "application/json");

  const res = await fetch(url.toString(), { ...opts, headers });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = data?.error || data?.message || `HTTP ${res.status}`;

    if (res.status === 401) {
      console.warn("401 from worker:", msg);
      toast(`เซสชันหมดอายุ กำลังพา login ใหม่...`, "err");
      try { liff.logout(); } catch {}
      try { liff.login(); } catch {}
    }

    throw new Error(msg);
  }
  return data;
}

async function fetchSubjects() {
  const data = await apiFetch("/liff/subjects", { method: "GET" });
  return Array.isArray(data.items) ? data.items : [];
}
async function fetchHolidaysRange(fromIso, toIso) {
  const base = API_BASE || location.origin;
  const u = new URL("/liff/holidays/list", base);
  u.searchParams.set("from", fromIso);
  u.searchParams.set("to", toIso);

  const data = await apiFetch(u.pathname + "?" + u.searchParams.toString(), { method: "GET" });
  return Array.isArray(data.items) ? data.items : [];
}
async function fetchReminders(holidayId) {
  const base = API_BASE || location.origin;
  const u = new URL("/liff/holidays/reminders/list", base);
  u.searchParams.set("holiday_id", String(holidayId));

  const data = await apiFetch(u.pathname + "?" + u.searchParams.toString(), { method: "GET" });
  return Array.isArray(data.items) ? data.items : [];
}
async function setReminders(holidayId, reminderIsoList) {
  return apiFetch("/liff/holidays/reminders/set", {
    method: "POST",
    body: JSON.stringify({
      holiday_id: holidayId,
      reminders: reminderIsoList.map((iso) => ({ remind_at: iso })),
    }),
  });
}
async function updateHoliday(payload) {
  return apiFetch("/liff/holidays/update", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}
async function deleteHoliday(id) {
  return apiFetch("/liff/holidays/delete", {
    method: "POST",
    body: JSON.stringify({ id }),
  });
}

/* =========================
   Flatpickr (Reminders)
   ========================= */
function initReminderPicker(inputEl) {
  if (!window.flatpickr) return;
  if (inputEl._fp) return;

  inputEl._fp = flatpickr(inputEl, {
    enableTime: true,
    time_24hr: true,
    minuteIncrement: 5,
    allowInput: true,
    dateFormat: "Y-m-d H:i",
    altInput: true,
    altFormat: "d/m/Y H:i",
  });

  if (inputEl._fp?.altInput) inputEl._fp.altInput.classList.add("input");
}

function addReminderRow(initialIso = null) {
  const wrap = $("#mRemList");
  if (!wrap) return;

  const row = document.createElement("div");
  row.className = "remRow";

  const inp = document.createElement("input");
  inp.className = "input";
  inp.type = "text";

  const del = document.createElement("button");
  del.type = "button";
  del.className = "iconBtn danger";
  del.textContent = "🗑️";
  del.title = "ลบเวลาแจ้งเตือน";

  del.addEventListener("click", () => row.remove());

  row.appendChild(inp);
  row.appendChild(del);
  wrap.appendChild(row);

  initReminderPicker(inp);

  if (initialIso) {
    const ymd = String(initialIso).slice(0, 10);
    const hm = String(initialIso).slice(11, 16);
    inp._fp?.setDate(`${ymd} ${hm}`, true, "Y-m-d H:i");
  } else {
    const dt = new Date(Date.now() + 60 * 60 * 1000);
    dt.setMinutes(Math.round(dt.getMinutes() / 5) * 5);
    dt.setSeconds(0);
    inp._fp?.setDate(dateToYmdHmLocal(dt), true, "Y-m-d H:i");
  }
}

function clearReminderUI() {
  const wrap = $("#mRemList");
  if (wrap) wrap.innerHTML = "";
}

function collectReminderIsoList() {
  const wrap = $("#mRemList");
  if (!wrap) return [];

  const out = [];
  const seen = new Set();

  $$("#mRemList .remRow").forEach((row) => {
    const input = row.querySelector("input");
    if (!input) return;

    const fp = input._fp || input._flatpickr;
    const dateObj = fp?.selectedDates?.[0] || null;
    if (!dateObj) return;

    const ymd = dateToYmdLocal(dateObj);
    const hh = String(dateObj.getHours()).padStart(2, "0");
    const mi = String(dateObj.getMinutes()).padStart(2, "0");
    const iso = `${ymd}T${hh}:${mi}:00+07:00`;

    if (!seen.has(iso)) {
      seen.add(iso);
      out.push(iso);
    }
  });

  out.sort();
  return out;
}

/* =========================
   Calendar for cancel date
   ========================= */
const THAI_DOW = ["อาทิตย์", "จันทร์", "อังคาร", "พุธ", "พฤ", "ศุกร์", "เสาร์"];

function renderCalendar() {
  const grid = $("#calGrid");
  const title = $("#calTitle");
  if (!grid || !title) return;

  const m = state.calMonth;
  const y = m.getFullYear();
  const mo = m.getMonth();

  title.textContent = `${m.toLocaleString("en-US", { month: "long" })} ${y}`;
  grid.innerHTML = "";

  for (const d of ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"]) {
    const h = document.createElement("div");
    h.className = "calDow";
    h.textContent = d;
    grid.appendChild(h);
  }

  const first = new Date(y, mo, 1);
  const startDow = first.getDay();
  const daysInMonth = new Date(y, mo + 1, 0).getDate();

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const prevDays = startDow;
  const prevMonthDays = new Date(y, mo, 0).getDate();

  const cells = [];
  for (let i = 0; i < prevDays; i++) {
    const dayNum = prevMonthDays - prevDays + 1 + i;
    cells.push({ date: new Date(y, mo - 1, dayNum), other: true });
  }
  for (let i = 1; i <= daysInMonth; i++) {
    cells.push({ date: new Date(y, mo, i), other: false });
  }
  while (cells.length < 42) {
    const last = cells[cells.length - 1].date;
    cells.push({ date: new Date(last.getFullYear(), last.getMonth(), last.getDate() + 1), other: true });
  }

  const allowDow = state.allowDow;

  cells.forEach(({ date, other }) => {
    const btn = document.createElement("div");
    btn.className = "calDay";
    btn.textContent = String(date.getDate());
    if (other) btn.classList.add("isOtherMonth");

    const d0 = new Date(date.getFullYear(), date.getMonth(), date.getDate());
    const isPast = d0.getTime() < today.getTime();

    const dow = date.getDay();
    const notMatch = (allowDow === null) ? true : (dow !== allowDow);
    const disabled = isPast || notMatch;

    if (disabled) btn.classList.add("isDisabled");

    const ymd = dateToYmdLocal(d0);
    if (state.cancelYmd && ymd === state.cancelYmd) btn.classList.add("isSelected");

    btn.addEventListener("click", () => {
      if (disabled) return;
      state.cancelYmd = ymd;
      $("#mCancelHint").textContent = `เลือก: ${ymdToThai(ymd)} (${THAI_DOW[dow]})`;
      renderCalendar();
    });

    grid.appendChild(btn);
  });
}

function autoSelectNextValidCancelDate() {
  if (state.allowDow === null) return;
  const base = new Date(); base.setHours(0, 0, 0, 0);

  for (let i = 0; i < 90; i++) {
    const d = new Date(base.getFullYear(), base.getMonth(), base.getDate() + i);
    if (d.getDay() === state.allowDow) {
      state.cancelYmd = dateToYmdLocal(d);
      $("#mCancelHint").textContent = `เลือก: ${ymdToThai(state.cancelYmd)} (${THAI_DOW[state.allowDow]})`;
      return;
    }
  }
}

/* =========================
   UI: List
   ========================= */
function typeBadge(type) {
  if (type === "cancel") return `<span class="badge cancel">🚫 ยกคลาส</span>`;
  return `<span class="badge holiday">🏝️ หยุดทั้งวัน</span>`;
}

function itemTitle(row) {
  const t = (row.title || "").trim();
  if (t) return t;
  return row.type === "cancel" ? "(ยกคลาส)" : "(หยุดทั้งวัน)";
}

function itemSub(row) {
  const s = row.start_at ? isoToThaiDateTime(row.start_at) : "-";
  const e = row.end_at ? isoToThaiDateTime(row.end_at) : "-";
  if (row.type === "cancel") return `วัน: ${s}`;
  if (s === e) return `วัน: ${s}`;
  return `ช่วง: ${s} → ${e}`;
}

function renderList() {
  const el = $("#list");
  const hint = $("#listHint");
  if (!el) return;

  if (!state.holidays.length) {
    hint.textContent = "ไม่พบรายการในช่วงนี้";
    el.innerHTML = `<div class="empty">ไม่มีรายการวันหยุด/ยกคลาสในช่วงนี้</div>`;
    return;
  }

  hint.textContent = `พบ ${state.holidays.length} รายการ`;

  el.innerHTML = state.holidays.map((row) => `
    <div class="item">
      <div class="itemMain">
        <div class="itemTitle">${itemTitle(row)}</div>
        <div class="itemSub">${typeBadge(row.type)} <span class="sep">•</span> ${itemSub(row)}</div>
      </div>
      <div class="itemActions">
        <button class="iconBtn" data-act="edit" data-id="${row.id}" type="button" title="แก้ไข">✏️</button>
        <button class="iconBtn danger" data-act="del" data-id="${row.id}" type="button" title="ลบ">🗑️</button>
      </div>
    </div>
  `).join("");

  el.querySelectorAll("[data-act]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const act = btn.getAttribute("data-act");
      const id = Number(btn.getAttribute("data-id"));
      const row = state.holidays.find((x) => Number(x.id) === id);
      if (!row) return;

      if (act === "del") {
        if (!confirm("ยืนยันลบรายการนี้?")) return;
        try {
          await deleteHoliday(id);
          toast("ลบแล้ว ✅");
          await loadList();
        } catch (e) {
          toast(`ลบไม่สำเร็จ: ${e.message}`, "err");
        }
      } else if (act === "edit") {
        openModal(row);
      }
    });
  });
}

/* =========================
   Modal Edit
   ========================= */
function openModal(row) {
  state.editing = row;
  state.editingType = row.type || "cancel";

  $("#mSub").textContent = `#${row.id} • ${row.type}`;
  $("#mType").value = state.editingType;

  $("#mTitleInput").value = row.title || "";
  $("#mNote").value = row.note || "";

  $("#cancelBox").hidden = true;
  $("#holidayBox").hidden = true;

  clearReminderUI();

  $("#mType").onchange = () => {
    state.editingType = $("#mType").value;
    applyTypeUI();
  };

  $("#mAddRem").onclick = () => addReminderRow(null);

  $("#mDelete").onclick = async () => {
    if (!confirm("ยืนยันลบรายการนี้?")) return;
    try {
      await deleteHoliday(Number(state.editing.id));
      toast("ลบแล้ว ✅");
      closeModal();
      await loadList();
    } catch (e) {
      toast(`ลบไม่สำเร็จ: ${e.message}`, "err");
    }
  };

  $("#mCloseX").onclick = closeModal;
  $("#mCloseBtn").onclick = closeModal;
  $("#mBackdrop").onclick = closeModal;
  $("#mCancelBtn").onclick = () => {
    closeModal();
    toast("ยกเลิกการแก้ไขแล้ว", "ok");
  };

  $("#mSaveBtn").onclick = saveModal;

  applyTypeUI();

  (async () => {
    try {
      const items = await fetchReminders(row.id);
      if (items.length) items.forEach((r) => addReminderRow(r.remind_at));
    } catch (e) {
      console.warn("fetchReminders failed:", e);
    }
  })();

  $("#modal").hidden = false;
}

function closeModal() {
  $("#modal").hidden = true;
  state.editing = null;
}

function applyTypeUI() {
  const t = state.editingType;

  if (t === "cancel") {
    $("#cancelBox").hidden = false;
    $("#holidayBox").hidden = true;

    const sel = $("#mSubject");
    sel.innerHTML = state.subjects.map((s) => `
      <option value="${s.subject_code}">${s.subject_code} • ${s.subject_name} (${s.day} ${s.start_time}-${s.end_time})</option>
    `).join("");

    const currentSubject = state.editing?.subject_id || "";
    if (currentSubject) sel.value = currentSubject;

    const picked = state.subjects.find((x) => x.subject_code === sel.value) || null;
    state.allowDow = picked ? thaiDowIndexFromSubjectDay(picked.day) : null;

    $("#mSubjectHint").textContent = picked
      ? `วันเรียน: ${picked.day} • เวลา: ${picked.start_time}-${picked.end_time} • ห้อง: ${picked.room}`
      : "";

    sel.onchange = () => {
      const p = state.subjects.find((x) => x.subject_code === sel.value) || null;
      state.allowDow = p ? thaiDowIndexFromSubjectDay(p.day) : null;
      $("#mSubjectHint").textContent = p
        ? `วันเรียน: ${p.day} • เวลา: ${p.start_time}-${p.end_time} • ห้อง: ${p.room}`
        : "";
      autoSelectNextValidCancelDate();
      renderCalendar();
    };

    state.calMonth = startOfMonth(nowBangkok());
    state.cancelYmd = (state.editing?.start_at ? String(state.editing.start_at).slice(0, 10) : null);
    if (!state.cancelYmd) autoSelectNextValidCancelDate();

    $("#mCancelHint").textContent = state.cancelYmd ? `เลือก: ${ymdToThai(state.cancelYmd)}` : "ยังไม่ได้เลือกวันที่";
    renderCalendar();
  } else {
    $("#cancelBox").hidden = true;
    $("#holidayBox").hidden = false;

    const s = state.editing?.start_at ? String(state.editing.start_at).slice(0, 10) : "";
    const e = state.editing?.end_at ? String(state.editing.end_at).slice(0, 10) : "";

    $("#mStart").value = s;
    $("#mEnd").value = e;

    if (window.flatpickr) {
      flatpickr("#mStart", { dateFormat: "Y-m-d", altInput: true, altFormat: "d/m/Y", allowInput: true });
      flatpickr("#mEnd", { dateFormat: "Y-m-d", altInput: true, altFormat: "d/m/Y", allowInput: true });
    }
  }
}

async function saveModal() {
  if (!state.editing) return;
  $("#mSaveBtn").disabled = true;

  try {
    const id = Number(state.editing.id);
    const type = state.editingType;

    const title = ($("#mTitleInput").value || "").trim();
    const note = ($("#mNote").value || "").trim();

    let payload = { id, type, title, note };

    if (type === "cancel") {
      const subject_id = $("#mSubject").value;
      const ymd = state.cancelYmd;
      if (!subject_id) throw new Error("กรุณาเลือกวิชา");
      if (!ymd) throw new Error("กรุณาเลือกวันที่ยกคลาส");

      payload.subject_id = subject_id;
      payload.all_day = 0;
      payload.start_at = toIsoBangkokAllDayStart(ymd);
      payload.end_at = toIsoBangkokAllDayEnd(ymd);
    } else {
      const startYmd = ($("#mStart").value || "").trim();
      const endYmd = ($("#mEnd").value || "").trim() || startYmd;
      if (!startYmd) throw new Error("กรุณาเลือกวันที่เริ่ม");

      payload.subject_id = null;
      payload.all_day = 1;
      payload.start_at = toIsoBangkokAllDayStart(startYmd);
      payload.end_at = toIsoBangkokAllDayEnd(endYmd);
    }

    await updateHoliday(payload);

    const reminderIsoList = collectReminderIsoList();
    await setReminders(id, reminderIsoList);

    toast("บันทึกแล้ว ✅");
    closeModal();
    await loadList();
  } catch (e) {
    toast(`บันทึกไม่สำเร็จ: ${e.message}`, "err");
  } finally {
    $("#mSaveBtn").disabled = false;
  }
}

/* =========================
   ✅ NEW: Top toolbar actions
   ========================= */
function isModalOpen() {
  const m = $("#modal");
  return m && !m.hidden;
}

/* ✅ “ทิ้งการแก้ไข” = ปิดโมดัล + reload list ให้กลับตาม DB */
async function discardEditsAll() {
  try {
    if (isModalOpen()) closeModal();
    toast("ทิ้งการแก้ไขแล้ว ↩️", "ok");
    await loadList();
  } catch (e) {
    toast(`ทำรายการไม่สำเร็จ: ${e.message}`, "err");
  }
}

/* ✅ “บันทึกทั้งหมด” = ถ้าโมดัลเปิดอยู่ให้ saveModal เดิมเลย / ถ้าไม่เปิดก็แค่รีโหลด */
async function saveAll() {
  try {
    if (isModalOpen()) {
      await saveModal(); // ใช้ฟังก์ชันเดิม ไม่รื้อ
      return;
    }
    toast("บันทึกครบแล้ว ✅", "ok");
    await loadList();
  } catch (e) {
    toast(`บันทึกไม่สำเร็จ: ${e.message}`, "err");
  }
}

/* =========================
   Load & Init
   ========================= */
async function loadList() {
  $("#status").textContent = "";
  $("#listHint").textContent = "กำลังโหลด...";

  const now = nowBangkok();
  const from = new Date(now.getFullYear(), now.getMonth() - 2, 1);
  const to = new Date(now.getFullYear(), now.getMonth() + 3, 0);

  const fromIso = toIsoBangkokAllDayStart(dateToYmdLocal(from));
  const toIso = toIsoBangkokAllDayEnd(dateToYmdLocal(to));

  try {
    state.holidays = await fetchHolidaysRange(fromIso, toIso);
    renderList();
  } catch (e) {
    $("#listHint").textContent = "โหลดไม่สำเร็จ";
    $("#list").innerHTML = `<div class="empty">Error: ${e.message}</div>`;
  }
}

async function init() {
  try {
    if (!window.liff) throw new Error("LIFF SDK not loaded");
    if (!LIFF_ID) throw new Error('liffId is necessary for liff.init()');

    if (!API_BASE) {
      toast("ยังไม่ได้ตั้งค่า API_BASE (window.__API_BASE__) ❗", "err");
      console.warn("Missing API_BASE.");
    }

    await liff.init({ liffId: LIFF_ID, withLoginOnExternalBrowser: true });

    if (!liff.isLoggedIn()) {
      liff.login();
      return;
    }

    state.token = liff.getAccessToken() || "";
    state.idToken = liff.getIDToken() || "";

    if (!state.token) {
      toast("ไม่พบ Access Token ❗ (ลองปิดแล้วเปิด LIFF ใหม่)", "err");
      console.warn("Missing access token.");
    }

    try {
      state.profile = await liff.getProfile();
      $("#userPill").textContent = state.profile?.displayName || "LINE User";
    } catch {
      $("#userPill").textContent = "LINE User";
    }

    state.subjects = await fetchSubjects();

    $("#calPrev").onclick = () => { state.calMonth = addMonths(state.calMonth, -1); renderCalendar(); };
    $("#calNext").onclick = () => { state.calMonth = addMonths(state.calMonth, +1); renderCalendar(); };

    $("#reloadBtn").onclick = () => loadList();

    // ✅ เปลี่ยนจาก toast โหมดไม่เปิดใช้งาน -> ให้ทำงานจริง
    $("#editAllBtn").onclick = discardEditsAll;
    $("#saveAllBtn").onclick = saveAll;

    await loadList();
  } catch (e) {
    toast(`เริ่มระบบไม่สำเร็จ: ${e.message}`, "err");
    console.error(e);
  }
}

document.addEventListener("DOMContentLoaded", init);