/**
 * TRADE PRO AI — authentication and authorization guards.
 *
 * Every protected endpoint calls these. Authorization is decided here on the
 * server from the session and the database row; nothing is trusted from the
 * client, including any role or plan value sent in a request body.
 */

import { getCurrentUser } from "./auth.js";
import { HttpError } from "./http.js";

/**
 * Requires a valid, unexpired session belonging to an ACTIVE account.
 *
 * getCurrentUser() already returns null for expired sessions and inactive
 * accounts; the explicit status check keeps a deactivated user locked out even
 * if the session row still exists.
 *
 * @returns {Promise<object>} the authenticated user
 * @throws {HttpError} 401 when unauthenticated, 403 when the account is inactive
 */
export async function requireUser(request, env) {
  const user = await getCurrentUser(request, env);

  if (!user) {
    throw new HttpError("unauthorized", "Please sign in to continue.", 401);
  }

  if (user.status !== "active") {
    throw new HttpError(
      "account_inactive",
      "This account has been deactivated. Contact the administrator.",
      403
    );
  }

  return user;
}

/**
 * Requires the owner account.
 * @throws {HttpError} 401 unauthenticated, 403 not the owner
 */
export async function requireOwner(request, env) {
  const user = await requireUser(request, env);

  if (!user.isOwner) {
    throw new HttpError("forbidden", "Owner access required.", 403);
  }

  return user;
}
