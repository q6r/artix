// Shared client-side permission helpers. Mirror the backend's wildcard model
// (`*` = everything, `prefix.*` = a whole group).

/** Does the granted set satisfy `needed`? Supports `*` and `prefix.*` wildcards. */
export function granted(perms: string[], needed: string): boolean {
  return perms.some((g) => {
    if (g === "*" || g === needed) return true;
    if (g.endsWith(".*")) {
      const prefix = g.slice(0, -2);
      return needed.startsWith(prefix + ".");
    }
    return false;
  });
}

/** Can this user see the admin area at all? */
export function hasAdminAccess(perms: string[] | undefined | null): boolean {
  if (!perms || perms.length === 0) return false;
  if (perms.includes("*")) return true;
  const base = [
    "users.read",
    "roles.read",
    "users.update",
    "support.read",
    "support.manage",
    "announcements.read",
    "announcements.manage",
    "billing.read",
    "billing.manage",
    "nodes.read",
    "nodes.manage",
    "relays.read",
    "relays.manage",
  ];
  if (base.some((p) => granted(perms, p))) return true;
  return perms.some(
    (p) =>
      p.startsWith("support.cat.") ||
      p === "support.*" ||
      p === "roles.*" ||
      p === "users.*" ||
      p === "announcements.*" ||
      p === "billing.*" ||
      p === "nodes.*" ||
      p === "relays.*",
  );
}

/** Can this user handle the staff ticket queue? (mirrors backend `has_support_access`) */
export function hasSupportAccess(perms: string[] | undefined | null): boolean {
  if (!perms || perms.length === 0) return false;
  if (perms.includes("*")) return true;
  if (granted(perms, "support.read") || granted(perms, "support.manage")) return true;
  return perms.some((p) => p.startsWith("support.cat.") || p === "support.*");
}
