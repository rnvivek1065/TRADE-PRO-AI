import {
  getCookie,
  verifyState,
  randomToken,
  sha256,
  sessionCookie,
  clearStateCookie
} from "../../_utils/auth.js";

const OWNER_EMAIL = "rnvivek1065@gmail.com";

export async function onRequestGet({ request, env }) {
  const url = new URL(request.url);

  const code = url.searchParams.get("code");
  const returnedState = url.searchParams.get("state");
  const savedState = getCookie(request, "tradepro_oauth_state");

  const failure = (message = "Google Login failed.") => {
    return new Response(message, {
      status: 400,
      headers: {
        "Set-Cookie": clearStateCookie(),
        "Cache-Control": "no-store"
      }
    });
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
      return failure("Google identity verification failed.");
    }

    const identity = await verifyResponse.json();

    const validIssuer = [
      "accounts.google.com",
      "https://accounts.google.com"
    ].includes(identity.iss);

    const validIdentity =
      identity.aud === env.GOOGLE_CLIENT_ID &&
      validIssuer &&
      Number(identity.exp) * 1000 > Date.now() &&
      identity.email_verified === "true" &&
      identity.sub &&
      identity.email;

    if (!validIdentity) {
      return failure("Google account could not be verified.");
    }

    const email = identity.email.toLowerCase();
    const isOwner = email === OWNER_EMAIL;

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

    return new Response(null, {
      status: 302,
      headers: {
        Location: "/",
        "Set-Cookie": [
          sessionCookie(sessionToken),
          clearStateCookie()
        ].join(", "),
        "Cache-Control": "no-store"
      }
    });

  } catch (error) {
    return failure("Login could not be completed.");
  }
}
