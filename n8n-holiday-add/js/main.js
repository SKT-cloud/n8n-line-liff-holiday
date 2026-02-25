import { initLiff } from "./auth.js";
import { fetchSubjects, submitHolidayToN8n } from "./api.js";
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

function showOverlay(
  kind = "loading",
  title = "กำลังโหลดข้อมูล…",
  desc = "รอสักครู่น้า 🥺✨"
) {
  const ov = $("#overlay");
  const icon = $("#overlayIcon");
  const t = $("#overlayTitle");
  const d = $("#overlayDesc");
  if (!ov || !icon || !t || !d) return;

  // ถ้ากำลัง fade-out อยู่ แล้วมีการเรียก show ใหม่ ให้ยกเลิกสถานะ closing
  ov.classList.remove("closing");

  icon.className = `overlayIcon ${kind}`;
  t.textContent = title;
  d.textContent = desc;

  ov.hidden = false;
  ov.setAttribute("aria-busy", "true");
}

// ซ่อน overlay แบบนุ่ม ๆ (fade-out) เพื่อไม่ให้หายไปเฉย ๆ
function hideOverlay(smooth = true) {
  const ov = $("#overlay");
  if (!ov) return;

  if (!smooth) {
    ov.hidden = true;
    ov.setAttribute("aria-busy", "false");
    return;
  }

  ov.classList.add("closing");

  // รอให้ CSS transition เล่นก่อนค่อยซ่อนจริง
  setTimeout(() => {
    ov.hidden = true;
    ov.classList.remove("closing");
    ov.setAttribute("aria-busy", "false");
  }, 320);
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function setStatus(text) {
  const el = $("#status");
  if (!el) return;
  el.textContent = text || "";
}

function relogin() {
  toast("เซสชันหมดอายุ กำลังพาไปล็อกอินใหม่…", "err");
  try {
    window.liff.logout();
  } catch (_) {}
  window.liff.login({ redirectUri: location.href });
}

function daySort(d) {
  const order = [
    "จันทร์",
    "อังคาร",
    "พุธ",
    "พฤหัสบดี",
    "พฤ",
    "ศุกร์",
    "เสาร์",
    "อาทิตย์",
    "อื่นๆ",
  ];
  const i = order.indexOf(d);
  return i === -1 ? 999 : i;
}

function renderSubjects(items) {
  const list = $("#subjects");
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
    .sort((a, b) => daySort(a[0]) - daySort(b[0]))
    .forEach(([day, arr]) => {
      arr.sort(
        (a, b) =>
          String(a.start_time || "").localeCompare(String(b.start_time || "")) ||
          String(a.subject_code || "").localeCompare(String(b.subject_code || ""))
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
          <div class="subTime">${(s.start_time || "??:??")}–${
          s.end_time || "??:??"
        }</div>
          <div class="subCode">${s.subject_code || ""} <span class="subType">${
          s.type || ""
        }</span></div>
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
    showOverlay("loading", "กำลังโหลดข้อมูล…", "กำลังเชื่อมต่อกับระบบนะคะ ✨");

    const { idToken, profile } = await initLiff();
    if (!idToken) return;

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
      console.error(err);
      showOverlay("err", "โหลดข้อมูลไม่สำเร็จ", "" + (err?.message || String(err)));
      await sleep(1400);
      hideOverlay(true);
      toast(err?.message || String(err), "err");
      items = [];
    }

    const subjectsStatus = $("#subjectsStatus");
    if (subjectsStatus) {
      subjectsStatus.textContent = items.length
        ? `มี ${items.length} รายวิชา`
        : "ยังไม่มีข้อมูลวิชาในระบบ 😅";
    }

    renderSubjects(items);
    setStatus("");

    // ✅ โหลดสำเร็จแบบน่ารัก ๆ ก่อนค่อยหายไป
    showOverlay(
      "ok",
      "โหลดสำเร็จแล้ววว ✨",
      items.length
        ? "พร้อมให้เลือกวันหยุดแล้วค่าา 💖"
        : "ยังไม่มีวิชา แต่เพิ่มวันหยุดทั้งวันได้เลยนะคะ 🌈"
    );
    await sleep(850);
    hideOverlay(true);

    // ✅ จุดสำคัญ: bindForm ต้องไม่วงเล็บพัง (แก้เรียบร้อยแล้ว)
    bindForm({
      onSubmit: async (payload) => {
        // ✅ ส่งให้ n8n ตรวจ/บันทึก/ส่ง flex ก่อน แล้วค่อยปิด LIFF
        showOverlay("loading", "กำลังบันทึก…", "เดี๋ยวแป๊บนึงนะคะ 💫");
        setStatus("กำลังตรวจสอบและบันทึกผ่านระบบ...");

        try {
          await submitHolidayToN8n({
            payload,
            context: {
              userId: profile?.userId,
              displayName: profile?.displayName,
              idToken, // เผื่อ n8n จะใช้ยิง worker แบบ secure
            },
          });

          setStatus("");
          showOverlay(
            "ok",
            "บันทึกเรียบร้อยแล้วค่าา 💖",
            "เดี๋ยวส่งสรุปเข้าไลน์ให้นะคะ ✨"
          );
          await sleep(1200);

          // ทำให้หายไปแบบนุ่ม ๆ ก่อนค่อยปิด LIFF
          hideOverlay(true);
          await sleep(220);

          try {
            window.liff.closeWindow();
          } catch (_) {}
        } catch (err) {
          console.error(err);
          setStatus("");

          const msg = (err?.message || String(err) || "บันทึกไม่สำเร็จ").slice(
            0,
            220
          );
          showOverlay("err", "บันทึกไม่สำเร็จ 😿", msg);
          await sleep(1600);
          hideOverlay(true);

          toast(msg, "err");
          return;
        }
      },

      onTokenExpired: relogin,

      onError: (err) => {
        console.error(err);
        toast(err?.message || String(err), "err");
        setStatus("");
      },
    });
  } catch (e) {
    console.error(e);
    setStatus("");
    try {
      hideOverlay(true);
    } catch (_) {}
    toast(`เปิดฟอร์มไม่สำเร็จ: ${e?.message || e}`, "err");
  }
}

document.addEventListener("DOMContentLoaded", run);