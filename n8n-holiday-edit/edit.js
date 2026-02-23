// edit.js — LIFF Holiday Edit/Delete (minimal white)
// ✅ บังคับ Login LINE ก่อน
// ✅ หลัง login: getProfile().userId -> แสดง label
// ✅ เรียก Worker ด้วย LIFF idToken -> Worker จะล็อก userId ให้เอง
// ✅ แก้/ลบหลายรายการ + save ทีเดียว (batch)

// ✅ เหลือแค่ API Base พอ (ไม่ใช้ API KEY แล้ว)
const LS_API_BASE = "holiday_api_base";

const els = {
  subtitle: document.getElementById("subtitle"),
  rangeLabel: document.getElementById("rangeLabel"),
  userLabel: document.getElementById("userLabel"),

  list: document.getElementById("list"),
  empty: document.getElementById("empty"),

  btnReload: document.getElementById("btnReload"),
  btnSettings: document.getElementById("btnSettings"),

  settingsPanel: document.getElementById("settingsPanel"),
  apiBase: document.getElementById("apiBase"),
  btnSaveSettings: document.getElementById("btnSaveSettings"),
  btnClearSettings: document.getElementById("btnClearSettings"),

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
};

const state = {
  userId: null,
  items: [],
  edits: new Map(),    // id -> partial update payload
  deletes: new Set(),  // ids marked delete
  currentId: null,
  range: { from: null, to: null },
};

function toast(msg, ms = 1600) {
  els.toast.textContent = msg;
  els.toast.classList.add("show");
  window.clearTimeout(toast._t);
  toast._t = window.setTimeout(() => els.toast.classList.remove("show"), ms);
}

function pad2(n){ return String(n).padStart(2,"0"); }
function ymd(d){ return `${d.getFullYear()}-${pad2(d.getMonth()+1)}-${pad2(d.getDate())}`; }

function getApiBase(){
  return (localStorage.getItem(LS_API_BASE) || "").trim().replace(/\/+$/,"");
}
function setApiBase(base){
  localStorage.setItem(LS_API_BASE, (base||"").trim());
}

function getIdTokenOrThrow(){
  const token = liff.getIDToken?.();
  if (!token) throw new Error("ยังไม่ได้เปิด scope openid หรือยังไม่พร้อมใช้งาน idToken");
  return token;
}

async function apiFetch(path, { method="GET", body=null } = {}) {
  const base = getApiBase();
  if (!base) throw new Error("ยังไม่ตั้งค่า API Base");

  const idToken = getIdTokenOrThrow();
  const headers = {
    "Content-Type": "application/json",
    "Authorization": `Bearer ${idToken}`,
  };

  const res = await fetch(`${base}${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : null,
  });

  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; }
  catch { data = { raw: text }; }

  if (!res.ok) {
    const msg = data?.error || data?.message || `HTTP ${res.status}`;
    const e = new Error(msg);
    e.status = res.status;
    e.data = data;
    throw e;
  }
  return data;
}

// --- data normalize ---
function inferType(it){
  const t = (it.mode || it.type || it.kind || "").toString();
  if (t.includes("cancel")) return "cancel";
  if (t.includes("holiday")) return "holiday";
  return "holiday";
}
function normalizeItem(raw){
  const id = raw.id ?? raw.holiday_id ?? raw.hid;
  const start_at = (raw.start_at || raw.start_date || raw.start || "").slice(0,10);
  const end_at   = (raw.end_at || raw.end_date || raw.end || "").slice(0,10) || "";
  const title    = raw.title ?? null;
  const note     = raw.note ?? null;
  const type     = inferType(raw);
  return { ...raw, id, start_at, end_at, title, note, type };
}
function iconForType(type){ return type === "cancel" ? "🚫" : "📌"; }
function labelForType(type){ return type === "cancel" ? "ยกคลาส" : "วันหยุด"; }
function humanRange(start, end){
  if (!end || end === start) return start;
  return `${start} → ${end}`;
}

function isDirty(){ return state.edits.size > 0 || state.deletes.size > 0; }
function updateFooter(){
  els.countLabel.textContent = `แก้ไข ${state.edits.size} รายการ • ลบ ${state.deletes.size} รายการ`;
  els.btnSave.disabled = !isDirty();
}

// --- render ---
function render(){
  els.list.innerHTML = "";

  if (!state.items.length) els.empty.hidden = false;
  else els.empty.hidden = true;

  for (const it of state.items) {
    const deleted = state.deletes.has(it.id);
    const pending = state.edits.get(it.id) || {};

    let start = ("start_at" in pending) ? pending.start_at : it.start_at;
    let end   = ("end_at" in pending) ? pending.end_at : it.end_at;

    let title = ("title" in pending) ? pending.title : it.title;
    let note  = ("note" in pending) ? pending.note : it.note;

    const icon = iconForType(it.type);
    const titleLine =
      it.type === "holiday"
        ? (title ? `${icon} วันหยุด: ${title}` : `${icon} วันหยุด`)
        : `${icon} ยกคลาส: ${title || "ยกคลาส"}`;

    const card = document.createElement("div");
    card.className = "card" + (deleted ? " deleted" : "");
    card.dataset.id = it.id;

    const row = document.createElement("div");
    row.className = "row";

    const left = document.createElement("div");

    const h = document.createElement("p");
    h.className = "headline";
    h.textContent = titleLine;

    const tags = document.createElement("div");
    tags.className = "tags";

    const tagType = document.createElement("span");
    tagType.className = "tag";
    tagType.textContent = `${labelForType(it.type)}`;

    const tagDate = document.createElement("span");
    tagDate.className = "tag";
    tagDate.textContent = `📅 ${humanRange(start, end || start)}`;

    const tagState = document.createElement("span");
    tagState.className = "tag";
    tagState.textContent = deleted ? "🗑 จะลบ" : (Object.keys(pending).length ? "✏️ มีการแก้ไข" : "✓ ปกติ");

    tags.append(tagType, tagDate, tagState);

    const n = document.createElement("div");
    n.className = "note";
    n.textContent = note ? `📝 ${note}` : "📝 (ไม่มีโน้ต)";

    left.append(h, tags, n);

    const right = document.createElement("div");
    right.className = "cardBtns";

    const btnEdit = document.createElement("button");
    btnEdit.className = "btn btn--ghost";
    btnEdit.textContent = "แก้ไข";
    btnEdit.onclick = () => openModal(it.id);

    const btnDel = document.createElement("button");
    btnDel.className = "btn btn--danger";
    btnDel.textContent = deleted ? "Undo" : "ลบ";
    btnDel.onclick = () => {
      if (state.deletes.has(it.id)) state.deletes.delete(it.id);
      else state.deletes.add(it.id);
      render();
      updateFooter();
    };

    right.append(btnEdit, btnDel);

    row.append(left, right);
    card.append(row);
    els.list.append(card);
  }

  updateFooter();
}

// --- modal ---
function openModal(id){
  state.currentId = id;
  const it = state.items.find(x => x.id === id);
  if (!it) return;

  const pending = state.edits.get(id) || {};
  const start = ("start_at" in pending) ? pending.start_at : it.start_at;
  const end   = ("end_at" in pending) ? pending.end_at : it.end_at;
  const title = ("title" in pending) ? pending.title : (it.title ?? "");
  const note  = ("note" in pending) ? pending.note : (it.note ?? "");

  els.modalTitle.textContent = `${iconForType(it.type)} ${labelForType(it.type)} • แก้ไข`;
  els.modalMeta.textContent = `id: ${id} • userId: ${state.userId}`;

  els.mStart.value = start || "";
  els.mEnd.value = end || "";
  els.mTitle.value = title || "";
  els.mNote.value = note || "";

  const deleted = state.deletes.has(id);
  els.btnDeleteOne.hidden = deleted;
  els.btnUndoDelete.hidden = !deleted;

  els.overlay.hidden = false;
}

function closeModal(){
  els.overlay.hidden = true;
  state.currentId = null;
}

function applyModal(){
  const id = state.currentId;
  const it = state.items.find(x => x.id === id);
  if (!it) return;

  const start_at = els.mStart.value || "";
  const end_at = els.mEnd.value || "";

  if (!start_at) return toast("ต้องใส่วันที่เริ่มนะครับ 🙂");
  if (end_at && end_at < start_at) return toast("วันที่สิ้นสุดต้องไม่ก่อนวันที่เริ่ม");

  const titleRaw = (els.mTitle.value || "").trim();
  const noteRaw  = (els.mNote.value || "").trim();

  // holiday: ว่าง = null
  // cancel: ว่าง = "" (ให้ Worker fallback ต่อ)
  const title = (it.type === "holiday")
    ? (titleRaw ? titleRaw : null)
    : (titleRaw ? titleRaw : "");

  const note = noteRaw ? noteRaw : null;

  // เก็บเฉพาะ field ที่เปลี่ยนจริง (ไม่ต้องส่ง user_id แล้ว)
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
    toast("เก็บการแก้ไขไว้ในร่างแล้ว ✅");
  }

  render();
  closeModal();
}

// --- actions ---
function discardAll(){
  state.edits.clear();
  state.deletes.clear();
  toast("ทิ้งการแก้ไขทั้งหมดแล้ว");
  render();
}

async function loadList(){
  els.subtitle.textContent = "กำลังโหลดรายการ…";

  const from = state.range.from;
  const to = state.range.to;
  els.rangeLabel.textContent = `${from} → ${to}`;
  els.userLabel.textContent = state.userId ? state.userId : "—";

  // ✅ เปลี่ยนเป็น LIFF endpoint (ไม่ส่ง user_id)
  const url = `/liff/holidays/list?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`;

  const data = await apiFetch(url);
  const arr = Array.isArray(data) ? data : (data.items || data.holidays || []);
  state.items = arr.map(normalizeItem).filter(x => x.id != null);
  state.items.sort((a,b) => (a.start_at || "").localeCompare(b.start_at || ""));

  // reset draft เมื่อโหลดใหม่
  state.edits.clear();
  state.deletes.clear();

  els.subtitle.textContent = `โหลดแล้ว ${state.items.length} รายการ`;
  toast(`โหลดแล้ว ${state.items.length} รายการ ✅`);
  render();
}

async function saveAll(){
  if (!isDirty()) return;

  els.btnSave.disabled = true;
  toast("กำลังบันทึก…");

  const updates = Array.from(state.edits.values()); // [{id, ...fields}]
  const deletes = Array.from(state.deletes.values()); // [id, id, ...]

  try {
    await apiFetch(`/liff/holidays/batch`, {
      method: "POST",
      body: { updates, deletes },
    });

    toast("บันทึกสำเร็จ ✅🎉", 1800);
    els.subtitle.textContent = "บันทึกสำเร็จ ✅";

    // ส่งข้อความเข้าแชต (ถ้าเปิดจาก LINE client)
    try {
      if (liff.isInClient() && liff.sendMessages) {
        await liff.sendMessages([{ type:"text", text:"บันทึกการแก้ไขวันหยุดแล้ว ✅" }]);
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

// --- settings UI ---
function initSettingsUI(){
  els.apiBase.value = localStorage.getItem(LS_API_BASE) || "";

  els.btnSettings.onclick = () => {
    els.settingsPanel.hidden = !els.settingsPanel.hidden;
  };

  els.btnSaveSettings.onclick = () => {
    setApiBase(els.apiBase.value);
    toast("บันทึกตั้งค่าแล้ว ✅");
  };

  els.btnClearSettings.onclick = () => {
    setApiBase("");
    els.apiBase.value = "";
    toast("ล้างตั้งค่าแล้ว");
  };
}

// --- bind UI ---
function bindUI(){
  els.btnReload.onclick = async () => {
    try { await loadList(); }
    catch (e) { toast(`โหลดไม่สำเร็จ: ${e.message}`); }
  };

  els.btnDiscard.onclick = discardAll;
  els.btnSave.onclick = saveAll;

  els.btnCloseModal.onclick = closeModal;
  els.overlay.addEventListener("click", (e) => {
    if (e.target === els.overlay) closeModal();
  });

  els.btnApply.onclick = applyModal;

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
async function initLiffLoginFirst(){
  els.subtitle.textContent = "กำลัง init LIFF…";
  await liff.init({ withLoginOnExternalBrowser: true });

  // ✅ บังคับ Login ก่อนใช้งาน
  if (!liff.isLoggedIn()) {
    els.subtitle.textContent = "กำลังพาไปล็อกอิน LINE…";
    liff.login({ redirectUri: window.location.href });
    return;
  }

  const profile = await liff.getProfile();
  state.userId = profile.userId;

  // บังคับว่าต้องมี idToken (ต้องเปิด scope openid)
  getIdTokenOrThrow();

  els.userLabel.textContent = state.userId;
  els.subtitle.textContent = "พร้อมใช้งาน ✅";
}

// --- main ---
(async function main(){
  // range default: today-30 to today+90
  const now = new Date();
  const fromD = new Date(now); fromD.setDate(fromD.getDate() - 30);
  const toD   = new Date(now); toD.setDate(toD.getDate() + 90);
  state.range.from = ymd(fromD);
  state.range.to   = ymd(toD);
  els.rangeLabel.textContent = `${state.range.from} → ${state.range.to}`;

  initSettingsUI();
  bindUI();

  try {
    await initLiffLoginFirst();

    if (!state.userId) return; // ตอน redirect ไป login

    if (!getApiBase()) {
      els.settingsPanel.hidden = false;
      toast("ใส่ API Base ก่อนนะครับ ⚙️", 2200);
      return;
    }

    await loadList();
  } catch (e) {
    console.error(e);
    els.subtitle.textContent = "เริ่มต้นไม่สำเร็จ";
    els.settingsPanel.hidden = false;
    toast(`เริ่มต้นไม่สำเร็จ: ${e.message}`);
  }
})();