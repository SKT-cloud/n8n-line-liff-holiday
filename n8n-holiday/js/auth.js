function withTimeout(promise, ms, msg) {
  return Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error(msg)), ms))
  ]);
}

export async function initAndRequireLogin(liffId) {
  if (!liffId) throw new Error("missing LIFF_ID");

  // Initialize LIFF with timeout to avoid waiting forever on bad config/network.
  try {
    await withTimeout(
      liff.init({ liffId }),
      8000,
      "LIFF init timeout: เช็ก Allowed domains / Endpoint URL ใน LINE Developers"
    );
  } catch (e) {
    throw new Error("LIFF init failed: " + (e?.message || String(e)));
  }

  // Redirect user to LINE login if session is not authenticated yet.
  if (!liff.isLoggedIn()) {
    liff.login({ redirectUri: window.location.href });
    return null;
  }

  // Fetch LINE profile for user_id/display_name used in the form payload.
  try {
    return await withTimeout(
      liff.getProfile(),
      8000,
      "getProfile timeout: เช็ก scopes openid + profile"
    );
  } catch (e) {
    throw new Error("getProfile failed: " + (e?.message || String(e)));
  }
}
