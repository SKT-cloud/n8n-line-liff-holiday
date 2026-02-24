const dayOrder = ["จันทร์","อังคาร","พุธ","พฤหัสบดี","พฤ","ศุกร์","เสาร์","อาทิตย์"];

function dayRank(d){
  const i = dayOrder.indexOf(d);
  return i === -1 ? 999 : i;
}

function escapeHtml(s){
  return String(s ?? "").replace(/[&<>"']/g, m => ({
    "&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#39;",
  }[m]));
}

function fmtTime(t){
  if (!t) return "-";
  const m = String(t).match(/^(\d{2}:\d{2})/);
  return m ? m[1] : String(t);
}

function isoAtStartOfDay(dateStr){
  return `${dateStr}T00:00:00+07:00`;
}
function isoAtEndOfDay(dateStr){
  return `${dateStr}T23:59:59+07:00`;
}

function digits2(v){
  return String(v ?? "").replace(/\D/g, "").slice(0, 2);
}

function wireTimeAutoJump(hhEl, mmEl) {
  if (!hhEl || !mmEl) return;

  hhEl.setAttribute("inputmode", "numeric");
  hhEl.setAttribute("maxlength", "2");
  mmEl.setAttribute("inputmode", "numeric");
  mmEl.setAttribute("maxlength", "2");

  hhEl.addEventListener("input", () => {
    hhEl.value = digits2(hhEl.value);
    if (hhEl.value.length === 2) {
      mmEl.focus();
      mmEl.select?.();
    }
  });

  mmEl.addEventListener("input", () => {
    mmEl.value = digits2(mmEl.value);
  });

  mmEl.addEventListener("keydown", (e) => {
    if (e.key === "Backspace" && (mmEl.value || "").length === 0) {
      hhEl.focus();
      hhEl.select?.();
    }
  });

  // blur แล้วค่อย pad เป็น 2 หลัก (ถ้ามีค่า)
  const pad2 = (el, max) => {
    if (!el.value) return;
    let n = Number(el.value);
    if (!Number.isFinite(n)) { el.value = ""; return; }
    n = Math.max(0, Math.min(max, n));
    el.value = String(n).padStart(2, "0");
  };
  hhEl.addEventListener("blur", () => pad2(hhEl, 23));
  mmEl.addEventListener("blur", () => pad2(mmEl, 59));
}

export function initForm({ el, mode, profile, subjects, onSubmit }) {
  const $ = (id) => el.querySelector(id);

  // Header (ไม่โชว์ badge แล้วใน html, เลยไม่ต้อง set text)
  $("#profileName").textContent = profile?.displayName || "";

  const state = {
    type: "holiday",      // holiday | cancel
    subjectKey: null,     // string key
    reminders: [],        // {date, hh, mm}
  };

  // ===== Subjects (for cancel) =====
  const grouped = new Map();
  for (const s of subjects) {
    const day = s.day || "";
    if (!grouped.has(day)) grouped.set(day, []);
    grouped.get(day).push(s);
  }
  const days = Array.from(grouped.keys()).sort((a,b)=>dayRank(a)-dayRank(b));
  for (const d of days) {
    grouped.get(d).sort((a,b)=>fmtTime(a.start_time).localeCompare(fmtTime(b.start_time)));
  }

  const listEl = $("#subjectList");
  listEl.innerHTML = days.map(day => {
    const cards = grouped.get(day).map(s => {
      const key = `${s.subject_code}|${s.section}|${s.type}|${s.day}|${s.start_time}`;
      const top = `${fmtTime(s.start_time)}–${fmtTime(s.end_time)} • ${escapeHtml(s.room || "-")}`;
      const mid = `${escapeHtml(s.subject_code)} ${escapeHtml(s.type)} • sec ${escapeHtml(s.section)}`;
      const bot = `${escapeHtml(s.subject_name)}`;
      return `
        <button class="subCard" type="button" data-key="${escapeHtml(key)}"
          data-payload='${escapeHtml(JSON.stringify({
            id: s.id,
            subject_code: s.subject_code,
            section: s.section,
            type: s.type,
            day: s.day,
            start_time: s.start_time,
            end_time: s.end_time,
            room: s.room,
            subject_name: s.subject_name,
          }))}'>
          <div class="subTop">${top}</div>
          <div class="subMid">${mid}</div>
          <div class="subBot">${bot}</div>
        </button>
      `;
    }).join("");

    return `
      <section class="dayBlock">
        <div class="dayTitle">${escapeHtml(day)}</div>
        <div class="dayGrid">${cards}</div>
      </section>
    `;
  }).join("");

  // ===== Toggle type =====
  const btnHoliday = $("#btnTypeHoliday");
  const btnCancel = $("#btnTypeCancel");
  const cancelBox = $("#cancelBox");

  function renderType(){
    btnHoliday.classList.toggle("isActive", state.type === "holiday");
    btnCancel.classList.toggle("isActive", state.type === "cancel");
    cancelBox.hidden = state.type !== "cancel";
  }
  btnHoliday.addEventListener("click", () => { state.type = "holiday"; renderType(); });
  btnCancel.addEventListener("click", () => { state.type = "cancel"; renderType(); });
  renderType();

  // ===== Subject selection =====
  function clearSelected(){
    el.querySelectorAll(".subCard.isSelected").forEach(b => b.classList.remove("isSelected"));
  }
  listEl.addEventListener("click", (e) => {
    const btn = e.target.closest(".subCard");
    if (!btn) return;
    clearSelected();
    btn.classList.add("isSelected");
    state.subjectKey = btn.dataset.key;

    const payload = JSON.parse(btn.dataset.payload);
    $("#selectedSubject").textContent = `${payload.subject_code || ""} ${payload.subject_name || ""}`.trim();
  });

  // ===== Reminders UI =====
  const remList = $("#remindersList");
  const addRemBtn = $("#addReminder");

  function renderReminders(){
    if (state.reminders.length === 0) {
      remList.innerHTML = `<div class="hint">ยังไม่มีการตั้งแจ้งเตือน</div>`;
      return;
    }

    remList.innerHTML = state.reminders.map((r, idx) => {
      const safeD = escapeHtml(r.date || "");
      const safeH = escapeHtml(r.hh || "");
      const safeM = escapeHtml(r.mm || "");

      return `
        <div class="remRow" data-idx="${idx}">
          <div class="remNo">#${idx+1}</div>
          <div class="remFields">
            <label class="field">
              <span>วันที่</span>
              <input class="input" type="date" value="${safeD}" data-k="date" />
            </label>

            <label class="field">
              <span>เวลา</span>
              <div class="timeRow">
                <input class="input time" type="text" placeholder="HH" value="${safeH}" data-k="hh" inputmode="numeric" maxlength="2" />
                <span class="timeSep">:</span>
                <input class="input time" type="text" placeholder="MM" value="${safeM}" data-k="mm" inputmode="numeric" maxlength="2" />
              </div>
            </label>
          </div>
          <button type="button" class="btnTiny" data-act="del">ลบ</button>
        </div>
      `;
    }).join("");

    // ✅ หลัง render เสร็จ ค่อย wire auto-jump ให้ทุกแถว
    remList.querySelectorAll(".remRow").forEach((row) => {
      const hh = row.querySelector('[data-k="hh"]');
      const mm = row.querySelector('[data-k="mm"]');
      wireTimeAutoJump(hh, mm);
    });
  }

  addRemBtn.addEventListener("click", () => {
    // ✅ เริ่มเป็นค่าว่างทั้งหมด
    state.reminders.push({ date: "", hh: "", mm: "" });
    renderReminders();
  });

  remList.addEventListener("click", (e) => {
    const row = e.target.closest(".remRow");
    if (!row) return;
    const idx = Number(row.dataset.idx);

    if (e.target?.dataset?.act === "del") {
      state.reminders.splice(idx, 1);
      renderReminders();
    }
  });

  remList.addEventListener("input", (e) => {
    const row = e.target.closest(".remRow");
    if (!row) return;
    const idx = Number(row.dataset.idx);
    const k = e.target.dataset.k;

    if (k === "date") {
      state.reminders[idx].date = e.target.value;
      return;
    }

    if (k === "hh") {
      const v = digits2(e.target.value);
      state.reminders[idx].hh = v;
      e.target.value = v;
      return;
    }

    if (k === "mm") {
      const v = digits2(e.target.value);
      state.reminders[idx].mm = v;
      e.target.value = v;
      return;
    }
  });

  renderReminders();

  // ===== Reset =====
  $("#resetBtn").addEventListener("click", () => {
    $("#title").value = "";
    $("#note").value = "";
    $("#startDate").value = "";
    $("#endDate").value = "";
    state.type = "holiday";
    state.subjectKey = null;
    state.reminders = [];
    $("#selectedSubject").textContent = "-";
    clearSelected();
    renderType();
    renderReminders();
  });

  // ===== Submit =====
  el.addEventListener("submit", async (e) => {
    e.preventDefault();

    const title = $("#title").value.trim();
    const note = $("#note").value.trim();
    const start = $("#startDate").value;
    const end = $("#endDate").value || start;

    if (!start) throw new Error("กรุณาเลือกวันเริ่ม");
    if (state.type === "cancel" && !state.subjectKey) throw new Error("กรุณาเลือกวิชา");

    // Subject payload
    let subject = null;
    if (state.type === "cancel") {
      const selected = el.querySelector(".subCard.isSelected");
      if (selected) subject = JSON.parse(selected.dataset.payload);
    }

    // ✅ reminder time ต้องครบ HH+MM (2 หลัก) ถึงจะส่ง
    const reminders = state.reminders
      .filter(r => r.date && r.hh?.length === 2 && r.mm?.length === 2)
      .map(r => `${r.date}T${r.hh}:${r.mm}:00+07:00`);

    const payload = {
      type: state.type,
      subject_id: state.type === "cancel" ? (subject?.id ?? null) : null,

      // ✅ ตามแนวคิดคุณ: holiday=ทั้งวัน, cancel=ไม่ใช่ทั้งวัน
      all_day: state.type === "holiday" ? 1 : 0,

      start_at: isoAtStartOfDay(start),
      end_at: isoAtEndOfDay(end),

      // ✅ title สำหรับ cancel ถ้าไม่กรอก ให้เป็น "รหัสวิชา ชื่อวิชา"
      title: title ? title : (state.type === "cancel" ? `${subject?.subject_code || ""} ${subject?.subject_name || ""}`.trim() : null),

      note: note || null,
      reminders,
    };

    await onSubmit(payload);
  });
}