// script.js — Production (no settings UI)
// ✅ Login LINE ก่อน
// ✅ เรียก Worker ด้วย LIFF idToken
// ✅ ดึง/แก้/ลบผ่าน /liff/holidays/*
// ✅ Batch save + close modal ได้ 100%

// ===== PRODUCTION CONFIG =====
const API_BASE = "https://study-holiday-api.suwijuck-kat.workers.dev";
const LIFF_ID = "2009146879-3eBGpF5j";
// =============================

const els = {
  subtitle: document.getElementById("subtitle"),

  list: document.getElementById("list"),
  empty: document.getElementById("empty"),

  btnDiscard: document.getElementById("btnDiscard"),
  btnSave: document.getElementById("btnSave"),
  countLabel: document.getElementById("countLabel"),

  toast: document.getElementById("toast"),

  overlay: document.getElementById("overlay"),
  btnCloseModal: document.getElementById("btnCloseModal"),
  modalTitle: document.getElementById("modalTitle"),
  modalMeta: document.getElementById("modalMeta"),
  mStart: document.getElementById("mStart"),
  mEnd: document.getElementById("mEnd"),
  mTitle: document.getElementById("mTitle"),
  mNote: document.getElementById("mNote"),
  btnApply: document.getElementById("btnApply"),
  btnDeleteOne: document.getElementById("btnDeleteOne"),
  btnUndoDelete: document.getElementById("btnUndoDelete"),

  mRemindersList: document.getElementById("mRemindersList"),
  btnAddReminder: document.getElementById("btnAddReminder"),
  btnClearReminders: document.getElementById("btnClearReminders"),
};

const state = {
  userId: null,
  items: [],
  edits: new Map(),    // id -> partial update payload
  deletes: new Set(),  // ids marked delete
  currentId: null,
  range: { from: null, to: null },
  reminderEdits: new Map(),      // holidayId -> array of remind_at ISO strings
  reminderOriginal: new Map(),   // holidayId -> original array
  modalReminders: [],            // temp for modal editor
};

function toast(msg, ms = 1600) {
  els.toast.textContent = msg;
  els.toast.classList.add("show");
  window.clearTimeout(toast._t);
  toast._t = window.setTimeout(() => els.toast.classList.remove("show"), ms);
}

function pad2(n) { return String(n).padStart(2, "0"); }
function ymd(d) { return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`; }

function getIdTokenOrThrow() {
  const token = liff.getIDToken?.();
  if (!token) throw new Error("ไม่พบ idToken (ตรวจว่า LIFF เปิด scope openid แล้ว)");
  return token;
}

function isTokenExpiredMessage(msg) {
  if (!msg) return false;
  const s = String(msg).toLowerCase();
  return s.includes("idtoken expired") || s.includes("expired") || s.includes("invalid id_token") || s.includes("invalid token");
}

async function relogin() {
  toast("เซสชันหมดอายุ กำลังพาไปล็อกอินใหม่… 🔐", 2000);
  try { liff.logout(); } catch {}
  try { liff.login({ redirectUri: window.location.href }); } catch {}
}

async function apiFetch(path, { method = "GET", body = null } = {}) {
  const idToken = getIdTokenOrThrow();

  const res = await fetch(`${API_BASE}${path}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${idToken}`,
    },
    body: body ? JSON.stringify(body) : null,
  });

  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; }
  catch { data = { raw: text }; }

  if (!res.ok) {
  const msg = data?.error || data?.message || `HTTP ${res.status}`;

  // ✅ idToken หมดอายุ/ไม่ผ่าน verify → ล็อกอินใหม่อัตโนมัติ
  if (res.status === 401 || isTokenExpiredMessage(msg)) {
    await relogin();
    throw new Error(msg);
  }

  throw new Error(msg);
}
  return data;
}

// --- normalize ---
function inferType(it) {
  const t = (it.mode || it.type || it.kind || "").toString();
  if (t.includes("cancel")) return "cancel";
  if (t.includes("holiday")) return "holiday";
  return "holiday";
}

function normalizeItem(raw) {
  const id = raw.id ?? raw.holiday_id ?? raw.hid;
  const start_at = (raw.start_at || raw.start_date || raw.start || "").slice(0, 10);
  const end_at = (raw.end_at || raw.end_date || raw.end || "").slice(0, 10) || "";
  const title = raw.title ?? null;
  const note = raw.note ?? null;
  const type = inferType(raw);
  return { ...raw, id, start_at, end_at, title, note, type };
}

function iconForType(type) { return type === "cancel" ? "🚫" : "📌"; }

function labelTitle(it, title) {
  if (it.type === "cancel") return `🚫 ยกคลาส: ${title || "ยกคลาส"}`;
  return title ? `📌 วันหยุด: ${title}` : `📌 วันหยุด`;
}

function humanRange(start, end) {
  if (!end || end === start) return start;
  return `${start} → ${end}`;
}



/* =========================
   ✅ REMINDERS (edit in modal)
   ========================= */

// Convert ISO+07:00 -> value for <input type="datetime-local"> (YYYY-MM-DDTHH:mm)
function isoToLocalInput(iso) {
  if (!iso || typeof iso !== "string") return "";
  // 2026-02-24T09:00:00+07:00 -> 2026-02-24T09:00
  return iso.slice(0, 16);
}

// Convert <input type="datetime-local"> -> ISO with +07:00 (seconds forced :00)
function localInputToIsoBkk(v) {
  if (!v) return null;
  // Expect: YYYY-MM-DDTHH:mm
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(v)) return null;
  return `${v}:00+07:00`;
}

async function loadRemindersForHoliday(holidayId) {
  const data = await apiFetch(`/liff/holidays/reminders/list?holiday_id=${encodeURIComponent(holidayId)}`);
  const arr = data?.items || [];
  // keep only pending (allow editing). Sent/failed shown but locked (optional) — for now ignore non-pending.
  const pending = arr.filter(x => (x.status || "pending") === "pending").map(x => x.remind_at).filter(Boolean);
  return pending;
}

function renderRemindersEditor() {
  const wrap = els.mRemindersList;
  if (!wrap) return;
  wrap.innerHTML = "";

  if (!state.modalReminders || state.modalReminders.length === 0) {
    const empty = document.createElement("div");
    empty.className = "remEmpty";
    empty.textContent = "ยังไม่มีการตั้งแจ้งเตือน";
    wrap.append(empty);
    return;
  }

  state.modalReminders.forEach((iso, idx) => {
    const row = document.createElement("div");
    row.className = "remRow";

    const inp = document.createElement("input");
    inp.type = "datetime-local";
    inp.className = "input remInput";
    inp.value = isoToLocalInput(iso);
    inp.onchange = () => {
      const nextIso = localInputToIsoBkk(inp.value);
      if (!nextIso) {
        toast("รูปแบบเวลาไม่ถูกต้อง");
        inp.value = isoToLocalInput(state.modalReminders[idx]);
        return;
      }
      state.modalReminders[idx] = nextIso;
    };

    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "iconBtn deleteBtn";
    btn.title = "ลบเวลาแจ้งเตือนนี้";
    btn.innerHTML = "🗑️";
    btn.onclick = () => {
      state.modalReminders.splice(idx, 1);
      renderRemindersEditor();
    };

    row.append(inp, btn);
    wrap.append(row);
  });
}

// Compare reminders arrays ignoring order
function sameReminderSet(a, b) {
  const aa = (a || []).filter(Boolean).slice().sort();
  const bb = (b || []).filter(Boolean).slice().sort();
  if (aa.length !== bb.length) return false;
  for (let i = 0; i < aa.length; i++) if (aa[i] !== bb[i]) return false;
  return true;
}

function isDirty() { return state.edits.size > 0 || state.deletes.size > 0 || state.reminderEdits.size > 0; }

function updateFooter() {
  els.countLabel.textContent = `แก้ไข ${state.edits.size} • ลบ ${state.deletes.size} • แจ้งเตือน ${state.reminderEdits.size}`;
  els.btnSave.disabled = !isDirty();
}

// --- render list ---
function render() {
  els.list.innerHTML = "";

  els.empty.hidden = state.items.length !== 0;

  for (const it of state.items) {
    const deleted = state.deletes.has(it.id);
    const pending = state.edits.get(it.id) || {};

    const start = ("start_at" in pending) ? pending.start_at : it.start_at;
    const end = ("end_at" in pending) ? pending.end_at : it.end_at;
    const title = ("title" in pending) ? pending.title : it.title;
    const note = ("note" in pending) ? pending.note : it.note;

    const card = document.createElement("div");
    card.className = "card" + (deleted ? " deleted" : "");
    card.dataset.id = it.id;

    const row = document.createElement("div");
    row.className = "row";

    const left = document.createElement("div");

    const h = document.createElement("p");
    h.className = "headline";
    h.textContent = labelTitle(it, title);

    const tags = document.createElement("div");
    tags.className = "tags";

    const tagType = document.createElement("span");
    tagType.className = "tag";
    tagType.textContent = it.type === "cancel" ? "ยกคลาส" : "วันหยุด";

    const tagDate = document.createElement("span");
    tagDate.className = "tag";
    tagDate.textContent = `📅 ${humanRange(start, end || start)}`;

    const tagState = document.createElement("span");
    tagState.className = "tag";
    tagState.textContent = deleted ? "🗑 จะลบ" : (Object.keys(pending).length ? "✏️ มีการแก้ไข" : "✓ ปกติ");

    tags.append(tagType, tagDate, tagState);

    const n = document.createElement("div");
    n.className = "note";
    n.textContent = note ? `📝 ${note}` : "📝 (ไม่มีหมายเหตุ)";

    left.append(h, tags, n);

    row.append(left);
    card.append(row);

    // ✅ actions icon ขวาล่าง
    const actions = document.createElement("div");
    actions.className = "cardActions";

    const btnEdit = document.createElement("button");
    btnEdit.className = "iconBtn editBtn";
    btnEdit.innerHTML = "✏️";
    btnEdit.title = "แก้ไข";
    btnEdit.onclick = () => openModal(it.id);

    const btnDel = document.createElement("button");
    btnDel.className = "iconBtn deleteBtn";
    btnDel.innerHTML = deleted ? "↩️" : "🗑️";
    btnDel.title = deleted ? "ยกเลิกลบ" : "ลบ";
    btnDel.onclick = () => {
      if (state.deletes.has(it.id)) state.deletes.delete(it.id);
      else state.deletes.add(it.id);
      render();
      updateFooter();
    };

    actions.append(btnEdit, btnDel);
    card.append(actions);

    els.list.append(card);
  }

  updateFooter();
}

/* =========================
   ✅ MODAL
   ========================= */


async function openModal(id) {
  state.currentId = id;
  const it = state.items.find(x => x.id === id);
  if (!it) return;

  const pending = state.edits.get(id) || {};
  const start = ("start_at" in pending) ? pending.start_at : it.start_at;
  const end = ("end_at" in pending) ? pending.end_at : it.end_at;
  const title = ("title" in pending) ? pending.title : (it.title ?? "");
  const note = ("note" in pending) ? pending.note : (it.note ?? "");

  els.modalTitle.textContent = `${iconForType(it.type)} แก้ไขรายการ`;
  els.modalMeta.textContent = ""; // production: ไม่โชว์ id/user

  els.mStart.value = start || "";
  els.mEnd.value = end || "";
  els.mTitle.value = title || "";
  els.mNote.value = note || "";

  const deleted = state.deletes.has(id);
  els.btnDeleteOne.hidden = deleted;
  els.btnUndoDelete.hidden = !deleted;

  // ✅ Load reminders for this holiday (pending only)
  try {
    const original = await loadRemindersForHoliday(id);
    state.reminderOriginal.set(id, original);

    // if already edited, prefer edited list
    const edited = state.reminderEdits.get(id);
    state.modalReminders = (edited ? edited.slice() : original.slice());
  } catch (e) {
    console.error(e);
    state.modalReminders = [];
    toast(`โหลดแจ้งเตือนไม่สำเร็จ: ${e.message}`);
  }

  renderRemindersEditor();

  els.overlay.hidden = false;
  els.overlay.style.display = "flex";
}


function closeModal() {
  els.overlay.hidden = true;
  els.overlay.style.display = "none";
  state.currentId = null;
}

function applyModal() {
  const id = state.currentId;
  const it = state.items.find(x => x.id === id);
  if (!it) return;

  const start_at = els.mStart.value || "";
  const end_at = els.mEnd.value || "";

  if (!start_at) return toast("ต้องใส่วันที่เริ่มนะครับ 🙂");
  if (end_at && end_at < start_at) return toast("วันที่สิ้นสุดต้องไม่ก่อนวันที่เริ่ม");

  const titleRaw = (els.mTitle.value || "").trim();
  const noteRaw = (els.mNote.value || "").trim();

  // holiday: ว่าง = null
  // cancel: ว่าง = "" (ให้ Worker fallback ต่อ)
  const title = (it.type === "holiday")
    ? (titleRaw ? titleRaw : null)
    : (titleRaw ? titleRaw : "");

  const note = noteRaw ? noteRaw : null;

  const changed = { id };
  let dirty = false;

  if (start_at !== it.start_at) { changed.start_at = start_at; dirty = true; }
  if ((end_at || "") !== (it.end_at || "")) { changed.end_at = end_at || null; dirty = true; }
  if ((title ?? null) !== (it.title ?? null)) { changed.title = title; dirty = true; }
  if ((note ?? null) !== (it.note ?? null)) { changed.note = note; dirty = true; }

  if (!dirty) {
    state.edits.delete(id);
    toast("ไม่มีอะไรเปลี่ยนแปลง");
  } else {
    state.edits.set(id, changed);
    toast("เก็บการแก้ไขไว้แล้ว ✅");
  }

  // ✅ Reminders dirty check
  const newRems = (state.modalReminders || []).filter(Boolean);
  const originalRems = state.reminderOriginal.get(id) || [];
  if (sameReminderSet(newRems, originalRems)) {
    state.reminderEdits.delete(id);
  } else {
    state.reminderEdits.set(id, newRems);
  }

  render();
  closeModal();
}

// --- actions ---
function discardAll() {
  state.edits.clear();
  state.deletes.clear();
  state.reminderEdits.clear();
  state.reminderOriginal.clear();
  toast("ทิ้งการแก้ไขทั้งหมดแล้ว");
  render();
}

async function loadList() {
  els.subtitle.textContent = "กำลังโหลดรายการ…";

  const from = state.range.from;
  const to = state.range.to;

  const url = `/liff/holidays/list?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`;

  const data = await apiFetch(url);
  const arr = Array.isArray(data) ? data : (data.items || data.holidays || []);
  state.items = arr.map(normalizeItem).filter(x => x.id != null);
  state.items.sort((a, b) => (a.start_at || "").localeCompare(b.start_at || ""));

  state.edits.clear();
  state.deletes.clear();
  state.reminderEdits.clear();
  state.reminderOriginal.clear();

  els.subtitle.textContent = `พบ ${state.items.length} รายการ`;
  toast(`โหลดแล้ว ${state.items.length} รายการ ✅`);
  render();
}

async function saveAll() {
  if (!isDirty()) return;

  els.btnSave.disabled = true;
  toast("กำลังบันทึก…");

  const updates = Array.from(state.edits.values());
  const deletes = Array.from(state.deletes.values());

  try {
    await apiFetch(`/liff/holidays/batch`, {
      method: "POST",
      body: { updates, deletes },
    });


    // ✅ apply reminder changes (replace pending reminders per holiday)
    for (const [holidayId, remindAts] of state.reminderEdits.entries()) {
      // if holiday is deleted, skip (delete already handles reminders)
      if (state.deletes.has(holidayId)) continue;

      const reminders = (remindAts || []).filter(Boolean).map((x) => ({ remind_at: x }));
      await apiFetch(`/liff/holidays/reminders/set`, {
        method: "POST",
        body: { holiday_id: holidayId, reminders },
      });
    }


    toast("บันทึกสำเร็จ ✅🎉", 1800);
    els.subtitle.textContent = "บันทึกสำเร็จ ✅";

    // ส่งข้อความเข้าแชต (ถ้าเปิดจาก LINE client)
    try {
      if (liff.isInClient() && liff.sendMessages) {
        await liff.sendMessages([{ type: "text", text: "บันทึกการแก้ไขวันหยุดแล้ว ✅" }]);
      }
    } catch {}

    await loadList();
    try { liff.closeWindow(); } catch {}

  } catch (e) {
    console.error(e);
    toast(`บันทึกไม่สำเร็จ: ${e.message}`);
    els.subtitle.textContent = "บันทึกไม่สำเร็จ";
  } finally {
    els.btnSave.disabled = !isDirty();
    updateFooter();
  }
}

// --- bind UI ---
function bindUI() {
  els.btnDiscard.onclick = discardAll;
  els.btnSave.onclick = saveAll;

  els.btnCloseModal.onclick = closeModal;

  els.overlay.addEventListener("click", (e) => {
    if (e.target === els.overlay) closeModal();
  });

  window.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && !els.overlay.hidden) closeModal();
  });

  els.btnApply.onclick = applyModal;

  // ✅ Reminder editor buttons (in modal)
  if (els.btnAddReminder) {
    els.btnAddReminder.onclick = () => {
      const baseDate = els.mStart?.value || ymd(new Date());
      const v = `${baseDate}T09:00`;
      const iso = localInputToIsoBkk(v);
      if (iso) state.modalReminders.push(iso);
      renderRemindersEditor();
    };
  }
  if (els.btnClearReminders) {
    els.btnClearReminders.onclick = () => {
      state.modalReminders = [];
      renderRemindersEditor();
      toast("ล้างแจ้งเตือนแล้ว");
    };
  }


  els.btnDeleteOne.onclick = () => {
    const id = state.currentId;
    if (!id) return;
    state.deletes.add(id);
    toast("ทำเครื่องหมายว่าจะลบแล้ว 🗑");
    render();
    closeModal();
  };

  els.btnUndoDelete.onclick = () => {
    const id = state.currentId;
    if (!id) return;
    state.deletes.delete(id);
    toast("Undo ลบแล้ว");
    render();
    closeModal();
  };
}

// --- LIFF init (login-first) ---
async function initLiffLoginFirst() {
  els.subtitle.textContent = "กำลังเริ่มต้น…";

  await liff.init({
    liffId: LIFF_ID,
    withLoginOnExternalBrowser: true
  });

  if (!liff.isLoggedIn()) {
    els.subtitle.textContent = "กำลังพาไปล็อกอิน LINE…";
    liff.login({ redirectUri: window.location.href });
    return;
  }

  getIdTokenOrThrow();

  const profile = await liff.getProfile();
  state.userId = profile.userId;

  els.subtitle.textContent = "พร้อมใช้งาน ✅";
}

// --- main ---
(async function main() {
  // กัน modal โผล่ค้าง
  closeModal();

  // range: today-30 to today+90
  const now = new Date();
  const fromD = new Date(now); fromD.setDate(fromD.getDate() - 30);
  const toD = new Date(now); toD.setDate(toD.getDate() + 90);
  state.range.from = ymd(fromD);
  state.range.to = ymd(toD);

  bindUI();

  try {
    await initLiffLoginFirst();
    if (!state.userId) return;

    await loadList();
  } catch (e) {
    console.error(e);
    els.subtitle.textContent = "เริ่มต้นไม่สำเร็จ";
    toast(`เริ่มต้นไม่สำเร็จ: ${e.message}`);
  }
})();