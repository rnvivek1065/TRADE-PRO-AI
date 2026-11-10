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
        isOwner: user.isOwner,
        // Effective plan: 'basic' whenever a 'pro' subscription has expired.
        plan: user.plan,
        storedPlan: user.storedPlan,
        proActive: user.proActive,
        proExpiresAt: user.proExpiresAt,
        proExpired: user.proExpired,
        status: user.status,
        sessionExpiresAt: user.sessionExpiresAt
      }
    });

  } catch (error) {
    console.error("auth.me: failed", {
      message: error?.message
    });

    return json({
      authenticated: false,
      error: "Authentication service unavailable."
    }, 500);
  }
}
