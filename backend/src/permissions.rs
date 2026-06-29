//! Authorization model: granular permissions grouped into roles.
//!
//! A user is NOT an admin because of a boolean — a user has roles, roles grant
//! permissions, and every protected action checks one explicit permission.
//! Wildcards (`users.*`, `*`) are supported so a "super_admin" role can be
//! expressed without listing every permission.

/// Canonical permission strings. Keep these as the single source of truth.
pub mod perm {
    pub const USERS_READ: &str = "users.read";
    pub const USERS_UPDATE: &str = "users.update";
    pub const USERS_BAN: &str = "users.ban";
    pub const USERS_DELETE: &str = "users.delete";

    pub const ROLES_READ: &str = "roles.read";
    pub const ROLES_CREATE: &str = "roles.create";
    pub const ROLES_UPDATE: &str = "roles.update";
    pub const ROLES_DELETE: &str = "roles.delete";

    pub const PERMISSIONS_ASSIGN: &str = "permissions.assign";

    pub const ADMIN_AUDIT_READ: &str = "admin.audit.read";
    pub const SECURITY_EVENTS_READ: &str = "admin.security.read";

    pub const SYSTEM_CONFIG_READ: &str = "system.config.read";
    pub const SYSTEM_CONFIG_UPDATE: &str = "system.config.update";

    pub const NODES_READ: &str = "nodes.read";
    pub const NODES_MANAGE: &str = "nodes.manage";
    /// Grant a VPS without an expiry date (lifetime / vitalícia).
    pub const NODES_LIFETIME: &str = "nodes.lifetime";

    pub const RELAYS_READ: &str = "relays.read";
    pub const RELAYS_MANAGE: &str = "relays.manage";

    pub const BILLING_READ: &str = "billing.read";
    pub const BILLING_MANAGE: &str = "billing.manage";

    pub const SUPPORT_READ: &str = "support.read";
    pub const SUPPORT_MANAGE: &str = "support.manage";

    pub const ANNOUNCEMENTS_READ: &str = "announcements.read";
    pub const ANNOUNCEMENTS_MANAGE: &str = "announcements.manage";
}

/// Per-server permissions granted to org members on individual servers. These
/// are NOT global RBAC permissions — they live in `server_grants` documents and
/// gate access to a specific shared VPS.
pub mod server_perm {
    pub const VIEW: &str = "view";
    pub const POWER: &str = "power";
    pub const CONSOLE: &str = "console";
    pub const METRICS: &str = "metrics";
    pub const DELETE: &str = "delete";
    pub const MANAGE: &str = "manage";

    pub const ALL: &[&str] = &[VIEW, POWER, CONSOLE, METRICS, DELETE, MANAGE];

    pub fn is_valid(p: &str) -> bool {
        ALL.contains(&p)
    }
}

/// All known permissions (used to seed the DB and validate role definitions).
pub const ALL_PERMISSIONS: &[&str] = &[
    perm::USERS_READ,
    perm::USERS_UPDATE,
    perm::USERS_BAN,
    perm::USERS_DELETE,
    perm::ROLES_READ,
    perm::ROLES_CREATE,
    perm::ROLES_UPDATE,
    perm::ROLES_DELETE,
    perm::PERMISSIONS_ASSIGN,
    perm::ADMIN_AUDIT_READ,
    perm::SECURITY_EVENTS_READ,
    perm::SYSTEM_CONFIG_READ,
    perm::SYSTEM_CONFIG_UPDATE,
    perm::NODES_READ,
    perm::NODES_MANAGE,
    perm::NODES_LIFETIME,
    perm::RELAYS_READ,
    perm::RELAYS_MANAGE,
    perm::BILLING_READ,
    perm::BILLING_MANAGE,
    perm::SUPPORT_READ,
    perm::SUPPORT_MANAGE,
    perm::ANNOUNCEMENTS_READ,
    perm::ANNOUNCEMENTS_MANAGE,
];

/// Does the granted set satisfy `needed`? Supports `*` and `prefix.*` wildcards.
pub fn granted(granted_perms: &[String], needed: &str) -> bool {
    granted_perms.iter().any(|g| {
        if g == "*" || g == needed {
            return true;
        }
        if let Some(prefix) = g.strip_suffix(".*") {
            return needed
                .strip_prefix(prefix)
                .map(|rest| rest.starts_with('.'))
                .unwrap_or(false);
        }
        false
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn wildcards_work() {
        let star = vec!["*".to_string()];
        assert!(granted(&star, "users.delete"));

        let scoped = vec!["users.*".to_string()];
        assert!(granted(&scoped, "users.read"));
        assert!(!granted(&scoped, "roles.read"));

        let exact = vec!["users.read".to_string()];
        assert!(granted(&exact, "users.read"));
        assert!(!granted(&exact, "users.update"));
    }
}
