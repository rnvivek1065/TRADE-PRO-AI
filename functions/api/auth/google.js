import {
  randomToken,
  signState,
  stateCookie
} from "../../_utils/auth.js";

export async function onRequestGet({ env }) {
  try {
    if (
      !env.GOOGLE_CLIENT_ID ||
      !env.GOOGLE_CLIENT_SECRET ||
      !env.GOOGLE_REDIRECT_URI ||
      !env.SESSION_SECRET
    ) {
      return new Response("Google Login is not configured.", {
        status: 500
      });
    }

    const state = randomToken(32);
    const verifier = randomToken(48);

    const challengeBytes = await crypto.subtle.digest(
      "SHA-256",
      new TextEncoder().encode(verifier)
    );

    const challenge = btoa(
      String.fromCharCode(
        ...new Uint8Array(challengeBytes)
      )
    )
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/g, "");

    const signedState = await signState(
      {
        state,
        verifier,
        expires: Date.now() + 600000
      },
      env.SESSION_SECRET
    );

    const url = new URL(
      "https://accounts.google.com/o/oauth2/v2/auth"
    );

    url.searchParams.set("client_id", env.GOOGLE_CLIENT_ID);
    url.searchParams.set("redirect_uri", env.GOOGLE_REDIRECT_URI);
    url.searchParams.set("response_type", "code");
    url.searchParams.set("scope", "openid email profile");
    url.searchParams.set("state", state);
    url.searchParams.set("code_challenge", challenge);
    url.searchParams.set("code_challenge_method", "S256");
    url.searchParams.set("prompt", "select_account");

    return new Response(null, {
      status: 302,
      headers: {
        Location: url.toString(),
        "Set-Cookie": stateCookie(signedState),
        "Cache-Control": "no-store"
      }
    });
  } catch {
    return new Response("Unable to start Google Login.", {
      status: 500
    });
  }
}
