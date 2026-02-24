import { CONFIG } from "./config.js";

export async function initLiff() {
  if (!window.liff) throw new Error("LIFF SDK not loaded");

  const liffId = CONFIG.getLiffId();
  await window.liff.init({ liffId });

  // ยังไม่ login → login แล้ว redirect
  if (!window.liff.isLoggedIn()) {
    window.liff.login();
    return null;
  }

  // มี login แล้ว แต่ token อาจหมด
  const idToken = window.liff.getIDToken();
  if (!idToken) {
    window.liff.login();
    return null;
  }

  // ลองดึง profile ถ้า fail มักเป็น token/สถานะหลุด → login ใหม่
  try {
    const profile = await window.liff.getProfile();
    return { idToken, profile };
  } catch (e) {
    console.warn("LIFF getProfile failed -> re-login", e);
    window.liff.login();
    return null;
  }
}