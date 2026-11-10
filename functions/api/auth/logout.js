import {
  getCookie,
  sha256,
  clearSessionCookie,
  jsonWithCookies
} from "../../_utils/auth.js";

export async function onRequestPost({ request, env }) {
  try {
    const token = getCookie(request, "tradepro_session");

    if (token && env.DB) {
      const tokenHash = await sha256(token);

      await env.DB.prepare(`
        DELETE FROM sessions
        WHERE token_hash = ?
      `)
        .bind(tokenHash)
        .run();
    }

    // Cleared through the shared helper so the cookie is emitted as its own
    // Set-Cookie header, matching the OAuth callback.
    return jsonWithCookies(
      { success: true, message: "Logged out successfully." },
      200,
      [clearSessionCookie()]
    );

  } catch (error) {
    console.error("auth.logout: failed", {
      message: error?.message
    });

    return jsonWithCookies(
      { success: false, message: "Logout failed." },
      500,
      [clearSessionCookie()]
    );
  }
}
