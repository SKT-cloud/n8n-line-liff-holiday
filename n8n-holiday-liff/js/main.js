import { CONFIG } from "./config.js";
import { initLiff } from "./auth.js";
import { fetchSubjects, createHoliday } from "./api.js";
import { bindForm } from "./form.js";

const $ = (s) => document.querySelector(s);

function toast(msg, kind = "info") {
  const el = $("#toast");
  if (!el) return;
  el.textContent = msg;
  el.className = `toast ${kind}`;
  el.hidden = false;
  clearTimeout(toast._t);
  toast._t = setTimeout(() => (el.hidden = true), 2800);
}

function setStatus(text) {
  const el = $("#status");
  if (!el) return;
  el.textContent = text || "";
}

function relogin() {
  toast("เซสชันหมดอายุ กำลังพาไปล็อกอินใหม่…", "err");
  try { window.liff.logout(); } catch(_) {}
  window.liff.login({ redirectUri: location.href });
}

function daySort(d){
  const order = ["จันทร์","อังคาร","พุธ","พฤหัสบดี","พฤ","ศุกร์","เสาร์","อาทิตย์","อื่นๆ"];
  const i = order.indexOf(d);
  return i === -1 ? 999 : i;
}

function renderSubjects(items){
  const list = $("#subjectList");
  if (!list) return;

  list.innerHTML = "";
  if (!items.length) {
    list.innerHTML = `<div class="empty">ยังไม่มีข้อมูลวิชาในระบบ 😅</div>`;
    return;
  }

  const grouped = new Map();
  for (const it of items) {
    const day = it.day || "อื่นๆ";
    if (!grouped.has(day)) grouped.set(day, []);
    grouped.get(day).push(it);
  }

  [...grouped.entries()]
    .sort((a,b)=>daySort(a[0]) - daySort(b[0]))
    .forEach(([day, arr]) => {
      arr.sort((a,b) =>
        String(a.start_time||"").localeCompare(String(b.start_time||"")) ||
        String(a.subject_code||"").localeCompare(String(b.subject_code||""))
      );

      const sec = document.createElement("section");
      sec.className = "dayGroup";
      sec.innerHTML = `<div class="dayHead">${day}</div>`;

      const grid = document.createElement("div");
      grid.className = "subGrid";

      for (const s of arr) {
        const payload = {
          subject_code: s.subject_code,
          subject_name: s.subject_name,
          section: s.section,
          type: s.type,
          room: s.room,
          start_time: s.start_time,
          end_time: s.end_time,
          day: s.day,
          semester: s.semester,
          instructor: s.instructor,
        };

        const card = document.createElement("button");
        card.type = "button";
        card.className = "subCard";
        card.dataset.key = `${s.day}|${s.start_time}|${s.subject_code}|${s.section}|${s.type}`;
        card.dataset.payload = JSON.stringify(payload);

        card.innerHTML = `
          <div class="subTime">${(s.start_time||"??:??")}–${(s.end_time||"??:??")}</div>
          <div class="subCode">${s.subject_code || ""} <span class="subType">${s.type || ""}</span></div>
          <div class="subName">${s.subject_name || ""}</div>
          <div class="subMeta">${s.room ? `ห้อง ${s.room}` : ""}</div>
          <div class="subTick">✓</div>
        `;

        grid.appendChild(card);
      }

      sec.appendChild(grid);
      list.appendChild(sec);
    });
}

async function run() {
  try {
    setStatus("กำลังเปิดฟอร์ม...");

    const { idToken, profile } = await initLiff();
    if (!idToken) return; // login redirected

    const userPill = $("#userPill");
    if (userPill) userPill.textContent = profile?.displayName || "คุณ";

    // load subjects
    setStatus("กำลังโหลดตารางวิชา...");
    let items = [];
    try {
      items = await fetchSubjects({ idToken });
    } catch (err) {
      if (err?.code === "IDTOKEN_EXPIRED" || err?.message === "IDTOKEN_EXPIRED") {
        relogin();
        return;
      }
      throw err;
    }

    const subjectsStatus = $("#subjectsStatus");
    if (subjectsStatus) subjectsStatus.textContent = items.length ? `มี ${items.length} รายวิชา` : "ยังไม่มีข้อมูลวิชาในระบบ 😅";
    renderSubjects(items);

    setStatus("");

    bindForm({
      onSubmit: async (payload) => {
        // confirm ก่อนบันทึก
        const ok = window.confirm("ยืนยันการบันทึกใช่ไหม?\n\nกด “ตกลง” เพื่อบันทึก หรือ “ยกเลิก” เพื่อกลับไปแก้ไข");
        if (!ok) return;

        setStatus("กำลังบันทึก...");
        try {
          await createHoliday({ idToken, payload });
        } catch (err) {
          if (err?.code === "IDTOKEN_EXPIRED" || err?.message === "IDTOKEN_EXPIRED") {
            relogin();
            return;
          }
          throw err;
        }

        toast("บันทึกสำเร็จ ✅", "ok");
        setStatus("");

        // close LIFF after save
        try { window.liff.closeWindow(); } catch(_) {}
      },
      onTokenExpired: relogin,
      onError: (err) => {
        console.error(err);
        toast(err?.message || String(err), "err");
        setStatus("");
      }
    });

  } catch (e) {
    console.error(e);
    setStatus("");
    toast(`เปิดฟอร์มไม่สำเร็จ: ${e?.message || e}`, "err");
  }
}

document.addEventListener("DOMContentLoaded", run);