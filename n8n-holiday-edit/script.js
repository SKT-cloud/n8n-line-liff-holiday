// ============================
// Edit / Delete Holiday (LIFF)
// ============================

const WORKER_BASE = "https://study-holiday-api.suwijuck-kat.workers.dev"; // ✅ เปลี่ยนได้
const $ = (s, el=document) => el.querySelector(s);

function joinUrl(base, path){
  return String(base).replace(/\/+$/, "") + "/" + String(path).replace(/^\/+/, "");
}

function toast(msg, kind="info"){
  const el = $("#toast");
  if (!el) return;
  el.textContent = msg;
  el.className = `toast ${kind}`;
  el.hidden = false;
  clearTimeout(toast._t);
  toast._t = setTimeout(() => (el.hidden = true), 2800);
}

function setStatus(t){
  const el = $("#status");
  if (el) el.textContent = t || "";
}

function ymdToThai(ymd){
  if (!ymd) return "-";
  const [y,m,d] = String(ymd).split("-");
  if(!y||!m||!d) return "-";
  return `${d}/${m}/${y}`;
}

function dateRangeText(startIso, endIso){
  const s = (startIso||"").slice(0,10);
  const e = (endIso||"").slice(0,10);
  if (!s) return "-";
  if (e && e !== s) return `${ymdToThai(s)} – ${ymdToThai(e)}`;
  return `${ymdToThai(s)}`;
}

function toIsoAllDayStart(ymd){ return `${ymd}T00:00:00+07:00`; }
function toIsoAllDayEnd(ymd){ return `${ymd}T23:59:59+07:00`; }

function isYmd(v){ return typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v); }

// ============================
// ✅ Flatpickr helpers (24h)
// ============================

// "YYYY-MM-DD HH:mm" -> "YYYY-MM-DDTHH:mm:00+07:00"
function ymdHmToIsoBangkok(ymdHm){
  if (!ymdHm) return null;
  const s = String(ymdHm).trim();
  const m = s.match(/^(\d{4}-\d{2}-\d{2})\s+(\d{2}:\d{2})$/);
  if (!m) return null;
  return `${m[1]}T${m[2]}:00+07:00`;
}

// "YYYY-MM-DDTHH:mm:ss+07:00" -> "YYYY-MM-DD HH:mm"
function isoToYmdHm(iso){
  if(!iso) return "";
  const d = iso.slice(0,10);
  const hhmm = iso.slice(11,16);
  return `${d} ${hhmm}`;
}

function initReminderPicker(inputEl){
  if (!window.flatpickr) return;
  if (inputEl._fp) return;

  inputEl._fp = window.flatpickr(inputEl, {
    enableTime: true,
    time_24hr: true,              // ✅ ไม่มี AM/PM
    minuteIncrement: 5,
    allowInput: true,
    dateFormat: "Y-m-d H:i",      // ✅ ค่าที่อ่านจาก input
    altInput: true,
    altFormat: "d/m/Y H:i",       // ✅ ค่าที่ผู้ใช้เห็น
  });

  // ทำให้ altInput ใช้ class เดียวกัน
  if (inputEl._fp?.altInput){
    inputEl._fp.altInput.classList.add("input");
  }
}

function setReminderPickerValue(inputEl, iso){
  if (!inputEl?._fp) return;
  const v = isoToYmdHm(iso);
  if (!v) return;
  inputEl._fp.setDate(v, true, "Y-m-d H:i");
}

// ============================
// ✅ Request / LIFF
// ============================

async function requestJson(path, { method="GET", idToken, body } = {}){
  const url = joinUrl(WORKER_BASE, path);
  const headers = { "Content-Type":"application/json" };
  if (idToken) headers.Authorization = `Bearer ${idToken}`;

  const res = await fetch(url, { method, headers, body: body ? JSON.stringify(body) : undefined });
  const data = await res.json().catch(()=>({}));
  if (!res.ok || data.ok === false){
    const msg = data?.error || data?.message || `HTTP ${res.status}`;
    if (/expired/i.test(msg)){
      const e = new Error("IDTOKEN_EXPIRED");
      e.code = "IDTOKEN_EXPIRED";
      throw e;
    }
    throw new Error(msg);
  }
  return data;
}

async function initLiff(){
  await window.liff.init({ liffId: "2009146879-3eBGpF5j" }); // ✅ LIFF_ID_EDIT
  if (!window.liff.isLoggedIn()){
    window.liff.login({ redirectUri: location.href });
    return {};
  }
  const idToken = window.liff.getIDToken();
  const profile = await window.liff.getProfile();
  return { idToken, profile };
}

function buildEditedFlex(){
  return {
    type: "flex",
    altText: "✅ แก้ไขวันหยุดเรียบร้อยแล้วค่ะ",
    contents: {
      type: "bubble",
      size: "mega",
      body: {
        type: "box",
        layout: "vertical",
        spacing: "md",
        contents: [
          {
            type: "box",
            layout: "horizontal",
            spacing: "sm",
            contents: [
              { type: "text", text: "✅", size: "xl", flex: 0 },
              { type: "text", text: "แก้ไขเรียบร้อยแล้วค่ะ", weight: "bold", size: "lg", wrap: true },
            ],
          },
          { type: "separator" },
          {
            type: "text",
            text: "ถ้าต้องการตรวจสอบรายการทั้งหมด กดปุ่มด้านล่างได้เลยนะคะ 😊",
            wrap: true,
            size: "sm",
            color: "#555555"
          }
        ]
      },
      footer: {
        type: "box",
        layout: "vertical",
        spacing: "sm",
        contents: [
          { type: "button", style: "primary", action: { type: "message", label: "👀 ดูวันหยุด", text: "ดูวันหยุด" } },
        ],
      },
    },
  };
}

// ============================
// ✅ Subjects cache + weekday restriction
// ============================

const TH_DOW = ["อาทิตย์","จันทร์","อังคาร","พุธ","พฤหัสบดี","ศุกร์","เสาร์"];

function thToDowIdx(th){
  const t = String(th || "").trim();
  const map = { "พฤ": "พฤหัสบดี" };
  const key = map[t] || t;
  return TH_DOW.indexOf(key);
}

function ymdDowIdx(ymd){
  const [y,m,d] = String(ymd).split("-").map(Number);
  if(!y || !m || !d) return -1;
  const dt = new Date(Date.UTC(y, m-1, d));
  return dt.getUTCDay(); // 0..6
}

function monthNameEn(mIdx){
  const names = ["January","February","March","April","May","June","July","August","September","October","November","December"];
  return names[mIdx] || "-";
}

const state = {
  idToken: "",
  items: [],
  remindersById: new Map(),

  pendingUpdates: new Map(),      // id -> {id, type, subject_id, start_at,end_at,title,note}
  pendingDeletes: new Set(),      // id
  pendingReminderSets: new Map(), // id -> [iso,...]

  // subjects cache
  subjectsLoaded: false,
  subjects: [],
  subjectDowById: new Map(),      // subject_id -> Set(dowIdx)
  subjectIdByCode: new Map(),     // subject_code -> subject_id
  subjectLabelById: new Map(),    // subject_id -> label

  // modal context
  currentId: null,
  allowedDow: null,              // Set(dowIdx)
  calCursor: null,               // {y,m} month cursor for cancel calendar
};

async function loadSubjectsCache(){
  if (state.subjectsLoaded) return;
  const data = await requestJson("/liff/subjects", { method:"GET", idToken: state.idToken });
  state.subjects = data.items || [];
  state.subjectsLoaded = true;

  state.subjectDowById.clear();
  state.subjectIdByCode.clear();
  state.subjectLabelById.clear();

  for (const s of state.subjects){
    const id = String(s.id);
    const code = String(s.subject_code || "").trim();
    const name = String(s.subject_name || "").trim();
    const day = String(s.day || "").trim();
    const label = `${code} ${name}`.trim() || `วิชา #${id}`;

    if (code) state.subjectIdByCode.set(code, id);
    state.subjectLabelById.set(id, label);

    const idx = thToDowIdx(day);
    if (idx < 0) continue;
    if (!state.subjectDowById.has(id)) state.subjectDowById.set(id, new Set());
    state.subjectDowById.get(id).add(idx);
  }
}

function fillSubjectSelect(selectedId){
  const sel = $("#mSubject");
  sel.innerHTML = "";

  const opt0 = document.createElement("option");
  opt0.value = "";
  opt0.textContent = "— เลือกวิชา —";
  sel.appendChild(opt0);

  const order = ["จันทร์","อังคาร","พุธ","พฤหัสบดี","ศุกร์","เสาร์","อาทิตย์"];
  const groups = new Map();
  for (const s of state.subjects){
    const day = String(s.day||"").trim() || "อื่นๆ";
    if (!groups.has(day)) groups.set(day, []);
    groups.get(day).push(s);
  }

  const days = [...groups.keys()].sort((a,b)=>{
    const ia = order.indexOf(a); const ib = order.indexOf(b);
    return (ia<0?99:ia) - (ib<0?99:ib);
  });

  for (const day of days){
    const og = document.createElement("optgroup");
    og.label = day;

    const arr = groups.get(day) || [];
    arr.sort((a,b)=> String(a.start_time||"").localeCompare(String(b.start_time||"")));

    for (const s of arr){
      const id = String(s.id);
      const code = String(s.subject_code || "").trim();
      const name = String(s.subject_name || "").trim();
      const start = String(s.start_time || "").trim();
      const end = String(s.end_time || "").trim();
      const type = String(s.type || "").trim();
      const room = String(s.room || "").trim();

      const o = document.createElement("option");
      o.value = id;
      o.textContent = `${code} ${name} • ${day} ${start}-${end}${room?` • ${room}`:""}${type?` • ${type}`:""}`.trim();
      if (selectedId && id === String(selectedId)) o.selected = true;
      og.appendChild(o);
    }

    sel.appendChild(og);
  }
}

// ============================
// ✅ Calendar render (Cancel)
// ============================

function setCalCursorFromYmd(ymd){
  const [y,m] = String(ymd).split("-").map(Number);
  if (y && m) state.calCursor = { y, m }; // m 1-12
}

function todayYmd(){
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth()+1).padStart(2,"0");
  const d = String(now.getDate()).padStart(2,"0");
  return `${y}-${m}-${d}`;
}

function renderCancelCalendar(){
  const grid = $("#calGrid");
  const title = $("#calTitle");
  if (!grid || !title) return;

  const cur = state.calCursor || (()=>{ const [y,m]=todayYmd().split("-").map(Number); return {y,m}; })();
  state.calCursor = cur;

  title.textContent = `${monthNameEn(cur.m-1)} ${cur.y}`;

  grid.innerHTML = "";

  const dows = ["Su","Mo","Tu","We","Th","Fr","Sa"];
  for (const d of dows){
    const el = document.createElement("div");
    el.className = "calDow";
    el.textContent = d;
    grid.appendChild(el);
  }

  const first = new Date(Date.UTC(cur.y, cur.m-1, 1));
  const firstDow = first.getUTCDay(); // 0..6
  const daysInMonth = new Date(Date.UTC(cur.y, cur.m, 0)).getUTCDate();

  const prevDays = new Date(Date.UTC(cur.y, cur.m-1, 0)).getUTCDate();

  const selected = $("#mCancelYmd").value || "";
  const minYmd = todayYmd();

  const cells = 42;
  for (let i=0; i<cells; i++){
    const dayIndex = i - firstDow + 1; // 1..daysInMonth
    let y=cur.y, m=cur.m, d=dayIndex;
    let other=false;

    if (dayIndex <= 0){
      other = true;
      d = prevDays + dayIndex;
      m = cur.m - 1;
      if (m <= 0){ m = 12; y = cur.y - 1; }
    } else if (dayIndex > daysInMonth){
      other = true;
      d = dayIndex - daysInMonth;
      m = cur.m + 1;
      if (m >= 13){ m = 1; y = cur.y + 1; }
    }

    const ymd = `${y}-${String(m).padStart(2,"0")}-${String(d).padStart(2,"0")}`;
    const dow = ymdDowIdx(ymd);

    const el = document.createElement("div");
    el.className = "calDay";
    el.textContent = String(d);

    if (other) el.classList.add("isOtherMonth");
    if (selected && ymd === selected) el.classList.add("isSelected");

    if (ymd < minYmd) el.classList.add("isDisabled");

    if (state.allowedDow && state.allowedDow.size){
      if (!state.allowedDow.has(dow)) el.classList.add("isDisabled");
    }

    el.addEventListener("click", () => {
      if (el.classList.contains("isDisabled")) return;
      $("#mCancelYmd").value = ymd;
      $("#cancelDatePill").textContent = ymdToThai(ymd);

      if (other){
        state.calCursor = { y, m };
      }
      renderCancelCalendar();
      validateModal();
    });

    grid.appendChild(el);
  }
}

// ============================
// ✅ Validation (modal)
// ============================

function validateModal(){
  const btn = $("#mApply");
  const type = $("#mType").value;

  if (type === "cancel"){
    const sid = $("#mSubject").value;
    const ymd = $("#mCancelYmd").value;

    if (!sid){
      btn.disabled = true;
      $("#subjectHint").textContent = "กรุณาเลือกวิชาก่อนนะคะ";
      return false;
    } else {
      $("#subjectHint").textContent = "";
    }

    if (!isYmd(ymd)){
      btn.disabled = true;
      return false;
    }

    if (state.allowedDow && state.allowedDow.size){
      const dow = ymdDowIdx(ymd);
      if (!state.allowedDow.has(dow)){
        btn.disabled = true;
        return false;
      }
    }

    btn.disabled = false;
    return true;
  }

  const s = $("#mStart").value;
  if (!isYmd(s)){
    btn.disabled = true;
    return false;
  }
  btn.disabled = false;
  return true;
}

// ============================
// ✅ UI list
// ============================

function escapeHtml(s){
  return String(s||"")
    .replaceAll("&","&amp;")
    .replaceAll("<","&lt;")
    .replaceAll(">","&gt;")
    .replaceAll('"',"&quot;")
    .replaceAll("'","&#039;");
}

function renderList(){
  const list = $("#list");
  const hint = $("#listHint");
  if (!list) return;

  list.innerHTML = "";

  const items = state.items.filter(it => !state.pendingDeletes.has(String(it.id)));

  if (!items.length){
    list.innerHTML = `<div class="empty">ยังไม่พบรายการวันหยุดในช่วงที่เลือก 😅</div>`;
    if (hint) hint.textContent = "0 รายการ";
    return;
  }

  if (hint) hint.textContent = `พบ ${items.length} รายการ`;

  for (const it of items){
    const id = String(it.id);
    const t = (it.title || "").trim() || (it.type === "cancel" ? "ยกคลาส" : "วันหยุด");
    const typeBadge = it.type === "cancel"
      ? `<span class="badge cancel">🚫 ยกคลาส</span>`
      : `<span class="badge holiday">🏝️ วันหยุด</span>`;

    const dateText = dateRangeText(it.start_at, it.end_at);

    const card = document.createElement("div");
    card.className = "item";
    card.innerHTML = `
      <div class="itemTop">
        <div>
          <div class="itemTitle">${escapeHtml(t)}</div>
          <div class="itemMeta">📅 ${dateText}</div>
          <div class="badges">
            ${typeBadge}
            <span class="badge">#${id}</span>
          </div>
        </div>

        <div class="itemBtns">
          <button class="iconBtn" type="button" data-edit="${id}" aria-label="แก้ไข">✏️</button>
          <button class="iconBtn danger" type="button" data-del="${id}" aria-label="ลบ">🗑️</button>
        </div>
      </div>
    `;
    list.appendChild(card);
  }
}

async function loadRange(){
  const now = new Date();
  const from = new Date(now); from.setDate(from.getDate() - 30);
  const to = new Date(now); to.setDate(to.getDate() + 365);

  const ymd = (d) => `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
  const fromIso = `${ymd(from)}T00:00:00+07:00`;
  const toIso = `${ymd(to)}T23:59:59+07:00`;

  setStatus("กำลังโหลดรายการ...");
  const data = await requestJson(`/liff/holidays/list?from=${encodeURIComponent(fromIso)}&to=${encodeURIComponent(toIso)}`, {
    method: "GET",
    idToken: state.idToken
  });

  state.items = data.items || [];
  setStatus("");
  renderList();
}

// ============================
// ✅ Modal open/close
// ============================

function toggleModalByType(type){
  const isCancel = type === "cancel";

  $("#subjectWrap").hidden = !isCancel;
  $("#cancelDateWrap").hidden = !isCancel;

  $("#holidayDatesWrap").hidden = isCancel;
  $("#endWrap").hidden = isCancel;

  $("#typeHint").textContent =
    isCancel
      ? "ยกคลาส: เลือกวิชา + เลือกวันที่ (ระบบจะบังคับให้ตรงวันเรียน)"
      : "หยุดทั้งวัน: เลือกช่วงวันที่เริ่ม–สิ้นสุดได้";

  validateModal();
}

async function openModal(id){
  const it = state.items.find(x => String(x.id) === String(id));
  if (!it) return;

  state.currentId = String(id);

  $("#modal").hidden = false;
  document.body.style.overflow = "hidden";

  $("#modalSub").textContent = `#${it.id} • ${dateRangeText(it.start_at, it.end_at)}`;

  $("#mType").value = it.type === "cancel" ? "cancel" : "holiday";
  toggleModalByType($("#mType").value);

  const sYmd = (it.start_at||"").slice(0,10);
  const eYmd = (it.end_at||"").slice(0,10);
  $("#mStart").value = sYmd || "";
  $("#mEnd").value = (eYmd && eYmd !== sYmd) ? eYmd : "";

  $("#mTitle").value = (it.title || "").trim();
  $("#mNote").value = (it.note || "").trim();

  $("#mCancelYmd").value = "";
  $("#cancelDatePill").textContent = "ยังไม่ได้เลือก";

  await loadSubjectsCache();

  // subject_id ใน DB บางทีเป็น "CSI103" (code) — map ให้
  let subjId = it.subject_id != null ? String(it.subject_id) : "";
  if (subjId && !/^\d+$/.test(subjId)){
    const mapped = state.subjectIdByCode.get(subjId);
    if (mapped) subjId = mapped;
  }

  fillSubjectSelect(subjId || "");
  $("#mSubject").value = subjId || "";

  state.allowedDow = null;
  if ($("#mSubject").value){
    const allow = state.subjectDowById.get(String($("#mSubject").value));
    state.allowedDow = allow ? new Set([...allow]) : null;
  }

  if (it.type === "cancel"){
    const ymd0 = (it.start_at||"").slice(0,10);
    if (isYmd(ymd0)){
      $("#mCancelYmd").value = ymd0;
      $("#cancelDatePill").textContent = ymdToThai(ymd0);
      setCalCursorFromYmd(ymd0);
    } else {
      setCalCursorFromYmd(todayYmd());
    }
  } else {
    setCalCursorFromYmd(todayYmd());
  }

  if (state.allowedDow && state.allowedDow.size){
    const days = [...state.allowedDow].sort().map(i => TH_DOW[i]).join(", ");
    $("#cancelHint").textContent = `เลือกได้เฉพาะ: ${days}`;
  } else {
    $("#cancelHint").textContent = "เลือกวิชาเพื่อให้ระบบบังคับวันเรียน";
  }

  renderCancelCalendar();
  validateModal();

  loadRemindersIntoModal(String(it.id)).catch(err => {
    console.error(err);
    toast(err?.message || String(err), "err");
  });
}

function closeModal(){
  $("#modal").hidden = true;
  document.body.style.overflow = "";
  state.currentId = null;
  state.allowedDow = null;
}

// ============================
// ✅ Reminders modal (flatpickr 24h)
// ============================

async function loadRemindersIntoModal(id){
  const wrap = $("#mRemList");
  wrap.innerHTML = `<div class="empty">กำลังโหลดแจ้งเตือน...</div>`;

  const data = await requestJson(`/liff/holidays/reminders/list?holiday_id=${encodeURIComponent(id)}`, {
    method:"GET",
    idToken: state.idToken
  });

  const items = data.items || [];
  state.remindersById.set(String(id), items);

  renderModalReminders(id);
}

function renderModalReminders(id){
  const wrap = $("#mRemList");
  wrap.innerHTML = "";

  const base = state.pendingReminderSets.has(id)
    ? state.pendingReminderSets.get(id).map(iso => ({ remind_at: iso }))
    : (state.remindersById.get(id) || []);

  if (!base.length){
    wrap.innerHTML = `<div class="empty">ยังไม่มีการตั้งแจ้งเตือน</div>`;
    return;
  }

  base.forEach((r, idx) => {
    const row = document.createElement("div");
    row.className = "remRow";

    const inp = document.createElement("input");
    inp.className = "input";
    inp.type = "text";
    initReminderPicker(inp);
    setReminderPickerValue(inp, r.remind_at);

    const del = document.createElement("button");
    del.type = "button";
    del.className = "iconBtn danger";
    del.textContent = "🗑️";
    del.title = "ลบเวลาแจ้งเตือน";

    inp.addEventListener("change", () => {
      const arr = collectModalReminderValues();
      state.pendingReminderSets.set(String(id), arr);
    });

    del.addEventListener("click", () => {
      const arr = collectModalReminderValues();
      arr.splice(idx, 1);
      state.pendingReminderSets.set(String(id), arr);
      renderModalReminders(String(id));
      toast("ลบเวลาแจ้งเตือนแล้ว ✅", "ok");
    });

    row.appendChild(inp);
    row.appendChild(del);
    wrap.appendChild(row);
  });
}

function collectModalReminderValues(){
  const wrap = $("#mRemList");
  const inps = [...wrap.querySelectorAll('input[type="text"]')];
  const out = [];
  for (const i of inps){
    const iso = ymdHmToIsoBangkok(i.value);
    if (iso) out.push(iso);
  }
  return [...new Set(out)].sort();
}

// ============================
// ✅ Apply modal -> pending
// ============================

function applyModalToPending(){
  const id = state.currentId;
  if (!id) return;

  const it = state.items.find(x => String(x.id) === String(id));
  if (!it) return;

  const type = $("#mType").value;

  if (!validateModal()){
    toast("กรุณากรอกข้อมูลให้ครบก่อนนะคะ 🙏", "err");
    return;
  }

  let startYmd = "";
  let endYmd = "";
  let subject_id = null;

  if (type === "cancel"){
    subject_id = $("#mSubject").value ? Number($("#mSubject").value) : null;
    startYmd = $("#mCancelYmd").value;
    endYmd = startYmd;
  } else {
    startYmd = $("#mStart").value;
    endYmd = $("#mEnd").value || startYmd;
    subject_id = null;
  }

  const title = ($("#mTitle").value || "").trim() || null;
  const note  = ($("#mNote").value || "").trim() || null;

  const upd = {
    id: Number(id),
    type,
    subject_id,
    start_at: toIsoAllDayStart(startYmd),
    end_at: toIsoAllDayEnd(endYmd),
    title,
    note
  };

  state.pendingUpdates.set(String(id), upd);

  const rems = collectModalReminderValues();
  state.pendingReminderSets.set(String(id), rems);

  toast("บันทึกการแก้ไขรายการนี้ไว้แล้ว ✅", "ok");
  closeModal();
  updateCounters();
}

function markDeleteFromModal(){
  const id = state.currentId;
  if (!id) return;
  state.pendingDeletes.add(String(id));
  state.pendingUpdates.delete(String(id));
  state.pendingReminderSets.delete(String(id));
  toast("ทำเครื่องหมายลบไว้แล้ว ✅", "ok");
  closeModal();
  updateCounters();
  renderList();
}

function discardAll(){
  state.pendingUpdates.clear();
  state.pendingDeletes.clear();
  state.pendingReminderSets.clear();
  toast("ทิ้งการแก้ไขทั้งหมดแล้ว", "ok");
  updateCounters();
  renderList();
}

function updateCounters(){
  const u = state.pendingUpdates.size;
  const d = state.pendingDeletes.size;
  setStatus(`แก้ไข ${u} • ลบ ${d}`);
}

// ============================
// ✅ Save all
// ============================

async function saveAll(){
  if (!state.pendingUpdates.size && !state.pendingDeletes.size && !state.pendingReminderSets.size){
    toast("ยังไม่มีอะไรให้บันทึกนะคะ 😄", "ok");
    return;
  }

  const ok = window.confirm("ยืนยันบันทึกทั้งหมดใช่ไหม?\n\n- รายการที่แก้ไขจะถูกอัปเดต\n- รายการที่ลบจะหายจากระบบ");
  if (!ok) return;

  setStatus("กำลังบันทึก...");

  const updates = [...state.pendingUpdates.values()].map(x => ({
    id: x.id,
    type: x.type,
    subject_id: x.subject_id,
    start_at: x.start_at,
    end_at: x.end_at,
    title: x.title,
    note: x.note,
  }));

  const deletes = [...state.pendingDeletes.values()].map(x => Number(x));

  if (updates.length || deletes.length){
    await requestJson("/liff/holidays/batch", {
      method:"POST",
      idToken: state.idToken,
      body: { updates, deletes }
    });
  }

  for (const [id, arr] of state.pendingReminderSets.entries()){
    if (state.pendingDeletes.has(String(id))) continue;
    await requestJson("/liff/holidays/reminders/set", {
      method:"POST",
      idToken: state.idToken,
      body: { holiday_id: Number(id), reminders: arr }
    });
  }

  state.pendingUpdates.clear();
  state.pendingDeletes.clear();
  state.pendingReminderSets.clear();

  toast("บันทึกเรียบร้อย ✅", "ok");
  setStatus("");

  await loadRange();

  // ✅ ส่ง Flex ในไลน์ + ปิด LIFF
  try{
    if (window.liff?.isInClient?.()){
      await window.liff.sendMessages([buildEditedFlex()]);
      window.liff.closeWindow();
    } else {
      toast("บันทึกแล้ว ✅ (เปิดใน browser เลยปิดอัตโนมัติไม่ได้)", "ok");
    }
  } catch(e){
    console.error(e);
    try { window.liff.closeWindow(); } catch(_){}
  }
}

// ============================
// ✅ Bind UI
// ============================

function bindUI(){
  $("#reloadBtn").addEventListener("click", () => loadRange().catch(e => toast(e.message,"err")));
  $("#discardBtn").addEventListener("click", discardAll);
  $("#saveAllBtn").addEventListener("click", () => saveAll().catch(e => toast(e.message,"err")));

  $("#mType").addEventListener("change", () => {
    toggleModalByType($("#mType").value);
  });

  $("#mSubject").addEventListener("change", () => {
    const sid = $("#mSubject").value;

    state.allowedDow = null;
    if (sid){
      const allow = state.subjectDowById.get(String(sid));
      state.allowedDow = allow ? new Set([...allow]) : null;
    }

    if (state.allowedDow && state.allowedDow.size){
      const days = [...state.allowedDow].sort().map(i => TH_DOW[i]).join(", ");
      $("#cancelHint").textContent = `เลือกได้เฉพาะ: ${days}`;
    } else {
      $("#cancelHint").textContent = "ไม่พบวันเรียนของวิชานี้ (ยังเลือกวันได้ แต่จะไม่บังคับ)";
    }

    const ymd = $("#mCancelYmd").value;
    if (ymd && state.allowedDow && state.allowedDow.size){
      const dow = ymdDowIdx(ymd);
      if (!state.allowedDow.has(dow)){
        $("#mCancelYmd").value = "";
        $("#cancelDatePill").textContent = "ยังไม่ได้เลือก";
      }
    }

    renderCancelCalendar();
    validateModal();
  });

  $("#calPrev").addEventListener("click", () => {
    const c = state.calCursor || (()=>{ const [y,m]=todayYmd().split("-").map(Number); return {y,m}; })();
    let y=c.y, m=c.m-1;
    if (m<=0){ m=12; y-=1; }
    state.calCursor = {y,m};
    renderCancelCalendar();
  });
  $("#calNext").addEventListener("click", () => {
    const c = state.calCursor || (()=>{ const [y,m]=todayYmd().split("-").map(Number); return {y,m}; })();
    let y=c.y, m=c.m+1;
    if (m>=13){ m=1; y+=1; }
    state.calCursor = {y,m};
    renderCancelCalendar();
  });

  document.addEventListener("click", (e) => {
    const edit = e.target.closest?.("[data-edit]");
    const del = e.target.closest?.("[data-del]");
    const close = e.target.closest?.("[data-close]");

    if (edit){
      openModal(edit.dataset.edit);
      return;
    }
    if (del){
      const id = del.dataset.del;
      const ok = window.confirm("ต้องการลบรายการนี้ใช่ไหม?");
      if (!ok) return;
      state.pendingDeletes.add(String(id));
      state.pendingUpdates.delete(String(id));
      state.pendingReminderSets.delete(String(id));
      toast("ทำเครื่องหมายลบไว้แล้ว ✅", "ok");
      updateCounters();
      renderList();
      return;
    }
    if (close){
      closeModal();
      return;
    }
  });

  $("#mAddRem").addEventListener("click", () => {
    const id = state.currentId;
    if (!id) return;

    const wrap = $("#mRemList");
    if (wrap.querySelector(".empty")) wrap.innerHTML = "";

    const row = document.createElement("div");
    row.className = "remRow";

    const inp = document.createElement("input");
    inp.className = "input";
    inp.type = "text";
    initReminderPicker(inp);

    // default: now + 1 hour (ให้ “เห็น” ว่าเพิ่มแล้ว)
    const now = new Date(Date.now() + 60*60*1000);
    const y = now.getFullYear();
    const m = String(now.getMonth()+1).padStart(2,"0");
    const d = String(now.getDate()).padStart(2,"0");
    const hh = String(now.getHours()).padStart(2,"0");
    const mm = String(Math.round(now.getMinutes()/5)*5).padStart(2,"0");
    const v = `${y}-${m}-${d} ${hh}:${mm}`;
    inp._fp?.setDate(v, true, "Y-m-d H:i");

    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "iconBtn danger";
    btn.title = "ลบเวลาแจ้งเตือน";
    btn.textContent = "🗑️";

    const sync = () => {
      const arr = collectModalReminderValues();
      state.pendingReminderSets.set(String(id), arr);
    };

    inp.addEventListener("change", sync);

    btn.addEventListener("click", () => {
      row.remove();
      sync();
      toast("ลบเวลาแจ้งเตือนแล้ว ✅", "ok");
    });

    row.appendChild(inp);
    row.appendChild(btn);
    wrap.appendChild(row);

    sync();
    toast("เพิ่มเวลาแจ้งเตือนแล้ว ✅", "ok");
  });

  $("#mApply").addEventListener("click", applyModalToPending);
  $("#mDelete").addEventListener("click", () => {
    const ok = window.confirm("ยืนยันลบรายการนี้ใช่ไหม?");
    if (!ok) return;
    markDeleteFromModal();
  });

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && !$("#modal").hidden) closeModal();
  });
}

function relogin(){
  toast("เซสชันหมดอายุ กำลังพาไปล็อกอินใหม่…", "err");
  try { window.liff.logout(); } catch(_){}
  window.liff.login({ redirectUri: location.href });
}

async function main(){
  try{
    setStatus("กำลังเปิดฟอร์ม...");
    const { idToken, profile } = await initLiff();
    if (!idToken) return;

    state.idToken = idToken;

    const userPill = $("#userPill");
    if (userPill) userPill.textContent = profile?.displayName || "คุณ";

    bindUI();
    updateCounters();

    await loadRange();
  } catch(e){
    console.error(e);
    if (e?.code === "IDTOKEN_EXPIRED" || e?.message === "IDTOKEN_EXPIRED"){
      relogin();
      return;
    }
    toast(e?.message || String(e), "err");
    setStatus("");
  }
}

document.addEventListener("DOMContentLoaded", main);