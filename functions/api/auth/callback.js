import {
  getCookie,
  verifyState,
  randomToken,
  sha256,
  sessionCookie,
  clearStateCookie,
  ownerEmail,
  responseWithCookies
} from "../../_utils/auth.js";

export async function onRequestGet({ request, env }) {
  const url = new URL(request.url);

  const code = url.searchParams.get("code");
  const returnedState = url.searchParams.get("state");
  const savedState = getCookie(request, "tradepro_oauth_state");

  const failure = (message = "Google Login failed.", status = 400) => {
    return responseWithCookies(
      message,
      {
        status,
        headers: {
          "Content-Type": "text/plain; charset=utf-8",
          "Cache-Control": "no-store"
        }
      },
      [clearStateCookie()]
    );
  };

  try {
    if (!env.DB || !env.SESSION_SECRET) {
      return failure("Authentication is not configured.");
    }

    if (!code || !returnedState || !savedState) {
      return failure();
    }

    const stateData = await verifyState(
      savedState,
      env.SESSION_SECRET
    );

    if (!stateData || stateData.state !== returnedState) {
      return failure("Invalid login state.");
    }

    const tokenResponse = await fetch(
      "https://oauth2.googleapis.com/token",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded"
        },
        body: new URLSearchParams({
          code,
          client_id: env.GOOGLE_CLIENT_ID,
          client_secret: env.GOOGLE_CLIENT_SECRET,
          redirect_uri: env.GOOGLE_REDIRECT_URI,
          grant_type: "authorization_code",
          code_verifier: stateData.verifier
        })
      }
    );

    if (!tokenResponse.ok) {
      console.error("auth.callback: token exchange rejected", {
        status: tokenResponse.status
      });

      return failure("Google token verification failed.");
    }

    const tokens = await tokenResponse.json();

    if (!tokens.id_token) {
      return failure();
    }

    const verifyResponse = await fetch(
      "https://oauth2.googleapis.com/tokeninfo?id_token=" +
      encodeURIComponent(tokens.id_token)
    );

    if (!verifyResponse.ok) {
      console.error("auth.callback: identity verification rejected", {
        status: verifyResponse.status
      });

      return failure("Google identity verification failed.");
    }

    const identity = await verifyResponse.json();

    const validIssuer = [
      "accounts.google.com",
      "https://accounts.google.com"
    ].includes(identity.iss);

    // Google returns a real boolean in the tokeninfo JSON, but the endpoint
    // has historically returned the string "true". Accept both (and 1) so a
    // verified account is never rejected because of a type change.
    const emailVerified =
      identity.email_verified === true ||
      identity.email_verified === "true" ||
      identity.email_verified === 1;

    const validIdentity =
      identity.aud === env.GOOGLE_CLIENT_ID &&
      validIssuer &&
      Number(identity.exp) * 1000 > Date.now() &&
      emailVerified &&
      identity.sub &&
      identity.email;

    if (!validIdentity) {
      return failure("Google account could not be verified.");
    }

    const email = identity.email.toLowerCase();
    const isOwner = email === ownerEmail(env);

    const now = new Date().toISOString();

    await env.DB.prepare(`
      INSERT INTO users (
        google_sub,
        email,
        name,
        picture,
        role,
        plan,
        status,
        created_at,
        last_login_at
      )
      VALUES (?, ?, ?, ?, ?, ?, 'active', ?, ?)
      ON CONFLICT(google_sub) DO UPDATE SET
        email = excluded.email,
        name = excluded.name,
        picture = excluded.picture,
        role = excluded.role,
        last_login_at = excluded.last_login_at
    `)
      .bind(
        identity.sub,
        email,
        identity.name || "",
        identity.picture || "",
        isOwner ? "owner" : "user",
        isOwner ? "pro" : "basic",
        now,
        now
      )
      .run();

    // Deactivation must be enforced at login, not only on the next /me call.
    // Otherwise the user receives a session cookie that every later request
    // rejects, which looks like a broken login instead of a blocked account.
    const account = await env.DB.prepare(`
      SELECT status FROM users WHERE google_sub = ?
    `)
      .bind(identity.sub)
      .first();

    if (
      account &&
      String(account.status ?? "active").toLowerCase() !== "active"
    ) {
      return failure(
        "This account has been deactivated. Please contact the owner.",
        403
      );
    }

    const sessionToken = randomToken(48);
    const tokenHash = await sha256(sessionToken);

    const expiresAt = new Date(
      Date.now() + 7 * 24 * 60 * 60 * 1000
    ).toISOString();

    await env.DB.prepare(`
      DELETE FROM sessions
      WHERE expires_at <= ?
    `)
      .bind(now)
      .run();

    await env.DB.prepare(`
      INSERT INTO sessions (
        token_hash,
        google_sub,
        expires_at,
        created_at
      )
      VALUES (?, ?, ?, ?)
    `)
      .bind(
        tokenHash,
        identity.sub,
        expiresAt,
        now
      )
      .run();

    // Two independent Set-Cookie headers. Joining them with ", " produces one
    // malformed header (RFC 6265 forbids comma-combining) and browsers may
    // drop the session cookie, causing an immediate login loop.
    return responseWithCookies(
      null,
      {
        status: 302,
        headers: {
          Location: "/",
          "Cache-Control": "no-store"
        }
      },
      [sessionCookie(sessionToken), clearStateCookie()]
    );

  } catch (error) {
    // Logged without request details: the authorization code, id_token and
    // client secret must never reach the logs.
    console.error("auth.callback: unhandled failure", {
      message: error?.message
    });

    return failure("Login could not be completed.", 500);
  }
}
