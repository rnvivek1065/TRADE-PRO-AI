import {
  getCookie,
  sha256,
  clearSessionCookie,
  json
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

    return json(
      { success: true, message: "Logged out successfully." },
      200,
      {
        "Set-Cookie": clearSessionCookie()
      }
    );

  } catch {
    return json(
      { success: false, message: "Logout failed." },
      500
    );
  }
}
