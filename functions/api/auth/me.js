import {
  getCurrentUser,
  json
} from "../../_utils/auth.js";

export async function onRequestGet({ request, env }) {
  try {
    const user = await getCurrentUser(request, env);

    if (!user) {
      return json({
        authenticated: false,
        user: null
      });
    }

    return json({
      authenticated: true,
      user: {
        email: user.email,
        name: user.name,
        picture: user.picture,
        role: user.role,
        plan: user.plan,
        status: user.status,
        proExpiresAt: user.pro_expires_at
      }
    });

  } catch {
    return json({
      authenticated: false,
      error: "Authentication service unavailable."
    }, 500);
  }
}
