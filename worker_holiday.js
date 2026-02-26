// worker.js — Cloudflare Worker (D1) for Holiday + Reminders (LIFF secure + internal API_KEY)
// ✅ Mode A: ให้ LIFF ดึงรายชื่อวิชา + บันทึกวันหยุด/ยกคลาส ผ่าน Worker โดยตรง
// - LIFF secure endpoints (ใช้ LINE token):
//    GET  /liff/subjects
//    POST /liff/holidays/create
//    GET  /liff/holidays/list?from=...&to=...
//    POST /liff/holidays/update
//    POST /liff/holidays/delete
//    POST /liff/holidays/batch
//    GET  /liff/holidays/reminders/list?holiday_id=...
//    POST /liff/holidays/reminders/set { holiday_id, reminders:[{remind_at}|{days_before,time}|"..."] }
//
// - Internal endpoints (ใช้ API_KEY) สำหรับระบบหลังบ้าน / n8n:
//    GET  /subjects?user_id=...
//    POST /holidays (add) + reminders
//    POST /holidays/reminders/add
//    GET  /holidays/list?user_id=...&from=...&to=...
//    POST /holidays/delete
//
// ✅ Cron: ส่งแจ้งเตือน (reminders) ตามเวลา

function requireAuth(request, env) {
  const auth = request.headers.get("Authorization") || "";
  return auth === `Bearer ${env.API_KEY}`;
}

function jsonError(msg, status = 400) {
  return Response.json({ ok: false, error: msg }, { status });
}

// ✅ structured error with code (for UX)
function jsonErrorCode(code, msg, status = 400) {
  return Response.json({ ok: false, code, error: msg }, { status });
}

function isIsoLike(s) {
  return typeof s === "string" && s.length >= 10;
}

function isHHMM(s) {
  return typeof s === "string" && /^\d{2}:\d{2}$/.test(s);
}

function toInt(v, def = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? n : def;
}

// keep output timezone consistent with your app
const TZ = "+07:00";

/** Expand date-only range (YYYY-MM-DD) to full ISO with time in +07:00
 * - from: YYYY-MM-DD -> YYYY-MM-DDT00:00:00+07:00
 * - to  : YYYY-MM-DD -> YYYY-MM-DDT23:59:59+07:00
 */
function normalizeRangeIso(from, to) {
  const f = (typeof from === "string" && from.length === 10) ? `${from}T00:00:00${TZ}` : from;
  const t = (typeof to === "string" && to.length === 10) ? `${to}T23:59:59${TZ}` : to;
  return { from: f, to: t };
}

/* =========================
   ✅ CORS (สำหรับ LIFF)
   ========================= */
function corsHeaders(request) {
  const origin = request.headers.get("Origin") || "*";
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Access-Control-Allow-Credentials": "true",
    Vary: "Origin",
  };
}

function withCors(request, res) {
  const h = new Headers(res.headers);
  const cors = corsHeaders(request);
  for (const [k, v] of Object.entries(cors)) h.set(k, v);
  return new Response(res.body, { status: res.status, headers: h });
}

/* =========================
   ✅ LIFF token -> userId (FIX)
   - try access token via /v2/profile first
   - fallback to idToken verify via /oauth2/v2.1/verify
   ========================= */
async function getUserIdFromLiffToken(request, env) {
  const auth = request.headers.get("Authorization") || "";
  const m = auth.match(/^Bearer\s+(.+)$/i);
  if (!m) throw new Error("missing bearer token");

  const token = m[1].trim();
  if (!token) throw new Error("missing token");

  // ✅ 1) access token via /v2/profile
  try {
    const res = await fetch("https://api.line.me/v2/profile", {
      method: "GET",
      headers: { Authorization: `Bearer ${token}` },
    });

    const data = await res.json().catch(() => ({}));
    if (res.ok && data && data.userId) {
      return data.userId;
    }
  } catch (_) {
    // ignore -> fallback
  }

  // ✅ 2) fallback: idToken verify
  const client_id = env.LINE_LOGIN_CHANNEL_ID;
  if (!client_id) throw new Error("missing LINE_LOGIN_CHANNEL_ID");

  const res = await fetch("https://api.line.me/oauth2/v2.1/verify", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ id_token: token, client_id }),
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = data?.error_description || data?.error || `verify failed ${res.status}`;
    throw new Error(msg);
  }

  if (!data.sub) throw new Error("verify ok but missing sub");
  return data.sub;
}

/* =========================
   ✅ Title/All-day normalization helpers
   ========================= */
function normalizeAllDayByType(type, all_day) {
  if (type === "holiday") return 1;
  if (type === "cancel") return 0;
  return Number(all_day) ? 1 : 0;
}

function cleanTitle(v) {
  if (v === null || v === undefined) return null;
  const t = String(v).trim();
  return t ? t : null;
}

async function ensureTitle(env, userId, type, subject_id, title) {
  const cleaned = cleanTitle(title);
  if (cleaned) return cleaned;

  if (type === "cancel") {
    if (subject_id) {
      const sub = await env.DB.prepare(
        `SELECT subject_code, subject_name
         FROM subjects
         WHERE user_id = ? AND id = ?
         LIMIT 1`
      ).bind(userId, subject_id).first();

      if (sub) {
        const full = `${sub.subject_code || ""} ${sub.subject_name || ""}`.trim();
        return full || "ยกคลาส";
      }
    }
    return "ยกคลาส";
  }

  return cleaned;
}


// ✅ Duplicate message (cancel) — friendly UX
function buildDuplicateCancelMessage(title, start_at) {
  const ymd = (String(start_at || "").slice(0, 10)) || "";
  const d = ymdToThaiShort(ymd);
  const t = (title && String(title).trim()) ? String(title).trim() : "(ไม่ทราบชื่อวิชา)";
  return `อุ๊ย~ รายการยกคลาสนี้มีอยู่แล้วนะคะ 🥺✨\n${t} ${d}`;
}

function computeRemindAtFromStart(start_at, days_before, timeHHMM) {
  if (!isIsoLike(start_at)) throw new Error("invalid start_at");
  if (!isHHMM(timeHHMM)) throw new Error("invalid time");
  const days = toInt(days_before, 0);

  const datePart = String(start_at).slice(0, 10);
  const [y, m, d] = datePart.split("-").map((x) => Number(x));
  if (!y || !m || !d) throw new Error("invalid start_at date");

  const base = new Date(Date.UTC(y, m - 1, d, 0, 0, 0));
  base.setUTCDate(base.getUTCDate() - days);

  const yy = base.getUTCFullYear();
  const mm = String(base.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(base.getUTCDate()).padStart(2, "0");

  return `${yy}-${mm}-${dd}T${timeHHMM}:00${TZ}`;
}

function resolveRemindAt(item, start_at) {
  if (typeof item === "string") {
    if (!isIsoLike(item)) throw new Error("invalid remind_at");
    return item;
  }

  if (item && typeof item === "object") {
    if (isIsoLike(item.remind_at)) return item.remind_at;
    if (item.days_before !== undefined && isHHMM(item.time)) {
      return computeRemindAtFromStart(start_at, item.days_before, item.time);
    }
  }

  throw new Error("invalid reminder item");
}

function isoLessOrEqual(a, b) {
  return String(a) <= String(b);
}

function nowBangkokIsoLike() {
  const now = new Date();
  const ms = now.getTime() + 7 * 60 * 60 * 1000;
  const d = new Date(ms);

  const yy = d.getUTCFullYear();
  const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(d.getUTCDate()).padStart(2, "0");
  const hh = String(d.getUTCHours()).padStart(2, "0");
  const mi = String(d.getUTCMinutes()).padStart(2, "0");
  const ss = String(d.getUTCSeconds()).padStart(2, "0");

  return `${yy}-${mm}-${dd}T${hh}:${mi}:${ss}${TZ}`;
}


function todayYMD() {
  return new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Bangkok" }); // YYYY-MM-DD
}
function ymdToUTCNoon(ymd) {
  const [Y, M, D] = String(ymd).split("-").map(Number);
  return new Date(Date.UTC(Y, M - 1, D, 12, 0, 0));
}
function addDaysYMD(ymd, n) {
  const dt = ymdToUTCNoon(ymd);
  dt.setUTCDate(dt.getUTCDate() + n);
  return dt.toISOString().slice(0, 10);
}
const TH_WEEKDAY = ["อาทิตย์","จันทร์","อังคาร","พุธ","พฤหัสบดี","ศุกร์","เสาร์"];
function weekdayThaiFromYMD(ymd) {
  const dt = ymdToUTCNoon(ymd);
  return TH_WEEKDAY[dt.getUTCDay()] || null;
}
function weekStartMondayYMD(ymd) {
  const dt = ymdToUTCNoon(ymd);
  const jsDay = dt.getUTCDay();        // 0=Sun..6=Sat
  const mondayBased = (jsDay + 6) % 7; // Mon=0..Sun=6
  return addDaysYMD(ymd, -mondayBased);
}
function normUpper(v) {
  return String(v ?? "").trim().toUpperCase();
}
/* =========================
   ✅ LINE Push + Cron Sender
   ========================= */
async function linePush(env, to, messages) {
  const token = env.LINE_CHANNEL_ACCESS_TOKEN;
  if (!token) throw new Error("missing LINE_CHANNEL_ACCESS_TOKEN");

  if (!Array.isArray(messages) || messages.length === 0) {
    throw new Error("messages must be non-empty array");
  }

  const res = await fetch("https://api.line.me/v2/bot/message/push", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ to, messages }),
  });

  if (!res.ok) {
    const t = await res.text().catch(() => "");
    throw new Error(`LINE push failed: ${res.status} ${t}`);
  }
}

function ymdToThai(ymd) {
  if (!ymd) return "-";
  const [y, m, d] = String(ymd).split("-");
  if (!y || !m || !d) return "-";
  return `${d}/${m}/${y}`;
}

// ✅ Thai short date: "3มี.ค." (no year)
const TH_MONTH_SHORT = ["ม.ค.","ก.พ.","มี.ค.","เม.ย.","พ.ค.","มิ.ย.","ก.ค.","ส.ค.","ก.ย.","ต.ค.","พ.ย.","ธ.ค."];
function ymdToThaiShort(ymd) {
  if (!ymd) return "-";
  const [Y, M, D] = String(ymd).slice(0,10).split("-").map((x) => Number(x));
  if (!Y || !M || !D) return "-";
  const m = TH_MONTH_SHORT[M - 1] || "";
  return `${D}${m}`;
}

function isoToThaiDateTime(iso) {
  if (!iso || typeof iso !== "string") return "-";
  const ymd = iso.slice(0, 10);
  const hhmm = iso.slice(11, 16);
  return `${ymdToThai(ymd)} ${hhmm} น.`;
}
/**
 * ✅ Reminder message (text) — no Flex
 */
function buildReminderText(row) {
  const remindAt = isoToThaiDateTime(row.remind_at);
  const ymd = (row.h_start_at || "").slice(0, 10);
  const day = ymd ? ymdToThai(ymd) : "-";

  const typeText =
    row.h_type === "cancel" ? "🚫 ยกคลาส" :
    row.h_type === "holiday" ? "🏝️ วันหยุด" :
    "⏰ แจ้งเตือน";

  const title =
    row.h_title && String(row.h_title).trim()
      ? String(row.h_title).trim()
      : (row.h_type === "cancel" ? "ยกคลาส" : "วันหยุด");

  // โทน: น่ารัก สดใส อ่านง่าย
  return [
    `${typeText} ใกล้ถึงแล้วน้า ✨`,
    `วันที่: ${day}`,
    `เวลาแจ้งเตือน: ${remindAt}`,
    title ? `เหตุผล: ${title}` : null,
    `อย่าลืมเช็กตารางอีกทีน้า 😊`
  ].filter(Boolean).join("\n");
}


/**
 * ✅ Flex แจ้งเตือน (cron)
 */

/**
 * ✅ Flex ยืนยัน “สร้าง” สำเร็จ
 */

/**
 * ✅ NEW: Flex ยืนยัน “แก้ไข” สำเร็จ (สดใส + ปุ่มดูวันหยุด)
 */

async function processDueReminders(env) {
  const nowIso = nowBangkokIsoLike();

  const due = await env.DB.prepare(`
    SELECT
      r.id AS r_id,
      r.user_id AS r_user_id,
      r.holiday_id AS r_holiday_id,
      r.remind_at AS remind_at,

      h.type AS h_type,
      h.title AS h_title,
      h.start_at AS h_start_at,
      h.end_at AS h_end_at
    FROM reminders r
    LEFT JOIN holidays h ON h.id = r.holiday_id
    WHERE r.status = 'pending'
      AND r.remind_at <= ?
    ORDER BY r.remind_at ASC
    LIMIT 30
  `).bind(nowIso).all();

  const rows = due?.results || [];
  if (rows.length === 0) return { ok: true, sent: 0 };

  let sent = 0;

  for (const row of rows) {
    const reminderId = row.r_id;

    try {
      const lock = await env.DB.prepare(`
        UPDATE reminders
        SET status = 'sending'
        WHERE id = ? AND status = 'pending'
      `).bind(reminderId).run();

      if ((lock?.meta?.changes ?? 0) !== 1) continue;

      const msgText = buildReminderText(row);
      await linePush(env, row.r_user_id, [{ type: "text", text: msgText }]);

      await env.DB.prepare(`
        UPDATE reminders
        SET status = 'sent',
            sent_at = datetime('now')
        WHERE id = ?
      `).bind(reminderId).run();

      sent++;
    } catch (e) {
      console.error("send reminder failed", reminderId, e);

      await env.DB.prepare(`
        UPDATE reminders
        SET status = 'failed',
            sent_at = datetime('now')
        WHERE id = ?
      `).bind(reminderId).run();
    }
  }

  return { ok: true, sent };
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders(request) });
    }

    if (url.pathname === "/health") {
      return withCors(request, Response.json({ ok: true }));
    }

    /* =========================
       ✅ LIFF secure endpoints
       ========================= */

    if (url.pathname === "/liff/subjects" && request.method === "GET") {
      try {
        const userId = await getUserIdFromLiffToken(request, env);

        const { results } = await env.DB.prepare(
          `SELECT
             id,
             day,
             start_time,
             end_time,
             room,
             subject_code,
             subject_name,
             section,
             type,
             instructor,
             semester
           FROM subjects
           WHERE user_id = ?
           ORDER BY
             CASE day
               WHEN 'จันทร์' THEN 1
               WHEN 'อังคาร' THEN 2
               WHEN 'พุธ' THEN 3
               WHEN 'พฤ' THEN 4
               WHEN 'พฤหัสบดี' THEN 4
               WHEN 'ศุกร์' THEN 5
               WHEN 'เสาร์' THEN 6
               WHEN 'อาทิตย์' THEN 7
               ELSE 99
             END,
             start_time, subject_code, section, type`
        ).bind(userId).all();

        return withCors(request, Response.json({ ok: true, items: results || [] }));
      } catch (e) {
        return withCors(request, jsonError(String(e.message || e), 401));
      }
    }

    if (url.pathname === "/liff/holidays/create" && request.method === "POST") {
      try {
        const userId = await getUserIdFromLiffToken(request, env);
        const body = await request.json().catch(() => null);
        if (!body) return withCors(request, jsonError("invalid json"));

        const {
          type,
          subject_id,
          all_day = 1,
          start_at,
          end_at,
          title = null,
          note = null,
          reminders = [],
        } = body;

        if (!["holiday", "cancel"].includes(type)) return withCors(request, jsonError("invalid type"));
        if (!isIsoLike(start_at) || !isIsoLike(end_at)) return withCors(request, jsonError("missing/invalid start_at or end_at"));

        const normalizedAllDay = normalizeAllDayByType(type, all_day);
        const finalTitle = await ensureTitle(env, userId, type, subject_id ?? null, title);

        // DUPLICATE_CANCEL_LIFF_CREATE
        if (type === "cancel") {
          const ymd = String(start_at).slice(0, 10);
          const exists = await env.DB.prepare(
            `SELECT id, title FROM holidays
             WHERE user_id = ?
               AND type = 'cancel'
               AND subject_id = ?
               AND substr(start_at, 1, 10) = ?
             LIMIT 1`
          ).bind(userId, subject_id ?? null, ymd).first();

          if (exists) {
            const msg = buildDuplicateCancelMessage(exists.title || finalTitle, start_at);
            return withCors(request, jsonErrorCode("DUPLICATE", msg, 409));
          }
        }

        const ins = await env.DB.prepare(
          `INSERT INTO holidays (user_id, type, subject_id, all_day, start_at, end_at, title, note, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))`
        ).bind(
          userId,
          type,
          subject_id ?? null,
          normalizedAllDay,
          start_at,
          end_at,
          finalTitle,
          note ?? null
        ).run();

        const holidayId = ins.meta?.last_row_id;

        let reminders_created = 0;
        let reminders_skipped = 0;

        if (holidayId && Array.isArray(reminders) && reminders.length > 0) {
          const stmt = env.DB.prepare(
            `INSERT INTO reminders (user_id, holiday_id, remind_at, status, created_at)
             VALUES (?, ?, ?, 'pending', datetime('now'))`
          );

          const nowIso = nowBangkokIsoLike();
          const uniq = new Set();

          for (const r of reminders) {
            try {
              const remindAt = resolveRemindAt(r, start_at);
              if (isoLessOrEqual(remindAt, nowIso)) { reminders_skipped++; continue; }
              uniq.add(remindAt);
            } catch {
              reminders_skipped++;
            }
          }

          for (const iso of Array.from(uniq).sort()) {
            await stmt.bind(userId, holidayId, iso).run();
            reminders_created++;
          }
        }

        return withCors(request, Response.json({
          ok: true,
          id: holidayId,
          all_day: normalizedAllDay,
          title: finalTitle,
          reminders_created,
          reminders_skipped,
        }));
      } catch (e) {
        return withCors(request, jsonError(String(e.message || e), 401));
      }
    }

    if (url.pathname === "/liff/holidays/list" && request.method === "GET") {
      try {
        const userId = await getUserIdFromLiffToken(request, env);

        const rawFrom = url.searchParams.get("from");
        const rawTo = url.searchParams.get("to");
        const { from, to } = normalizeRangeIso(rawFrom, rawTo);
        if (!isIsoLike(from) || !isIsoLike(to)) {
          return withCors(request, jsonError("missing/invalid from or to"));
        }

        const { results } = await env.DB.prepare(
          `SELECT *
           FROM holidays
           WHERE user_id = ?
             AND start_at <= ?
             AND end_at >= ?
           ORDER BY start_at ASC`
        ).bind(userId, to, from).all();

        return withCors(request, Response.json({ ok: true, items: results || [] }));
      } catch (e) {
        return withCors(request, jsonError(String(e.message || e), 401));
      }
    }

    if (url.pathname === "/liff/holidays/reminders/list" && request.method === "GET") {
      try {
        const userId = await getUserIdFromLiffToken(request, env);
        const holidayId = url.searchParams.get("holiday_id");
        if (!holidayId) return withCors(request, jsonError("missing holiday_id"));

        const h = await env.DB.prepare(`
          SELECT id
          FROM holidays
          WHERE id = ? AND user_id = ?
        `).bind(holidayId, userId).first();

        if (!h) return withCors(request, jsonError("holiday not found", 404));

        const { results } = await env.DB.prepare(`
          SELECT id, holiday_id, remind_at, status, created_at, sent_at
          FROM reminders
          WHERE holiday_id = ? AND user_id = ?
          ORDER BY remind_at ASC
        `).bind(holidayId, userId).all();

        return withCors(request, Response.json({ ok: true, items: results || [] }));
      } catch (e) {
        return withCors(request, jsonError(String(e.message || e), 401));
      }
    }

    // ✅ UPDATE: แก้ไขแล้ว push เข้าไลน์ด้วย
    if (url.pathname === "/liff/holidays/update" && request.method === "POST") {
      try {
        const userId = await getUserIdFromLiffToken(request, env);
        const body = await request.json().catch(() => null);
        if (!body) return withCors(request, jsonError("invalid json"));

        const { id } = body;
        if (!id) return withCors(request, jsonError("missing id"));

        const cur = await env.DB.prepare(
          `SELECT id, user_id, type, subject_id, all_day, start_at, end_at, title, note
           FROM holidays
           WHERE id = ? AND user_id = ?`
        ).bind(id, userId).first();

        if (!cur) return withCors(request, jsonError("not found", 404));

        const nextStart = body.start_at !== undefined ? body.start_at : cur.start_at;
        const nextEnd   = body.end_at   !== undefined ? body.end_at   : cur.end_at;
        const nextNote  = body.note     !== undefined ? body.note     : cur.note;
        const nextSubjectId = body.subject_id !== undefined ? body.subject_id : cur.subject_id;

        if (!isIsoLike(nextStart) || !isIsoLike(nextEnd)) {
          return withCors(request, jsonError("invalid start_at/end_at"));
        }

        const wantedTitle = body.title !== undefined ? body.title : cur.title;
        const finalTitle = await ensureTitle(env, userId, cur.type, nextSubjectId ?? null, wantedTitle);
        const normalizedAllDay = normalizeAllDayByType(cur.type, cur.all_day);

        const upd = await env.DB.prepare(`
          UPDATE holidays
          SET
            subject_id = ?,
            all_day = ?,
            start_at = ?,
            end_at   = ?,
            title    = ?,
            note     = ?,
            updated_at = datetime('now')
          WHERE id = ? AND user_id = ?
        `).bind(
          nextSubjectId ?? null,
          normalizedAllDay,
          nextStart,
          nextEnd,
          finalTitle,
          (nextNote ?? null),
          id,
          userId
        ).run();

        const changes = upd.meta?.changes ?? 0;
        if (changes === 0) return withCors(request, jsonError("not found", 404));

        // ✅ NEW: push “แก้ไขเรียบร้อยแล้ว”

        return withCors(request, Response.json({ ok: true, title: finalTitle, all_day: normalizedAllDay }));
      } catch (e) {
        return withCors(request, jsonError(String(e.message || e), 401));
      }
    }

    // ✅ SET REMINDERS: เซ็ตเสร็จแล้ว push ได้ด้วย (กันเคสแก้เฉพาะแจ้งเตือน)
    if (url.pathname === "/liff/holidays/reminders/set" && request.method === "POST") {
      try {
        const userId = await getUserIdFromLiffToken(request, env);
        const body = await request.json().catch(() => null);
        if (!body) return withCors(request, jsonError("invalid json"));

        const holidayId = body.holiday_id;
        const reminders = Array.isArray(body.reminders) ? body.reminders : [];

        if (!holidayId) return withCors(request, jsonError("missing holiday_id"));

        const h = await env.DB.prepare(`
          SELECT id, type, title, start_at, end_at
          FROM holidays
          WHERE id = ? AND user_id = ?
        `).bind(holidayId, userId).first();

        if (!h) return withCors(request, jsonError("holiday not found", 404));

        const start_at = h.start_at;
        if (!isIsoLike(start_at)) return withCors(request, jsonError("holiday start_at invalid", 500));

        const nowIso = nowBangkokIsoLike();
        const uniq = new Set();
        let skipped = 0;

        for (const r of reminders) {
          try {
            const remindAt = resolveRemindAt(r, start_at);
            if (isoLessOrEqual(remindAt, nowIso)) { skipped++; continue; }
            uniq.add(remindAt);
          } catch {
            skipped++;
          }
        }

        const list = Array.from(uniq).sort();

        const stmts = [];
        stmts.push(env.DB.prepare(`
          DELETE FROM reminders
          WHERE holiday_id = ? AND user_id = ? AND status = 'pending'
        `).bind(holidayId, userId));

        for (const iso of list) {
          stmts.push(env.DB.prepare(`
            INSERT INTO reminders (user_id, holiday_id, remind_at, status, created_at)
            VALUES (?, ?, ?, 'pending', datetime('now'))
          `).bind(userId, holidayId, iso));
        }

        const rs = await env.DB.batch(stmts);

        // ✅ NEW: push แจ้งเตือนว่าบันทึกการแก้ไข (รวมถึงแจ้งเตือน) แล้ว

        return withCors(request, Response.json({
          ok: true,
          holiday_id: holidayId,
          created: list.length,
          skipped,
          applied: rs.length
        }));
      } catch (e) {
        return withCors(request, jsonError(String(e.message || e), 401));
      }
    }

    if (url.pathname === "/liff/holidays/delete" && request.method === "POST") {
      try {
        const userId = await getUserIdFromLiffToken(request, env);
        const body = await request.json().catch(() => null);
        if (!body) return withCors(request, jsonError("invalid json"));

        const { id } = body;
        if (!id) return withCors(request, jsonError("missing id"));

        await env.DB.prepare(`DELETE FROM reminders WHERE holiday_id = ? AND user_id = ?`)
          .bind(id, userId).run();

        const del = await env.DB.prepare(`DELETE FROM holidays WHERE id = ? AND user_id = ?`)
          .bind(id, userId).run();

        const changes = del.meta?.changes ?? 0;
        if (changes === 0) return withCors(request, jsonError("not found", 404));

        return withCors(request, Response.json({ ok: true }));
      } catch (e) {
        return withCors(request, jsonError(String(e.message || e), 401));
      }
    }

    if (url.pathname === "/liff/holidays/batch" && request.method === "POST") {
      try {
        const userId = await getUserIdFromLiffToken(request, env);
        const body = await request.json().catch(() => null);
        if (!body) return withCors(request, jsonError("invalid json"));

        const updates = Array.isArray(body.updates) ? body.updates : [];
        const deletes = Array.isArray(body.deletes) ? body.deletes : [];

        const stmts = [];

        for (const u of updates) {
          if (!u?.id) continue;

          const cur = await env.DB.prepare(
            `SELECT id, type, subject_id, all_day, start_at, end_at, title, note
             FROM holidays
             WHERE id = ? AND user_id = ?`
          ).bind(u.id, userId).first();

          if (!cur) continue;

          const nextStart = u.start_at !== undefined ? u.start_at : cur.start_at;
          const nextEnd   = u.end_at   !== undefined ? u.end_at   : cur.end_at;
          const nextNote  = u.note     !== undefined ? u.note     : cur.note;
          const nextSubjectId = u.subject_id !== undefined ? u.subject_id : cur.subject_id;

          if (!isIsoLike(nextStart) || !isIsoLike(nextEnd)) continue;

          const wantedTitle = u.title !== undefined ? u.title : cur.title;
          const finalTitle = await ensureTitle(env, userId, cur.type, nextSubjectId ?? null, wantedTitle);
          const normalizedAllDay = normalizeAllDayByType(cur.type, cur.all_day);

          stmts.push(
            env.DB.prepare(`
              UPDATE holidays
              SET
                subject_id = ?,
                all_day = ?,
                start_at = ?,
                end_at   = ?,
                title    = ?,
                note     = ?,
                updated_at = datetime('now')
              WHERE id = ? AND user_id = ?
            `).bind(nextSubjectId ?? null, normalizedAllDay, nextStart, nextEnd, finalTitle, (nextNote ?? null), cur.id, userId)
          );
        }

        for (const id of deletes) {
          if (!id) continue;
          stmts.push(env.DB.prepare(`DELETE FROM reminders WHERE holiday_id = ? AND user_id = ?`).bind(id, userId));
          stmts.push(env.DB.prepare(`DELETE FROM holidays WHERE id = ? AND user_id = ?`).bind(id, userId));
        }

        if (stmts.length === 0) return withCors(request, Response.json({ ok: true, applied: 0 }));

        const rs = await env.DB.batch(stmts);
        return withCors(request, Response.json({ ok: true, applied: rs.length }));
      } catch (e) {
        return withCors(request, jsonError(String(e.message || e), 401));
      }
    }

    /* =========================
       ✅ Internal endpoints (เดิม) ใช้ API_KEY
       ========================= */

    if (!requireAuth(request, env)) {
      return withCors(request, jsonError("unauthorized", 401));
    }


    // =========================
    // ✅ Cancel Query (Internal - API_KEY)
    // POST /cancel/query
    // Body:
    // {
    //   user_id: "...",
    //   subject_query: "CSI103" | null,
    //   range: "upcoming" | "next_week" | "all" | null,
    //   date: "YYYY-MM-DD" | null,
    //   weekday: "จันทร์" | ... | null,
    //   modifier: "next_week" | null
    // }
    // Return:
    // { ok, type:"cancel", mode:"status|list", meta:{title,altText,subtitle}, data:[...] }
    // =========================
    if (url.pathname === "/cancel/query" && request.method === "POST") {
      const body = await request.json().catch(() => null);
      if (!body) return withCors(request, jsonError("invalid json"));

      const user_id = String(body.user_id || "").trim();
      if (!user_id) return withCors(request, jsonError("missing user_id"));

      const subject_query = normUpper(body.subject_query || "");
      const range = String(body.range || "").trim() || "upcoming";
      const reqDate = String(body.date || "").trim() || null;
      const reqWeekday = String(body.weekday || "").trim() || null;
      const modifier = String(body.modifier || "").trim() || null;

      // ---- resolve date range (from/to ISO in +07:00) ----
      const today = todayYMD();

      function resolveSpecificDate() {
        if (reqDate) return reqDate;

        if (reqWeekday) {
          if (modifier === "next_week") {
            const monThis = weekStartMondayYMD(today);
            const monNext = addDaysYMD(monThis, 7);
            const order = ["จันทร์","อังคาร","พุธ","พฤหัสบดี","ศุกร์","เสาร์","อาทิตย์"];
            const idx = order.indexOf(reqWeekday);
            return idx >= 0 ? addDaysYMD(monNext, idx) : monNext;
          }

          // nearest occurrence within 14 days
          for (let i = 0; i <= 14; i++) {
            const d = addDaysYMD(today, i);
            if (weekdayThaiFromYMD(d) === reqWeekday) return d;
          }
        }

        return today;
      }

      let fromYMD, toYMD, title;

      // priority: explicit date/weekday => that day only
      if (reqDate || reqWeekday) {
        const d = resolveSpecificDate();
        fromYMD = d;
        toYMD = d;
        title = reqWeekday ? `ยกคลาส • วัน${reqWeekday}` : `ยกคลาส • ${ymdToThai(d)}`;
      } else if (range === "next_week") {
        const monThis = weekStartMondayYMD(today);
        const monNext = addDaysYMD(monThis, 7);
        fromYMD = monNext;
        toYMD = addDaysYMD(monNext, 6);
        title = "ยกคลาส • อาทิตย์หน้า";
      } else if (range === "all") {
        fromYMD = "0001-01-01";
        toYMD = "9999-12-31";
        title = "ยกคลาส • ทั้งหมด";
      } else {
        // upcoming default: next 30 days
        fromYMD = today;
        toYMD = addDaysYMD(today, 30);
        title = "ยกคลาส • ช่วงนี้";
      }

      const { from, to } = normalizeRangeIso(fromYMD, toYMD);

      // ---- query cancels ----
      const params = [user_id, to, from];
      let sql = `
        SELECT id, user_id, type, subject_id, all_day, start_at, end_at, title, note, created_at, updated_at
        FROM holidays
        WHERE user_id = ?
          AND type = 'cancel'
          AND start_at <= ?
          AND end_at >= ?
      `;

      if (subject_query) {
        sql += ` AND UPPER(subject_id) = ?`;
        params.push(subject_query);
      }

      sql += ` ORDER BY start_at ASC`;

      const res = await env.DB.prepare(sql).bind(...params).all();
      const items = res?.results || [];

      // ---- enrich with subject name (optional, best-effort) ----
      // your subjects table stores subject_code + subject_name
      // we match by subject_code = subject_id (because you store subject_id as code)
      const uniqCodes = Array.from(new Set(items.map(x => String(x.subject_id || "").trim()).filter(Boolean)));
      const subjectMap = new Map();
      if (uniqCodes.length) {
        // build IN (?, ?, ...)
        const qs = uniqCodes.map(() => "?").join(",");
        const sres = await env.DB.prepare(
          `SELECT subject_code, subject_name
           FROM subjects
           WHERE user_id = ? AND subject_code IN (${qs})`
        ).bind(user_id, ...uniqCodes).all();

        for (const s of (sres?.results || [])) {
          subjectMap.set(String(s.subject_code).trim().toUpperCase(), String(s.subject_name || "").trim());
        }
      }

      const data = items.map((x) => {
        const code = String(x.subject_id || "").trim();
        const name = subjectMap.get(code.toUpperCase()) || null;
        const startY = String(x.start_at || "").slice(0, 10);
        const endY = String(x.end_at || "").slice(0, 10);
        return {
          id: x.id,
          type: "cancel",
          subject_code: code || null,
          subject_name: name,
          date: startY || null,
          start_date: startY || null,
          end_date: endY || null,
          start_at: x.start_at,
          end_at: x.end_at,
          title: x.title,
          note: x.note,
        };
      });

      const subtitle = subject_query
        ? `วิชา ${subject_query}${subjectMap.get(subject_query) ? ` • ${subjectMap.get(subject_query)}` : ""}`
        : `ช่วง ${ymdToThai(fromYMD)} – ${ymdToThai(toYMD)}`;

      if (!data.length) {
        const msg = subject_query
          ? `ยังไม่พบการยกคลาสของวิชา ${subject_query} ในช่วงนี้ค่ะ 😊`
          : `ช่วงนี้ยังไม่มียกคลาสนะคะ 😊✨`;

        return withCors(request, Response.json({
          ok: true,
          type: "cancel",
          mode: "status",
          view: "empty",
          meta: { title, altText: title, subtitle },
          data: [],
          message: msg,
        }));
      }

      const msg = subject_query
        ? `เจอการยกคลาสของวิชา ${subject_query} ${data.length} รายการค่ะ ✨`
        : `เจอรายการยกคลาส ${data.length} รายการค่ะ ✨`;

      return withCors(request, Response.json({
        ok: true,
        type: "cancel",
        mode: "list",
        view: "list",
        meta: { title, altText: title, subtitle },
        data,
        message: msg,
      }));
    }

    if (url.pathname === "/subjects" && request.method === "GET") {
      const user_id = url.searchParams.get("user_id");
      if (!user_id) return withCors(request, jsonError("missing user_id"));

      const { results } = await env.DB.prepare(
        `SELECT
           day,
           start_time,
           end_time,
           room,
           subject_code,
           subject_name,
           section,
           type,
           instructor,
           semester
         FROM subjects
         WHERE user_id = ?
         ORDER BY day, start_time, subject_code, section, type`
      ).bind(user_id).all();

      return withCors(request, Response.json({ ok: true, items: results || [] }));
    }

    if (url.pathname === "/holidays" && request.method === "POST") {
      const body = await request.json().catch(() => null);
      if (!body) return withCors(request, jsonError("invalid json"));

      const {
        user_id,
        type,
        subject_id,
        all_day = 1,
        start_at,
        end_at,
        title = null,
        note = null,
        reminders = [],
      } = body;

      if (!user_id) return withCors(request, jsonError("missing user_id"));
      if (!["holiday", "cancel"].includes(type)) return withCors(request, jsonError("invalid type"));
      if (!isIsoLike(start_at) || !isIsoLike(end_at)) return withCors(request, jsonError("missing/invalid start_at or end_at"));

      const normalizedAllDay = normalizeAllDayByType(type, all_day);
      const finalTitle = await ensureTitle(env, user_id, type, subject_id ?? null, title);

      // DUPLICATE_CANCEL_INTERNAL_HOLIDAYS
      if (type === "cancel") {
        const ymd = String(start_at).slice(0, 10);
        const exists = await env.DB.prepare(
          `SELECT id, title FROM holidays
           WHERE user_id = ?
             AND type = 'cancel'
             AND subject_id = ?
             AND substr(start_at, 1, 10) = ?
           LIMIT 1`
        ).bind(user_id, subject_id ?? null, ymd).first();

        if (exists) {
          const msg = buildDuplicateCancelMessage(exists.title || finalTitle, start_at);
          return withCors(request, jsonErrorCode("DUPLICATE", msg, 409));
        }
      }

      const ins = await env.DB.prepare(
        `INSERT INTO holidays (user_id, type, subject_id, all_day, start_at, end_at, title, note, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))`
      ).bind(
        user_id,
        type,
        subject_id ?? null,
        normalizedAllDay,
        start_at,
        end_at,
        finalTitle,
        note ?? null
      ).run();

      const holidayId = ins.meta?.last_row_id;

      let reminders_created = 0;
      let reminders_skipped = 0;

      if (holidayId && Array.isArray(reminders) && reminders.length > 0) {
        const stmt = env.DB.prepare(
          `INSERT INTO reminders (user_id, holiday_id, remind_at, status, created_at)
           VALUES (?, ?, ?, 'pending', datetime('now'))`
        );

        const nowIso = nowBangkokIsoLike();
        const uniq = new Set();

        for (const r of reminders) {
          try {
            const remindAt = resolveRemindAt(r, start_at);
            if (isoLessOrEqual(remindAt, nowIso)) { reminders_skipped++; continue; }
            uniq.add(remindAt);
          } catch {
            reminders_skipped++;
          }
        }

        for (const iso of Array.from(uniq).sort()) {
          await stmt.bind(user_id, holidayId, iso).run();
          reminders_created++;
        }
      }

      return withCors(request, Response.json({
        ok: true,
        id: holidayId,
        all_day: normalizedAllDay,
        title: finalTitle,
        reminders_created,
        reminders_skipped,
      }));
    }

    if (url.pathname === "/holidays/reminders/add" && request.method === "POST") {
      const body = await request.json().catch(() => null);
      if (!body) return withCors(request, jsonError("invalid json"));

      const { user_id, holiday_id, reminders = [] } = body;
      if (!user_id) return withCors(request, jsonError("missing user_id"));
      if (!holiday_id) return withCors(request, jsonError("missing holiday_id"));
      if (!Array.isArray(reminders) || reminders.length === 0) return withCors(request, jsonError("missing reminders"));

      const row = await env.DB.prepare(
        `SELECT id, user_id, start_at
         FROM holidays
         WHERE id = ? AND user_id = ?`
      ).bind(holiday_id, user_id).first();

      if (!row) return withCors(request, jsonError("holiday not found", 404));

      const start_at = row.start_at;
      if (!isIsoLike(start_at)) return withCors(request, jsonError("holiday start_at invalid", 500));

      const stmt = env.DB.prepare(
        `INSERT INTO reminders (user_id, holiday_id, remind_at, status, created_at)
         VALUES (?, ?, ?, 'pending', datetime('now'))`
      );

      let reminders_created = 0;
      let reminders_skipped = 0;
      const nowIso = nowBangkokIsoLike();

      for (const r of reminders) {
        try {
          const remindAt = resolveRemindAt(r, start_at);
          if (isoLessOrEqual(remindAt, nowIso)) {
            reminders_skipped++;
            continue;
          }
          await stmt.bind(user_id, holiday_id, remindAt).run();
          reminders_created++;
        } catch {
          reminders_skipped++;
        }
      }

      return withCors(request, Response.json({ ok: true, holiday_id, reminders_created, reminders_skipped }));
    }

    if (url.pathname === "/holidays/list" && request.method === "GET") {
      const user_id = url.searchParams.get("user_id");
      const rawFrom = url.searchParams.get("from");
      const rawTo = url.searchParams.get("to");
      const { from, to } = normalizeRangeIso(rawFrom, rawTo);

      if (!user_id) return withCors(request, jsonError("missing user_id"));
      if (!isIsoLike(from) || !isIsoLike(to)) return withCors(request, jsonError("missing/invalid from or to"));

      const { results } = await env.DB.prepare(
        `SELECT *
         FROM holidays
         WHERE user_id = ?
           AND start_at <= ?
           AND end_at >= ?
         ORDER BY start_at ASC`
      ).bind(user_id, to, from).all();

      return withCors(request, Response.json({ ok: true, items: results || [] }));
    }

    if (url.pathname === "/holidays/delete" && request.method === "POST") {
      const body = await request.json().catch(() => null);
      if (!body) return withCors(request, jsonError("invalid json"));

      const { user_id, id } = body;
      if (!user_id || !id) return withCors(request, jsonError("missing user_id or id"));

      await env.DB.prepare(`DELETE FROM reminders WHERE holiday_id = ? AND user_id = ?`)
        .bind(id, user_id).run();

      const del = await env.DB.prepare(`DELETE FROM holidays WHERE id = ? AND user_id = ?`)
        .bind(id, user_id).run();

      const changes = del.meta?.changes ?? 0;
      if (changes === 0) return withCors(request, jsonError("not found", 404));

      return withCors(request, Response.json({ ok: true }));
    }

    return withCors(request, jsonError("not found", 404));
  },

  async scheduled(event, env, ctx) {
    ctx.waitUntil(processDueReminders(env));
  },
};