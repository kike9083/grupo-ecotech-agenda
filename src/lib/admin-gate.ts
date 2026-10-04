/**
 * Admin route gate (PR4 task 5.1, specs `agenda-auth` + `record-visibility`).
 *
 * Pure decision function — the `/admin` RSC calls it right after resolving
 * identity so a non-admin gets NONE of anyone's data (peer isolation: the
 * route answers 404 via `notFound()`, not a hint about what it contains).
 * Admin truth itself comes from design D2: membership in the `admins` team
 * via the session client's `teams.list()` (`isAdmin` in `appwrite/session`).
 */

export type AdminAccess =
  /** Signed-in member of the admins team — render the view. */
  | { kind: 'allow' }
  /** No resolvable session — redirect to the login error path. */
  | { kind: 'session' }
  /** Signed-in but not in `admins` — deny the route entirely. */
  | { kind: 'forbidden' };

export function resolveAdminAccess(
  user: { id: string } | null,
  admin: boolean,
): AdminAccess {
  if (user === null) {
    return { kind: 'session' };
  }
  if (!admin) {
    return { kind: 'forbidden' };
  }
  return { kind: 'allow' };
}
