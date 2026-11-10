/**
 * GET /api/usage
 *
 * The caller's own quota state and recent signal history.
 *
 * Usage is always recomputed server-side from the signals table; the client
 * never reports its own consumption.
 */

import { getUsage, recentSignals, BASIC_DAILY_LIMIT } from "../_utils/quota.js";
import { okResponse, requireMethod, withErrors } from "../_utils/http.js";
import { requireUser } from "../_utils/guards.js";

export const onRequestGet = withErrors(async ({ request, env }) => {
  const wrongMethod = requireMethod(request, "GET", "GET");
  if (wrongMethod) return wrongMethod;

  const user = await requireUser(request, env);

  const usage = await getUsage(env, user);
  const history = await recentSignals(env, user.googleSub, 20);

  return okResponse({
    user: {
      email: user.email,
      name: user.name,
      picture: user.picture,
      isOwner: user.isOwner,
      plan: usage.plan,
      status: user.status,
      proExpiresAt: user.proExpiresAt,
      proExpired: user.proExpired
    },
    usage,
    history,
    basicDailyLimit: BASIC_DAILY_LIMIT
  });
});
