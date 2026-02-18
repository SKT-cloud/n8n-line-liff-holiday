function dayIndex(thDay) {
  const map = {
    "จันทร์": 1,
    "อังคาร": 2,
    "พุธ": 3,
    "พฤหัสบดี": 4,
    "ศุกร์": 5,
    "เสาร์": 6,
    "อาทิตย์": 7
  };
  return map[thDay] ?? 999;
}

function toMinutes(hhmm) {
  if (!hhmm) return 9999;
  const [h, m] = String(hhmm).split(":").map(Number);
  return h * 60 + (m || 0);
}

function clean(s) {
  return String(s ?? "").trim();
}

function makeShortLabel(row) {
  const st = clean(row.start_time) || "--:--";
  const et = clean(row.end_time) || "--:--";
  const code = clean(row.subject_code) || "-";
  const name = clean(row.subject_name) || "-";
  const type = clean(row.type) || "-";
  return `${st}-${et} | ${code} | ${name} | ${type}`;
}

export async function fetchSubjectGroups({ subjectsUrl, userId }) {
  const url = `${subjectsUrl}?user_id=${encodeURIComponent(userId)}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error("โหลดรายชื่อวิชาไม่สำเร็จ");

  const data = await res.json();
  if (Array.isArray(data)) return data;

  // Normalize worker output: sort by day/time and group rows by day.
  if (data && Array.isArray(data.items)) {
    const rows = data.items;
    rows.sort((a, b) => {
      const d = dayIndex(a.day) - dayIndex(b.day);
      if (d !== 0) return d;

      const t = toMinutes(a.start_time) - toMinutes(b.start_time);
      if (t !== 0) return t;

      return String(a.subject_code).localeCompare(String(b.subject_code));
    });

    const groups = new Map();
    for (const row of rows) {
      const day = row.day || "ไม่ระบุวัน";
      if (!groups.has(day)) groups.set(day, []);

      const label = makeShortLabel(row);
      const subject_id = `${row.subject_code}|${row.section}|${row.type}|${row.day}|${row.start_time}`;
      groups.get(day).push({ subject_id, label, meta: row });
    }

    const out = [];
    const dayOrder = ["จันทร์", "อังคาร", "พุธ", "พฤหัสบดี", "ศุกร์", "เสาร์", "อาทิตย์"];
    for (const d of dayOrder) {
      if (groups.has(d)) out.push({ day: d, options: groups.get(d) });
    }

    for (const [day, options] of groups.entries()) {
      if (!dayOrder.includes(day)) out.push({ day, options });
    }

    return out;
  }

  throw new Error("รูปแบบข้อมูลวิชาไม่ถูกต้อง");
}

export async function submitHoliday({ submitUrl, payload }) {
  const res = await fetch(submitUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });

  if (!res.ok) throw new Error("บันทึกไม่สำเร็จ");
  try {
    return await res.json();
  } catch {
    return { ok: true };
  }
}
