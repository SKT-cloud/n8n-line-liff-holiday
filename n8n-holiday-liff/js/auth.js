import { CONFIG } from "./config.js";

function sleep(ms){ return new Promise(r=>setTimeout(r, ms)); }

/** รอให้ LIFF SDK โหลด (กันกรณีเน็ตช้า / caching แปลกๆ) */
async function waitForLiffSdk(timeoutMs = 8000){
  const start = Date.now();
  while (!window.liff && Date.now() - start < timeoutMs) {
    await sleep(50);
  }
  if (!window.liff) throw new Error("LIFF SDK not loaded");
}

export async function initLiff() {
  await waitForLiffSdk();

  const liffId = CONFIG.getLiffId();
  await window.liff.init({ liffId });

  if (!window.liff.isLoggedIn()) {
    window.liff.login({ redirectUri: location.href });
    return {};
  }

  const idToken = window.liff.getIDToken();
  if (!idToken) {
    // บางเคส token แปลกๆ ให้ login ใหม่
    try { window.liff.logout(); } catch (_) {}
    window.liff.login({ redirectUri: location.href });
    return {};
  }

  const profile = await window.liff.getProfile();
  return { idToken, profile };
}