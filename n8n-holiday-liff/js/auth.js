import { CONFIG } from "./config.js";

// ✅ เผื่อ clock skew + ให้ refresh ก่อนหมดจริงนิดนึง
const EXP_SKEW_SEC = 30;

function isIdTokenExpired(decoded) {
  if (!decoded || typeof decoded.exp !== "number") return true;
  const nowSec = Math.floor(Date.now() / 1000);
  return decoded.exp <= (nowSec + EXP_SKEW_SEC);
}

export async function initLiff({ forceRelogin = false } = {}) {
  if (!window.liff) throw new Error("LIFF SDK not loaded");

  const liffId = CONFIG.getLiffId();
  await window.liff.init({ liffId });

  // ถ้ายังไม่ login → login แล้ว redirect
  if (!window.liff.isLoggedIn()) {
    window.liff.login();
    return null;
  }

  // ถ้าถูกสั่งให้ force relogin (หรือ token expired) → logout แล้ว login ใหม่
  if (forceRelogin) {
    try { window.liff.logout(); } catch {}
    window.liff.login();
    return null;
  }

  // ดึง idToken + decode
  const idToken = window.liff.getIDToken();
  const decoded = window.liff.getDecodedIDToken?.();

  // ✅ กรณี idToken ไม่มี หรือหมดอายุ → logout+login เพื่อออก token ใหม่
  if (!idToken || isIdTokenExpired(decoded)) {
    try { window.liff.logout(); } catch {}
    window.liff.login();
    return null;
  }

  // profile (ใช้แสดงชื่อ)
  const profile = await window.liff.getProfile();
  return { idToken, profile, decoded };
}