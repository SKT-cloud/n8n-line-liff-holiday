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

// ✅ ส่ง "บันทึกทั้งหมด" เข้า n8n เพื่อยืนยันก่อนค่อยเขียน DB
const N8N_WEBHOOK_FROM_WINDOW = (typeof window !== "undefined" && window.__N8N_WEBHOOK__)
  ? String(window.__N8N_WEBHOOK__).trim()
  : "";
const N8N_WEBHOOK_FROM_QS = new URLSearchParams(location.search).get("n8n") || "";
const N8N_WEBHOOK = (N8N_WEBHOOK_FROM_WINDOW || N8N_WEBHOOK_FROM_QS || "").trim();

// (optional) ถ้าอยากให้ n8n ตรวจ key
const N8N_API_KEY_FROM_WINDOW = (typeof window !== "undefined" && window.__N8N_API_KEY__)
  ? String(window.__N8N_API_KEY__).trim()
  : "";
const N8N_API_KEY = (N8N_API_KEY_FROM_WINDOW || "").trim();

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
  if (!t) return;
  t.textContent = msg;
  t.className = `toast ${type === "err" ? "err" : "ok"}`;
  t.hidden = false;
  clearTimeout(toast._tm);
  toast._tm = setTimeout(() => (t.hidden = true), 3200);
}

/* ✅ Overlay (สวย ๆ กลางจอ) */
function showOverlay(kind, title, desc) {
  const ov = $("#overlay");
  if (!ov) return;
  const icon = $("#overlayIcon");
  const t = $("#overlayTitle");
  const d = $("#overlayDesc");

  if (icon) icon.className = `overlayIcon ${kind || "loading"}`;
  if (t) t.textContent = title || "กำลังทำรายการ…";
  if (d) d.textContent = desc || "รอสักครู่น้า ✨";

  ov.classList.remove("closing");
  ov.hidden = false;
}
function hideOverlay() {
  const ov = $("#overlay");
  if (!ov || ov.hidden) return;

  // ✅ fade out (ถ้า CSS รองรับ .closing)
  ov.classList.add("closing");
  clearTimeout(hideOverlay._t);
  hideOverlay._t = setTimeout(() => {
    ov.hidden = true;
    ov.classList.remove("closing");
  }, 260);
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
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

  // ✅ original from worker (DB state)
  originalHolidays: [],

  // ✅ view list = original + drafts (for UI)
  holidays: [],

  // ✅ drafts: id -> { holiday: payload, reminders: [iso], pendingDelete: boolean }
  drafts: new Map(),

  // ✅ pending delete list
  pendingDeletes: new Set(),

  editing: null,
  editingType: "cancel",
  allowDow: null,
  calMonth: startOfMonth(nowBangkok()),
  cancelYmd: null,
};

/* =========================
   API (Worker) — ใช้ตอน "โหลด" เท่านั้น
   (ตอน commit จริงจะส่งไป n8n)
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

/* =========================
   API (n8n) — ใช้ตอน "บันทึกทั้งหมด"
   ========================= */
async function postToN8n(body) {
  if (!N8N_WEBHOOK) throw new Error("ยังไม่ได้ตั้งค่า N8N_WEBHOOK (window.__N8N_WEBHOOK__)");

  const headers = new Headers({ "Content-Type": "application/json" });
  if (N8N_API_KEY) headers.set("x-api-key", N8N_API_KEY);

  // ส่งข้อมูล user ไปช่วย debug/route ใน n8n
  if (state.profile?.userId) headers.set("x-line-userid", String(state.profile.userId));

  const res = await fetch(N8N_WEBHOOK, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = data?.error || data?.message || `HTTP ${res.status}`;
    throw new Error(msg);
  }
  return data;
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
   Draft helpers
   ========================= */
function getDraftCount() {
  return state.drafts.size + state.pendingDeletes.size;
}

function rebuildViewList() {
  const merged = [];
  for (const row of state.originalHolidays) {
    const id = Number(row.id);
    const isDel = state.pendingDeletes.has(id);
    const d = state.drafts.get(id);

    const view = { ...row };

    if (d?.holiday) Object.assign(view, d.holiday);
    view._draft = !!d;
    view._pendingDelete = isDel;

    merged.push(view);
  }

  // แสดงรายการที่ถูก mark ลบเป็นลำดับท้าย (ดูชัด)
  merged.sort((a, b) => Number(!!a._pendingDelete) - Number(!!b._pendingDelete));
  state.holidays = merged;
}

/* =========================
   UI: List
   ========================= */
function typeBadge(type) {
  if (type === "cancel") return `<span class="badge cancel">🚫 ยกคลาส</span>`;
  return `<span class="badge holiday">🏝️ หยุดทั้งวัน</span>`;
}

function draftBadge(row) {
  if (row._pendingDelete) return `<span class="badge pendingDel">🗑️ รอลบ</span>`;
  if (row._draft) return `<span class="badge draft">✏️ แก้ไขแล้ว</span>`;
  return "";
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
  if (!el || !hint) return;

  const draftN = getDraftCount();

  if (!state.holidays.length) {
    hint.textContent = "ไม่พบรายการในช่วงนี้";
    el.innerHTML = `<div class="empty">ไม่มีรายการวันหยุด/ยกคลาสในช่วงนี้</div>`;
    return;
  }

  hint.textContent = draftN
    ? `พบ ${state.holidays.length} รายการ • มีร่างแก้ไข ${draftN} รายการ`
    : `พบ ${state.holidays.length} รายการ`;

  el.innerHTML = state.holidays.map((row) => `
    <div class="item ${row._pendingDelete ? "isPendingDel" : ""}">
      <div class="itemMain">
        <div class="itemTitle">${itemTitle(row)}</div>
        <div class="itemSub">
          ${typeBadge(row.type)}
          <span class="sep">•</span>
          ${itemSub(row)}
          ${draftBadge(row) ? `<span class="sep">•</span>${draftBadge(row)}` : ""}
        </div>
      </div>
      <div class="itemActions">
        <button class="iconBtn" data-act="edit" data-id="${row.id}" type="button" title="แก้ไข" ${row._pendingDelete ? "disabled" : ""}>✏️</button>
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
        // ✅ ลบ = stage ไว้ก่อน (ไม่ยิง DB)
        if (!confirm("ต้องการ “ทำเครื่องหมายลบ” รายการนี้ไว้ก่อนใช่ไหม?\n(จะลบจริงตอนกด “บันทึกทั้งหมด”)")) return;
        stageDelete(id);
        toast("ทำเครื่องหมายรอลบแล้ว 🗑️ (ยังไม่ลบจริง)", "ok");
        rebuildViewList();
        renderList();
      } else if (act === "edit") {
        openModal(row);
      }
    });
  });
}

function stageDelete(id) {
  state.pendingDeletes.add(Number(id));
  state.drafts.delete(Number(id)); // ถ้ากำลังมี draft อยู่ ให้ลบทิ้ง (เพราะจะลบทั้งรายการ)
}

/* =========================
   Modal Edit
   ========================= */
function openModal(row) {
  const id = Number(row.id);
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

  // ✅ ลบใน modal = stage delete เหมือนกัน
  $("#mDelete").onclick = () => {
    if (!confirm("ต้องการ “ทำเครื่องหมายลบ” รายการนี้ไว้ก่อนใช่ไหม?\n(จะลบจริงตอนกด “บันทึกทั้งหมด”)")) return;
    stageDelete(id);
    toast("ทำเครื่องหมายรอลบแล้ว 🗑️", "ok");
    closeModal();
    rebuildViewList();
    renderList();
  };

  $("#mCloseX").onclick = closeModal;
  $("#mCloseBtn").onclick = closeModal;
  $("#mBackdrop").onclick = closeModal;
  $("#mCancelBtn").onclick = () => {
    closeModal();
    toast("ยกเลิกการแก้ไขแล้ว", "ok");
  };

  $("#mSaveBtn").onclick = saveModalAsDraft;

  applyTypeUI();

  // ✅ Reminders: ถ้ามี draft แล้วใช้ draft / ถ้าไม่มีก็ค่อย fetch จาก worker
  (async () => {
    try {
      const d = state.drafts.get(id);
      if (d?.reminders) {
        d.reminders.forEach((iso) => addReminderRow(iso));
        return;
      }
      const items = await fetchReminders(id);
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

/* ✅ แทน save จริง: เก็บ draft ในเครื่อง */
async function saveModalAsDraft() {
  if (!state.editing) return;
  $("#mSaveBtn").disabled = true;

  try {
    const id = Number(state.editing.id);
    const type = state.editingType;

    const title = ($("#mTitleInput").value || "").trim();
    const note = ($("#mNote").value || "").trim();

    // UX guard: กันยาวเกิน (ปรับได้ตามใจ)
    if (title.length > 80) throw new Error("หัวข้อยาวเกินไป (ไม่เกิน 80 ตัวอักษรนะคะ)");
    if (note.length > 500) throw new Error("หมายเหตุยาวเกินไป (ไม่เกิน 500 ตัวอักษรนะคะ)");

    const payload = { id, type, title, note };

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

    const reminderIsoList = collectReminderIsoList();

    // กันซ้ำ (collect ทำแล้ว) + กันไม่ครบ (ไม่มี dateObj จะไม่ถูก collect)
    state.pendingDeletes.delete(id); // ถ้าเคย mark ลบไว้ แล้วมาแก้ใหม่ = ยกเลิกรอลบ

    state.drafts.set(id, {
      holiday: payload,
      reminders: reminderIsoList,
    });

    toast("เก็บเป็น “ฉบับร่าง” แล้ว ✨ (ยังไม่บันทึกจริง)", "ok");
    closeModal();
    rebuildViewList();
    renderList();
  } catch (e) {
    toast(`บันทึกไม่สำเร็จ: ${e.message}`, "err");
  } finally {
    $("#mSaveBtn").disabled = false;
  }
}

/* =========================
   Top toolbar actions
   ========================= */
function isModalOpen() {
  const m = $("#modal");
  return m && !m.hidden;
}

/* ✅ “ทิ้งการแก้ไข” = เคลียร์ draft ทั้งหมด กลับสู่ค่าจริง */
async function discardEditsAll() {
  try {
    if (isModalOpen()) closeModal();
    state.drafts.clear();
    state.pendingDeletes.clear();
    rebuildViewList();
    renderList();
    toast("ทิ้งการเปลี่ยนแปลงทั้งหมดแล้ว ↩️", "ok");
  } catch (e) {
    toast(`ทำรายการไม่สำเร็จ: ${e.message}`, "err");
  }
}

/* ✅ “บันทึกทั้งหมด” = ส่ง draft เข้า n8n ให้ยืนยันก่อน */
async function saveAll() {
  try {
    if (isModalOpen()) closeModal();

    const upserts = [];
    for (const [id, d] of state.drafts.entries()) {
      upserts.push({
        id: Number(id),
        holiday: d.holiday,
        reminders: Array.isArray(d.reminders) ? d.reminders : [],
      });
    }

    const deletes = Array.from(state.pendingDeletes.values()).map((x) => Number(x));

    if (!upserts.length && !deletes.length) {
      toast("ยังไม่มีอะไรให้บันทึกนะคะ 😊", "ok");
      return;
    }

    showOverlay("loading", "กำลังส่งไปยืนยัน…", "แป๊บน้า เดี๋ยวบันทึกให้แบบชัวร์ ๆ ✨");

    const body = {
      action: "holiday_edit_commit",
      meta: {
        userId: state.profile?.userId || null,
        displayName: state.profile?.displayName || null,
        ts: new Date().toISOString(),
      },
      payload: { upserts, deletes },
    };

    const res = await postToN8n(body);

    if (!res || res.ok !== true) {
      const msg = res?.error || "n8n ตอบกลับไม่สำเร็จ";
      throw new Error(msg);
    }

    showOverlay("ok", "บันทึกเรียบร้อยแล้วค่ะ 💖", "ขอบคุณที่อัปเดตนะคะ เดี๋ยวปิดหน้านี้ให้เลย ✨");
    await sleep(850);

    // เคลียร์ draft แล้วรีโหลด (กันสถานะค้าง)
    state.drafts.clear();
    state.pendingDeletes.clear();

    try { await loadList(); } catch {}
    await sleep(350);

    try { liff.closeWindow(); } catch {}
  } catch (e) {
    showOverlay("err", "ยังบันทึกไม่ได้ 🥺", e.message || "ลองใหม่อีกครั้งนะคะ");
    await sleep(1200);
    hideOverlay();
    toast(`บันทึกไม่สำเร็จ: ${e.message}`, "err");
  }
}

/* =========================
   Load & Init
   ========================= */
async function loadList() {
  $("#status").textContent = "";
  $("#listHint").textContent = "กำลังโหลด...";

  showOverlay("loading", "กำลังโหลดรายการ…", "กำลังดึงข้อมูลล่าสุดให้น้า ✨");

  const now = nowBangkok();
  const from = new Date(now.getFullYear(), now.getMonth() - 2, 1);
  const to = new Date(now.getFullYear(), now.getMonth() + 3, 0);

  const fromIso = toIsoBangkokAllDayStart(dateToYmdLocal(from));
  const toIso = toIsoBangkokAllDayEnd(dateToYmdLocal(to));

  try {
    state.originalHolidays = await fetchHolidaysRange(fromIso, toIso);
    rebuildViewList();
    renderList();
    hideOverlay();
  } catch (e) {
    hideOverlay();
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

    showOverlay("loading", "กำลังเริ่มระบบ…", "กำลังเชื่อมต่อ LINE และโหลดข้อมูล ✨");

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

    $("#editAllBtn").onclick = discardEditsAll;
    $("#saveAllBtn").onclick = saveAll;

    await loadList();
    hideOverlay();
  } catch (e) {
    hideOverlay();
    toast(`เริ่มระบบไม่สำเร็จ: ${e.message}`, "err");
    console.error(e);
  }
}

document.addEventListener("DOMContentLoaded", init);
