import { CONFIG } from "./config.js";

const $ = (s, el=document) => el.querySelector(s);

function pad2(n){ return String(n).padStart(2,"0"); }

function ymdToThai(ymd){
  if (!ymd) return "-";
  const [y,m,d] = String(ymd).split("-");
  if (!y || !m || !d) return "-";
  return `${d}/${m}/${y}`;
}

function thaiDayToJsDow(thai){
  const t = String(thai||"").trim();
  if (t === "อาทิตย์") return 0;
  if (t === "จันทร์") return 1;
  if (t === "อังคาร") return 2;
  if (t === "พุธ") return 3;
  if (t === "พฤ" || t === "พฤหัสบดี") return 4;
  if (t === "ศุกร์") return 5;
  if (t === "เสาร์") return 6;
  return null;
}

function nextDateForDow(targetDow){
  // หา "วันถัดไป" (รวมวันนี้) ตาม targetDow (0-6) ใน timezone local
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const todayDow = today.getDay();
  let add = (targetDow - todayDow + 7) % 7;
  const d = new Date(today);
  d.setDate(d.getDate() + add);
  const yy = d.getFullYear();
  const mm = String(d.getMonth()+1).padStart(2,"0");
  const dd = String(d.getDate()).padStart(2,"0");
  return `${yy}-${mm}-${dd}`;
}

function toIsoAllDayStart(ymd){
  // YYYY-MM-DD -> YYYY-MM-DDT00:00:00+07:00
  return `${ymd}T00:00:00+07:00`;
}
function toIsoAllDayEnd(ymd){
  // YYYY-MM-DD -> YYYY-MM-DDT23:59:59+07:00
  return `${ymd}T23:59:59+07:00`;
}

function clampTime(h, m){
  let hh = Number(h);
  let mm = Number(m);
  if (!Number.isFinite(hh)) hh = 0;
  if (!Number.isFinite(mm)) mm = 0;
  hh = Math.max(0, Math.min(23, hh));
  mm = Math.max(0, Math.min(59, mm));
  return [pad2(hh), pad2(mm)];
}

function isYmd(s){
  return typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s);
}

function ymdToDate(ymd){
  const [y,m,d] = ymd.split("-").map(Number);
  return new Date(y, m-1, d);
}

function toast(msg, kind="info"){
  const el = $("#toast");
  if (!el) return;
  el.textContent = msg;
  el.className = `toast ${kind}`;
  el.hidden = false;
  clearTimeout(toast._t);
  toast._t = setTimeout(()=> el.hidden = true, 2800);
}

export function bindForm({ onSubmit, onTokenExpired, onError }){
  const form = $("#holidayForm");
  const typeHolidayBtn = $("#typeHoliday");
  const typeCancelBtn  = $("#typeCancel");
  const cancelBox      = $("#cancelBox");
  const cancelHint     = $("#cancelHint");

  const titleEl = $("#title");
  const noteEl = $("#note");
  const startEl = $("#startDate");
  const endEl = $("#endDate");
  const startPreview = $("#startPreview");
  const endPreview   = $("#endPreview");

  const selectedSubjectEl = $("#selectedSubject");
  const remindersWrap = $("#reminders");
  const addReminderBtn = $("#addReminder");
  const resetBtn = $("#resetBtn");

  const state = {
    type: "holiday",
    subjectKey: null,
    subjectPayload: null,
    subjectDay: null,
    reminders: [], // { ymd, hh, mm }
  };

  function setType(next){
    state.type = next;
    const isHoliday = next === "holiday";

    typeHolidayBtn.classList.toggle("isActive", isHoliday);
    typeCancelBtn.classList.toggle("isActive", !isHoliday);

    typeHolidayBtn.setAttribute("aria-selected", isHoliday ? "true":"false");
    typeCancelBtn.setAttribute("aria-selected", !isHoliday ? "true":"false");

    if (cancelBox) cancelBox.hidden = isHoliday;
    if (cancelHint) cancelHint.style.display = isHoliday ? "none":"block";

    // reset subject on switching back to holiday
    if (isHoliday) {
      state.subjectKey = null;
      state.subjectPayload = null;
      state.subjectDay = null;
      if (selectedSubjectEl) selectedSubjectEl.textContent = "-";
      document.querySelectorAll(".subCard.isSelected").forEach((el)=> el.classList.remove("isSelected"));
    }

    // re-validate date if cancel + already chosen
    enforceCancelDayConstraint();
  }

  typeHolidayBtn?.addEventListener("click", ()=> setType("holiday"));
  typeCancelBtn?.addEventListener("click", ()=> setType("cancel"));

  function updatePreview(){
    if (startPreview) startPreview.textContent = startEl?.value ? ymdToThai(startEl.value) : "-";
    if (endPreview) endPreview.textContent = endEl?.value ? ymdToThai(endEl.value) : "-";
  }
  startEl?.addEventListener("change", ()=>{ updatePreview(); enforceCancelDayConstraint(); });
  endEl?.addEventListener("change", ()=>{ updatePreview(); enforceCancelDayConstraint(); });
  updatePreview();

  function enforceCancelDayConstraint(){
    if (state.type !== "cancel") return;

    const allowDow = thaiDayToJsDow(state.subjectDay);
    if (allowDow === null) return;

    const check = (el, label)=>{
      if (!el?.value) return;
      if (!isYmd(el.value)) return;
      const dow = ymdToDate(el.value).getDay();
      if (dow !== allowDow) {
        toast(`วันที่ที่เลือกไม่ตรงวันเรียน (${state.subjectDay}) — กรุณาเลือกใหม่`, "err");
        el.value = "";
        updatePreview();
      }
    };

    check(startEl, "วันเริ่ม");
    check(endEl, "วันสุดท้าย");
  }

  // Subject selection (cards)
  document.addEventListener("click", (e)=>{
    const btn = e.target?.closest?.(".subCard");
    if (!btn) return;

    document.querySelectorAll(".subCard.isSelected").forEach((el)=> el.classList.remove("isSelected"));
    btn.classList.add("isSelected");

    state.subjectKey = btn.dataset.key;
    state.subjectPayload = JSON.parse(btn.dataset.payload || "{}");
    state.subjectDay = state.subjectPayload?.day || null;

    if (selectedSubjectEl) {
      const sc = state.subjectPayload?.subject_code || "";
      const sn = state.subjectPayload?.subject_name || "";
      selectedSubjectEl.textContent = `${sc} ${sn}`.trim() || "-";
    }

    // ถ้าเป็นยกคลาสและยังไม่เลือกวันเริ่มไว้: auto-suggest วันถัดไปที่ตรงกับวันเรียน (ช่วยให้เลือกง่ายบนมือถือ)
    if (state.type === "cancel" && state.subjectDay && startEl && !startEl.value) {
      const allow = thaiDayToJsDow(state.subjectDay);
      if (allow !== null) {
        startEl.value = nextDateForDow(allow);
        updatePreview();
      }
    }

    // ถ้าเลือกวิชาแล้ว แนะนำให้สลับเป็น cancel อัตโนมัติ (optional)
    if (state.type !== "cancel") {
      setType("cancel");
    }

    enforceCancelDayConstraint();
  });

  function renderReminders(){
    if (!remindersWrap) return;
    remindersWrap.innerHTML = "";

    if (!state.reminders.length){
      remindersWrap.innerHTML = `<div class="empty">ยังไม่มีการตั้งแจ้งเตือน</div>`;
      return;
    }

    state.reminders.forEach((r, idx)=>{
      const card = document.createElement("div");
      card.className = "remCard";

      card.innerHTML = `
        <div class="remGrid">
          <div class="remNo">#${idx+1}</div>

          <div>
            <div class="mini">วันที่</div>
            <input class="input" type="date" data-k="ymd" value="${r.ymd || ""}" />
          </div>

          <div>
            <div class="mini">เวลา</div>
            <div class="timePill">
              <input class="timeInput" inputmode="numeric" maxlength="2" placeholder="HH" data-k="hh" value="${r.hh || ""}" />
              <span class="timeColon">:</span>
              <input class="timeInput" inputmode="numeric" maxlength="2" placeholder="MM" data-k="mm" value="${r.mm || ""}" />
            </div>
            <div class="help">พิมพ์ชั่วโมงครบ 2 ตัว จะเด้งไปช่องนาที</div>
          </div>

          <button type="button" class="btnDanger remDel">ลบ</button>
        </div>
      `;

      // bindings
      const ymdEl = card.querySelector('[data-k="ymd"]');
      const hhEl = card.querySelector('[data-k="hh"]');
      const mmEl = card.querySelector('[data-k="mm"]');
      const delBtn = card.querySelector(".remDel");

      ymdEl?.addEventListener("change", ()=>{
        state.reminders[idx].ymd = ymdEl.value;
      });

      const onTimeInput = ()=>{
        let hh = (hhEl?.value || "").replace(/\D/g,"").slice(0,2);
        let mm = (mmEl?.value || "").replace(/\D/g,"").slice(0,2);
        if (hhEl) hhEl.value = hh;
        if (mmEl) mmEl.value = mm;

        state.reminders[idx].hh = hh;
        state.reminders[idx].mm = mm;

        // auto jump: กรอก HH ครบ 2 ตัว -> ไป MM
        if (hh.length >= 2 && document.activeElement === hhEl) {
          mmEl?.focus();
        }
      };

      hhEl?.addEventListener("input", onTimeInput);
      mmEl?.addEventListener("input", onTimeInput);

      delBtn?.addEventListener("click", ()=>{
        state.reminders.splice(idx,1);
        renderReminders();
      });

      remindersWrap.appendChild(card);
    });
  }

  addReminderBtn?.addEventListener("click", ()=>{
    state.reminders.push({ ymd: "", hh: "", mm: "" });
    renderReminders();
  });

  resetBtn?.addEventListener("click", ()=>{
    titleEl.value = "";
    noteEl.value = "";
    startEl.value = "";
    endEl.value = "";
    state.reminders = [];
    updatePreview();
    renderReminders();
    toast("ล้างฟอร์มแล้ว", "ok");
  });

  renderReminders();

  form?.addEventListener("submit", async (e)=>{
    e.preventDefault();

    try {
      const title = (titleEl?.value || "").trim() || null;
      const note = (noteEl?.value || "").trim() || null;

      const startYmd = startEl?.value || "";
      const endYmd = endEl?.value || "";

      if (!isYmd(startYmd)) {
        toast("กรุณาเลือกวันเริ่ม", "err");
        return;
      }

      const finalEnd = isYmd(endYmd) ? endYmd : startYmd;

      // type cancel ต้องเลือกวิชา
      let subject_id = null;
      let finalTitle = title;

      if (state.type === "cancel") {
        if (!state.subjectPayload?.subject_code) {
          toast("กรุณาเลือกวิชา (สำหรับยกคลาส)", "err");
          return;
        }

        // subject_id ใน DB คุณใช้เป็น string/โค้ดได้ (ตาม worker รับ subject_id nullable)
        subject_id = state.subjectPayload.subject_code;

        // ถ้า title ว่าง ให้เป็น "รหัส + ชื่อ" (แก้ปัญหา title หาย)
        if (!finalTitle) {
          const sc = state.subjectPayload.subject_code || "";
          const sn = state.subjectPayload.subject_name || "";
          finalTitle = `${sc} ${sn}`.trim() || "ยกคลาส";
        }
      }

      // reminders -> ISO list
      const reminders = [];
      for (const r of state.reminders) {
        if (!isYmd(r.ymd)) continue;
        const [hh, mm] = clampTime(r.hh, r.mm);
        reminders.push(`${r.ymd}T${hh}:${mm}:00+07:00`);
      }

      const payload = {
        type: state.type,
        subject_id,
        all_day: 1, // โครงสร้างเดิมของคุณ (cancel/holiday เป็น all_day=1 เพื่อคุมการแสดงผลตาราง)
        start_at: toIsoAllDayStart(startYmd),
        end_at: toIsoAllDayEnd(finalEnd),
        title: finalTitle,
        note,
        reminders,
      };

      await onSubmit(payload);

    } catch (err) {
      if (err?.code === "IDTOKEN_EXPIRED" || err?.message === "IDTOKEN_EXPIRED") {
        onTokenExpired?.();
        return;
      }
      onError?.(err);
    }
  });
}