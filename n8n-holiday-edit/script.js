/* =========================================================
   StudyBot LIFF: แก้ไข / ลบวันหยุด (Edit Page)
   - ใช้ worker endpoints: /liff/subjects, /liff/holidays/list, /update, /delete,
                           /liff/holidays/reminders/list, /liff/holidays/reminders/set
   - Flatpickr 24h (ไม่มี AM/PM)
   - Cancel (ยกคลาส): เลือกวิชา + ปฏิทินบังคับวันตรงกับวันเรียน
   - Holiday (หยุดทั้งวัน): วันที่เริ่ม/สิ้นสุด
========================================================= */

"use strict";

/* =========================
   Config
   ========================= */

// ✅ ต้องมี liffId สำหรับ liff.init()
// - ใส่ใน index.html: window.__LIFF_ID__ = "200xxxxxxxxx-xxxxxxxx"
// - หรือส่งผ่าน querystring: ?liffId=200...
const LIFF_ID_FROM_WINDOW = (typeof window !== "undefined" && window.__LIFF_ID__)
  ? String(window.__LIFF_ID__).trim()
  : "";
const LIFF_ID_FROM_QS = new URLSearchParams(location.search).get("liffId") || "";
const LIFF_ID = LIFF_ID_FROM_WINDOW || LIFF_ID_FROM_QS;

// ตั้งค่า Worker base (ถ้าใช้โดเมนเดียวกัน ปล่อยว่างได้)
const API_BASE = ""; // เช่น "https://your-worker.your-domain.workers.dev"

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
  // ใช้เวลาท้องถิ่นของเครื่องผู้ใช้ (ซึ่งคุณอยู่ไทย) + รูปแบบเพียงพอสำหรับ UI
  return new Date();
}

function startOfMonth(d) {
  return new Date(d.getFullYear(), d.getMonth(), 1);
}
function addMonths(d, n) {
  return new Date(d.getFullYear(), d.getMonth() + n, 1);
}

function thaiDowIndexFromSubjectDay(day) {
  // day ใน subjects: "จันทร์","อังคาร","พุธ","พฤ","พฤหัสบดี","ศุกร์","เสาร์","อาทิตย์"
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
  // yyyy-mm-ddT00:00:00+07:00
  return `${ymd}T00:00:00+07:00`;
}
function toIsoBangkokAllDayEnd(ymd) {
  // yyyy-mm-ddT23:59:59+07:00
  return `${ymd}T23:59:59+07:00`;
}

/* =========================
   API (Worker)
   ========================= */

async function apiFetch(path, opts = {}) {
  const url = new URL(path, API_BASE || location.origin);

  const headers = new Headers(opts.headers || {});
  if (state.idToken) headers.set("Authorization", `Bearer ${state.idToken}`);
  if (!headers.has("Content-Type") && opts.body) headers.set("Content-Type", "application/json");

  const res = await fetch(url.toString(), {
    ...opts,
    headers,
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = data?.error || data?.message || `HTTP ${res.status}`;
    throw new Error(msg);
  }
  return data;
}

async function fetchSubjects() {
  const data = await apiFetch("/liff/subjects", { method: "GET" });
  return Array.isArray(data.items) ? data.items : [];
}

async function fetchHolidaysRange(fromIso, toIso) {
  const u = new URL("/liff/holidays/list", API_BASE || location.origin);
  u.searchParams.set("from", fromIso);
  u.searchParams.set("to", toIso);
  const data = await apiFetch(u.pathname + "?" + u.searchParams.toString(), { method: "GET" });
  return Array.isArray(data.items) ? data.items : [];
}

async function fetchReminders(holidayId) {
  const u = new URL("/liff/holidays/reminders/list", API_BASE || location.origin);
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
   State
   ========================= */
const state = {
  idToken: "",
  profile: null,

  subjects: [],
  holidays: [],

  // modal
  editing: null,        // current holiday row
  editingType: "cancel",
  allowDow: null,       // 0..6 for cancel, from subject day
  calMonth: startOfMonth(nowBangkok()),
  cancelYmd: null,      // selected cancel date YYYY-MM-DD
};

/* =========================
   Flatpickr (Reminders)
   ========================= */

function initReminderPicker(inputEl) {
  if (!window.flatpickr) return;
  if (inputEl._fp) return;

  inputEl._fp = flatpickr(inputEl, {
    enableTime: true,
    time_24hr: true,          // ✅ ไม่มี AM/PM
    minuteIncrement: 5,
    allowInput: true,
    dateFormat: "Y-m-d H:i",
    altInput: true,
    altFormat: "d/m/Y H:i",
  });

  // ให้ altInput ใช้ theme เดียวกับ .input
  if (inputEl._fp?.altInput) {
    inputEl._fp.altInput.classList.add("input");
  }
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

  del.addEventListener("click", () => {
    row.remove();
  });

  // ✅ append เข้า DOM ก่อนค่อย init flatpickr
  row.appendChild(inp);
  row.appendChild(del);
  wrap.appendChild(row);

  initReminderPicker(inp);

  if (initialIso) {
    const ymd = String(initialIso).slice(0, 10);
    const hm = String(initialIso).slice(11, 16);
    const v = `${ymd} ${hm}`;
    inp._fp?.setDate(v, true, "Y-m-d H:i");
  } else {
    // default = now + 1 hour
    const dt = new Date(Date.now() + 60 * 60 * 1000);
    dt.setMinutes(Math.round(dt.getMinutes() / 5) * 5);
    dt.setSeconds(0);
    const defaultValue = dateToYmdHmLocal(dt);
    inp._fp?.setDate(defaultValue, true, "Y-m-d H:i");
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

    // flatpickr instance on original input
    const fp = input._fp || input._flatpickr;
    let dateObj = fp?.selectedDates?.[0] || null;

    // fallback: parse from input value (Y-m-d H:i)
    if (!dateObj) {
      const raw = (input.value || "").trim();
      const m = raw.match(/^(\d{4}-\d{2}-\d{2})\s+(\d{2}:\d{2})$/);
      if (m) dateObj = new Date(`${m[1]}T${m[2]}:00`);
    }
    if (!dateObj) return;

    // ทำเป็น ISO +07:00
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

  // header DOW
  for (const d of ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"]) {
    const h = document.createElement("div");
    h.className = "calDow";
    h.textContent = d;
    grid.appendChild(h);
  }

  const first = new Date(y, mo, 1);
  const startDow = first.getDay(); // 0..6
  const daysInMonth = new Date(y, mo + 1, 0).getDate();

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  // previous month padding
  const prevDays = startDow;
  const prevMonthDays = new Date(y, mo, 0).getDate();

  const cells = [];

  for (let i = 0; i < prevDays; i++) {
    const dayNum = prevMonthDays - prevDays + 1 + i;
    const d = new Date(y, mo - 1, dayNum);
    cells.push({ date: d, other: true });
  }
  for (let i = 1; i <= daysInMonth; i++) {
    const d = new Date(y, mo, i);
    cells.push({ date: d, other: false });
  }
  // next month padding to fill grid (6 rows * 7 = 42) after header
  while (cells.length < 42) {
    const last = cells[cells.length - 1].date;
    const d = new Date(last.getFullYear(), last.getMonth(), last.getDate() + 1);
    cells.push({ date: d, other: true });
  }

  const allowDow = state.allowDow; // null means not ready

  cells.forEach(({ date, other }) => {
    const btn = document.createElement("div");
    btn.className = "calDay";
    btn.textContent = String(date.getDate());

    if (other) btn.classList.add("isOtherMonth");

    // disable past
    const d0 = new Date(date.getFullYear(), date.getMonth(), date.getDate());
    const isPast = d0.getTime() < today.getTime();

    // enforce dow for cancel
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

  const base = new Date();
  base.setHours(0, 0, 0, 0);

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
  return row.type === "cancel" ? "ยกคลาส" : "วันหยุด";
}

function itemDateText(row) {
  const s = String(row.start_at || "").slice(0, 10);
  const e = String(row.end_at || "").slice(0, 10);
  if (!s) return "-";
  if (e && e !== s) return `${ymdToThai(s)} – ${ymdToThai(e)}`;
  return ymdToThai(s);
}

function renderList() {
  const list = $("#list");
  const hint = $("#listHint");
  if (!list || !hint) return;

  if (!state.holidays.length) {
    hint.textContent = "ไม่พบรายการในช่วงนี้";
    list.innerHTML = `<div class="empty">ยังไม่มีวันหยุด/ยกคลาสในช่วงที่เลือก</div>`;
    return;
  }

  hint.textContent = `พบ ${state.holidays.length} รายการ`;
  list.innerHTML = "";

  state.holidays.forEach((row) => {
    const div = document.createElement("div");
    div.className = "item";

    div.innerHTML = `
      <div class="itemTop">
        <div>
          <div class="itemTitle">${itemTitle(row)}</div>
          <div class="itemMeta">#${row.id} • ${itemDateText(row)}</div>
          <div class="badges">${typeBadge(row.type)}</div>
        </div>
        <div class="itemBtns">
          <button class="iconBtn" data-act="edit" title="แก้ไข">✏️</button>
          <button class="iconBtn danger" data-act="del" title="ลบ">🗑️</button>
        </div>
      </div>
    `;

    div.querySelector('[data-act="edit"]').addEventListener("click", () => openEdit(row));
    div.querySelector('[data-act="del"]').addEventListener("click", async () => {
      if (!confirm(`ลบรายการ #${row.id} ใช่ไหม?`)) return;
      try {
        await deleteHoliday(row.id);
        toast("ลบรายการเรียบร้อย ✅");
        await loadList();
      } catch (e) {
        toast(`ลบไม่สำเร็จ: ${e.message}`, "err");
      }
    });

    list.appendChild(div);
  });
}

/* =========================
   Modal (Edit)
   ========================= */

function openModal(show) {
  const m = $("#modal");
  if (!m) return;
  m.hidden = !show;
}

function setTypeUI(type) {
  state.editingType = type;

  const cancelBox = $("#cancelBox");
  const holidayBox = $("#holidayBox");
  if (cancelBox) cancelBox.hidden = (type !== "cancel");
  if (holidayBox) holidayBox.hidden = (type !== "holiday");

  if (type === "cancel") {
    // ปรับปฏิทินใหม่ตามวิชา
    renderCalendar();
  }
}

function fillSubjectSelect(selectedSubjectId) {
  const sel = $("#mSubject");
  const hint = $("#mSubjectHint");
  if (!sel || !hint) return;

  sel.innerHTML = "";

  if (!state.subjects.length) {
    hint.textContent = "ยังไม่พบรายชื่อวิชา (ตรวจว่า LIFF token ถูกส่งไป Worker ได้ไหม)";
    const opt = document.createElement("option");
    opt.value = "";
    opt.textContent = "— ไม่มีวิชา —";
    sel.appendChild(opt);
    sel.disabled = true;
    return;
  }

  sel.disabled = false;
  hint.textContent = "เลือกเพื่อเปลี่ยนวิชาได้";

  // กลุ่มเป็น label สวยๆ
  state.subjects.forEach((s) => {
    const opt = document.createElement("option");
    opt.value = String(s.id);
    const code = (s.subject_code || "").trim();
    const name = (s.subject_name || "").trim();
    const day = (s.day || "").trim();
    const st = (s.start_time || "").trim();
    const en = (s.end_time || "").trim();
    opt.textContent = `${code} ${name} • ${day} ${st}-${en}`;
    sel.appendChild(opt);
  });

  if (selectedSubjectId) {
    sel.value = String(selectedSubjectId);
  } else {
    sel.value = String(state.subjects[0].id);
  }

  // set allowDow from selected
  const picked = state.subjects.find((x) => String(x.id) === String(sel.value));
  const dow = picked ? thaiDowIndexFromSubjectDay(picked.day) : null;
  state.allowDow = dow;

  // auto set cancel date if not exists
  if (!state.cancelYmd) autoSelectNextValidCancelDate();
  renderCalendar();
}

async function openEdit(row) {
  state.editing = row;

  $("#mTitle").textContent = "แก้ไขรายการ";
  $("#mSub").textContent = `#${row.id} • ${itemDateText(row)}`;

  // type
  const mType = $("#mType");
  mType.value = row.type;
  setTypeUI(row.type);

  // title/note
  $("#mTitleInput").value = (row.title || "");
  $("#mNote").value = (row.note || "");

  // holiday dates (ymd)
  const sYmd = String(row.start_at || "").slice(0, 10);
  const eYmd = String(row.end_at || "").slice(0, 10);

  // cancel date = start_at ymd
  state.cancelYmd = sYmd || null;

  // set start/end input for holiday mode
  $("#mStart").value = sYmd || "";
  $("#mEnd").value = (eYmd && eYmd !== sYmd) ? eYmd : "";

  // fill subjects for cancel
  fillSubjectSelect(row.subject_id || "");

  // bind subject change -> enforce dow + auto select
  $("#mSubject").onchange = () => {
    const picked = state.subjects.find((x) => String(x.id) === String($("#mSubject").value));
    state.allowDow = picked ? thaiDowIndexFromSubjectDay(picked.day) : null;
    autoSelectNextValidCancelDate();
    renderCalendar();
  };

  // load reminders
  clearReminderUI();
  try {
    const rems = await fetchReminders(row.id);
    if (rems.length) {
      rems.forEach((r) => addReminderRow(r.remind_at));
    }
  } catch (e) {
    // ไม่ให้พังทั้งหน้า
    console.warn("load reminders failed", e);
  }

  // buttons
  $("#mAddRem").onclick = () => {
    addReminderRow(null);
    toast("เพิ่มเวลาแจ้งเตือนแล้ว ✅", "ok");
  };

  $("#mDelete").onclick = async () => {
    if (!confirm(`ลบรายการ #${row.id} ใช่ไหม?`)) return;
    try {
      await deleteHoliday(row.id);
      toast("ลบรายการเรียบร้อย ✅");
      openModal(false);
      await loadList();
    } catch (e) {
      toast(`ลบไม่สำเร็จ: ${e.message}`, "err");
    }
  };

  $("#mSaveBtn").onclick = async () => applyEditAndClose(true);
  $("#mCancelBtn").onclick = () => {
    openModal(false);
    toast("ยกเลิกการแก้ไขแล้ว", "ok");
  };
  $("#mCloseBtn").onclick = () => openModal(false);
  $("#mCloseX").onclick = () => openModal(false);
  $("#mBackdrop").onclick = () => openModal(false);

  // type change
  $("#mType").onchange = () => {
    const t = $("#mType").value;
    setTypeUI(t);

    // โหมดเปลี่ยนไปมา: จัดค่าที่จำเป็นให้พร้อม
    if (t === "cancel") {
      fillSubjectSelect($("#mSubject").value);
      if (!state.cancelYmd) autoSelectNextValidCancelDate();
      renderCalendar();
    } else {
      // holiday: ถ้า start ว่าง ให้ default วันนี้
      if (!$("#mStart").value) $("#mStart").value = dateToYmdLocal(new Date());
    }
  };

  // init flatpickr สำหรับ start/end (holiday) ให้เป็น date อย่างเดียว
  if (window.flatpickr) {
    if (!$("#mStart")._fpDate) {
      $("#mStart")._fpDate = flatpickr("#mStart", {
        dateFormat: "Y-m-d",
        altInput: true,
        altFormat: "d/m/Y",
        allowInput: true,
      });
      $("#mStart")._fpDate.altInput.classList.add("input");
    }
    if (!$("#mEnd")._fpDate) {
      $("#mEnd")._fpDate = flatpickr("#mEnd", {
        dateFormat: "Y-m-d",
        altInput: true,
        altFormat: "d/m/Y",
        allowInput: true,
      });
      $("#mEnd")._fpDate.altInput.classList.add("input");
    }
  }

  openModal(true);
}

async function applyEditAndClose(closeLiffAfter = false) {
  const row = state.editing;
  if (!row) return;

  const type = $("#mType").value;

  const title = ($("#mTitleInput").value || "").trim() || null;
  const note = ($("#mNote").value || "").trim() || null;

  let subject_id = null;
  let start_at = null;
  let end_at = null;

  if (type === "cancel") {
    subject_id = ($("#mSubject").value || "").trim() || null;

    if (!subject_id) {
      toast("กรุณาเลือกวิชา", "err");
      return;
    }
    if (!state.cancelYmd) {
      toast("กรุณาเลือกวันที่ยกคลาส", "err");
      return;
    }

    // cancel: วันเดียวทั้งวัน (00:00-23:59)
    start_at = toIsoBangkokAllDayStart(state.cancelYmd);
    end_at = toIsoBangkokAllDayEnd(state.cancelYmd);
  } else {
    // holiday
    const s = ($("#mStart").value || "").trim();
    const e = ($("#mEnd").value || "").trim() || s;

    if (!s) {
      toast("กรุณาเลือกวันที่เริ่ม", "err");
      return;
    }
    start_at = toIsoBangkokAllDayStart(s);
    end_at = toIsoBangkokAllDayEnd(e);
    subject_id = null;
  }

  const payload = {
    id: row.id,
    subject_id,
    start_at,
    end_at,
    title,
    note,
  };

  try {
    $("#mSaveBtn").disabled = true;

    // 1) update holiday
    await updateHoliday(payload);

    // 2) set reminders (replace pending)
    const remIso = collectReminderIsoList();
    await setReminders(row.id, remIso);

    toast("บันทึกการแก้ไขเรียบร้อย ✅", "ok");

    openModal(false);
    await loadList();

    // 3) close LIFF (ถ้าเปิดใน LINE)
    if (closeLiffAfter && window.liff && liff.isInClient()) {
      liff.closeWindow();
    }
  } catch (e) {
    toast(`บันทึกไม่สำเร็จ: ${e.message}`, "err");
  } finally {
    $("#mSaveBtn").disabled = false;
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
    if (!LIFF_ID) throw new Error('liffId is necessary for liff.init() — ใส่ window.__LIFF_ID__ ใน index.html');

    await liff.init({ liffId: LIFF_ID, withLoginOnExternalBrowser: true });

    if (!liff.isLoggedIn()) {
      liff.login();
      return;
    }

    state.idToken = liff.getIDToken();

    try {
      state.profile = await liff.getProfile();
      $("#userPill").textContent = state.profile?.displayName || "LINE User";
    } catch {
      $("#userPill").textContent = "LINE User";
    }

    // load subjects first (needed for cancel)
    state.subjects = await fetchSubjects();

    // calendar controls
    $("#calPrev").onclick = () => {
      state.calMonth = addMonths(state.calMonth, -1);
      renderCalendar();
    };
    $("#calNext").onclick = () => {
      state.calMonth = addMonths(state.calMonth, +1);
      renderCalendar();
    };

    // top actions
    $("#reloadBtn").onclick = () => loadList();

    // ปุ่มพวก “ทั้งการแก้ไข / บันทึกทั้งหมด” (ยังไม่ทำ batch UI — กันคนงงก่อน)
    $("#editAllBtn").onclick = () => toast("โหมดนี้ยังไม่เปิดใช้งาน (กันพลาด) 😉", "ok");
    $("#saveAllBtn").onclick = () => toast("โหมดนี้ยังไม่เปิดใช้งาน (กันพลาด) 😉", "ok");

    await loadList();
  } catch (e) {
    toast(`เริ่มระบบไม่สำเร็จ: ${e.message}`, "err");
    console.error(e);
  }
}

document.addEventListener("DOMContentLoaded", init);