# GuildPass Dashboard — Scoped Permission Model (RBAC)

This document describes the per-guild role-based access control (RBAC) system implemented in the GuildPass dashboard. It covers the scoped roles design, the session model, permission checking helpers, API route boundaries, and how mock sessions work during local development.

---

## The Scoped RBAC Architecture

Prior versions used a single global role model (e.g. a user was an "admin" globally across all guilds). To support true multi-tenancy, the dashboard implements a **per-guild scoped RBAC model**:
- A user's privileges are scoped to a specific guild (represented by a `guildId`).
- A user can be an `admin` of Guild A but only have `readonly` access to Guild B.
- All permission checks require a `guildId` context.

---

## Roles

The dashboard recognises four roles, ordered from most to least privileged:

| Role | Description |
|------|-------------|
| `owner` | Guild creator / contract deployer. Full read + write access to the guild. |
| `admin` | Full read + write access to the guild. Functionally identical to owner. |
| `moderator` | Scoped read access, plus ability to write member data (`members:write`). Cannot edit passes, settings, or guild metadata. |
| `readonly` | Read-only access across the guild. Cannot trigger any mutation. |

---

## Session Model & Scoped Roles

The `Session` object is serialized and stored in an access token (JWT payload). Instead of a single global `role` field, it contains a dictionary mapping guild IDs to the user's role in that guild:

```ts
export interface Session {
  userId: string;
  name: string;
  roles: Record<string, Role>; // guildId -> Role mapping
}
```

For the local single-guild development flow, the mock sessions map the default role to `DEFAULT_GUILD_ID` (which is `"1"`).

---

## Permission Matrix

Permissions are represented by strings formatted as `<resource>:<action>` (e.g., `passes:write`). The canonical source of truth mapping roles to permissions is the `ROLE_PERMISSIONS` matrix in `apps/dashboard/lib/auth/session.ts`:

| Permission | owner | admin | moderator | readonly |
|------------|:-----:|:-----:|:---------:|:--------:|
| `passes:read` | ✅ | ✅ | ✅ | ✅ |
| `passes:write` | ✅ | ✅ | ❌ | ❌ |
| `members:read` | ✅ | ✅ | ✅ | ✅ |
| `members:write` | ✅ | ✅ | ✅ | ❌ |
| `guilds:read` | ✅ | ✅ | ✅ | ✅ |
| `guilds:write` | ✅ | ✅ | ❌ | ❌ |
| `settings:read` | ✅ | ✅ | ✅ | ✅ |
| `settings:write` | ✅ | ✅ | ❌ | ❌ |
| `activity:read` | ✅ | ✅ | ✅ | ✅ |

---

## Scoped Helper Functions

All UI gating and API enforcement uses named helper functions from `apps/dashboard/lib/permissions.ts`. Every helper accepts a `guildId` context:

| Helper | Required Permission |
|--------|---------------------|
| `canManagePasses(session, guildId)` | `passes:write` |
| `canManageMembers(session, guildId)` | `members:write` |
| `canManageGuilds(session, guildId)` | `guilds:write` |
| `canViewActivity(session, guildId)` | `activity:read` |
| `canEditSettings(session, guildId)` | `settings:write` |
| `hasPermission(session, guildId, perm)` | Scoped check for any arbitrary permission |
| `hasRole(session, guildId, allowedRoles)` | Scoped check if user's role is in the list |
| `assertPermission(session, guildId, perm)` | Server-side guard — throws `PermissionDeniedError` on failure |

---

## API Route Enforcement

Backend route handlers are the authoritative security boundary. They resolve the session and target `guildId` dynamically before performing any mutations:

1. **Authentication**: Resolves the user's `Session` from the request token.
2. **Guild Scope Resolution**:
   - For route mutations affecting a specific entity (e.g., `PATCH` / `DELETE` on a Pass), the handler first retrieves the target resource (like the Pass itself) from the database to obtain its owning `guildId`.
   - For creations (e.g. `POST /api/passes`), the `guildId` is derived from the payload or the current active context (`getActiveGuildId()`).
3. **Assertion**: Calls `guardPermission` or `assertPermission` with the resolved `guildId`.

### API Enforcement Mapping
- `POST /api/passes` → resolves `guildId` from active context/body → guards `passes:write`
- `PATCH /api/passes?id=...` → fetches pass to get `guildId` → guards `passes:write`
- `DELETE /api/passes?id=...` → fetches pass to get `guildId` → guards `passes:write`
- `POST /api/members` → resolves `guildId` from active context → guards `members:write`
- `PATCH /api/members?id=...` → resolves `guildId` from active context → guards `members:write`
- `DELETE /api/members?id=...` → resolves `guildId` from active context → guards `members:write`
- `POST /api/guilds` → resolves `guildId` from active context → guards `guilds:write`
- `PATCH /api/guilds?id=...` → resolves `guildId` from query parameter → guards `guilds:write`
- `DELETE /api/guilds?id=...` → resolves `guildId` from query parameter → guards `guilds:write`
- `PATCH /api/settings` → resolves `guildId` from active context → guards `settings:write`

---

## Audit Logs (Permission Denials)

When `guardPermission` or `requireSessionAndPermission` detects a permission violation, it automatically logs a fire-and-forget `activity.permission_denied` audit event recording the actor details, the target `guildId`, the missing permission, and the user's role in that guild. This audit log operation is non-blocking to prevent delays in sending the HTTP 403 response.

---

## Switching the Active Mock Role during Development

For local mock mode development, the UI uses the active mock session defined in `apps/dashboard/lib/auth/session.ts`:

```ts
// apps/dashboard/lib/auth/session.ts
export const MOCK_ACTIVE_ROLE: Role = "readonly"; // Change to "owner" | "admin" | "moderator"
```

To demonstrate backend API enforcement independently, you can change `MOCK_API_ROLE` in the same file. For example, setting `MOCK_ACTIVE_ROLE = "admin"` (UI displays all buttons) and `MOCK_API_ROLE = "readonly"` (API rejects all writes with 403) validates that frontend presentation checks cannot bypass backend enforcement.

---

## Production Migration Guide

When transitioning to production, the scoped RBAC structure requires no changes to page gating or repositories. Implement the following:

1. **JWT Customization**: Customize token creation (in `apps/dashboard/lib/auth/session-store.ts`) to fetch roles for all joined guilds from the database and serialize them in the `roles` Record within the JWT payload.
2. **Session Resolver Hook**: Replace the client-side `useSession` hook in `apps/dashboard/lib/hooks/useSession.ts` (currently returning `MOCK_SESSION`) to fetch the active session from your authentication provider.

---

## File Reference

- `apps/dashboard/lib/auth/session.ts` — Definition of `Role`, `Permission`, `Session`, `ROLE_PERMISSIONS` and mock sessions.
- `apps/dashboard/lib/auth/session-store.ts` — JWT sign, verify, refresh, metadata extraction, and server-side session store.
- `apps/dashboard/lib/permissions.ts` — Pure permission helper functions (`hasPermission`, `hasRole`, `assertPermission`).
- `apps/dashboard/lib/auth/require-permission.ts` — Middleware wrapper functions (`guardPermission`, `requireSessionAndPermission`) and audit event recording.
