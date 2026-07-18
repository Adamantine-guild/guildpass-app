# GuildPass Dashboard — Permission Model

This document describes the role-based access control (RBAC) system implemented
in the GuildPass dashboard. It covers supported roles, their permissions, how to
switch the active mock role during development, and guidance for wiring up real
authentication in production.

---

## Roles

The dashboard recognises four roles, ordered from most to least privileged:

| Role | Description |
|------|-------------|
| `owner` | Guild creator / contract deployer. Full read + write access. |
| `admin` | Full read + write access. Functionally identical to owner in this matrix. |
| `moderator` | Can read all resources and manage members, but cannot create/edit passes or change workspace settings. |
| `readonly` | Read-only access across all resources. Cannot trigger any mutation. |

---

## Permission Matrix

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

---

## Named Helper Functions

All UI gating and API enforcement uses named helpers from
`apps/dashboard/lib/permissions.ts`. Import from there — do **not** call
`session.permissions.includes(...)` directly.

| Helper | Guards |
|--------|--------|
| `canManagePasses(session)` | `passes:write` |
| `canManageMembers(session)` | `members:write` |
| `canManageGuilds(session)` | `guilds:write` |
| `canEditSettings(session)` | `settings:write` |
| `hasPermission(session, perm)` | Any arbitrary permission string |
| `assertPermission(session, perm)` | Server-side guard — throws `PermissionDeniedError` (HTTP 403) |

---

## UI Enforcement Summary

| Page | Read-only behaviour | Write behaviour |
|------|---------------------|-----------------|
| **Passes** | Table always visible | "Create Pass" button + Edit/Deactivate row actions hidden |
| **Members** | Table always visible | "Invite Member" button + Change Role/Remove row actions hidden |
| **Settings** | Page visible, all inputs `disabled`, amber read-only banner shown, Save hidden | All inputs enabled, Save button visible, submits via PATCH /api/settings |
| **Guilds** | Cards always visible | No write actions implemented yet |
| **Sidebar** | Role badge shown for all roles | N/A |

---

## API Enforcement

Every mutation route handler calls `assertPermission` **before** executing any
logic, using `MOCK_API_SESSION` (see "Two independent mock sessions" below). If
the session lacks the required permission, `assertPermission` throws
`PermissionDeniedError`, which the handler catches and converts to a `403` JSON
response.
POST /api/passes     → requires passes:write

DELETE /api/passes   → requires passes:write

POST /api/members    → requires members:write

DELETE /api/members  → requires members:write

POST /api/guilds     → requires guilds:write

DELETE /api/guilds   → requires guilds:write

PATCH /api/settings  → requires settings:write

> **Important:** UI hiding (hiding buttons) is a UX convenience only. The API
> layer is the authoritative security boundary. Both layers enforce the same
> permissions independently (defence in depth).

Currently, the **Settings** page is wired end-to-end: clicking "Save Changes"
calls `PATCH /api/settings`, and a `403` response (lack of `settings:write`)
is surfaced to the user as an "Access denied" alert. **Passes** and **Members**
have enforcement-ready API routes (`POST`/`DELETE`), but their UI buttons are
not yet wired to call them — this is tracked as a fast-follow, not a gap in
the permission model itself.

---

## Two independent mock sessions (UI vs API)

There are two separate mock session constants in `lib/auth/session.ts`,
deliberately kept independent so the API layer's enforcement can be
demonstrated as genuinely separate from whatever the UI displays:

| Constant | Used by | Purpose |
|----------|---------|---------|
| `MOCK_ACTIVE_ROLE` / `MOCK_SESSION` | `useSession()` (pages, UI gating) | Controls what buttons/inputs render |
| `MOCK_API_ROLE` / `MOCK_API_SESSION` | All `app/api/**/route.ts` mutation handlers | Controls what the backend actually allows |

By default both point at the same role. To **prove** the backend doesn't just
trust the frontend, set them differently:

```ts
// lib/auth/session.ts
export const MOCK_ACTIVE_ROLE: Role = "admin";    // UI: shows all write buttons
export const MOCK_API_ROLE: Role    = "readonly"; // API: rejects every mutation with 403
```

With that configuration, the Settings page will show the Save button (UI
thinks you're an admin), but clicking it will return a 403 and show "Access
denied" (the API independently checked and disagreed). This is the
demonstrable proof that enforcement does not rely on the UI alone.

---

## Switching the Active Mock Role

During development the active **UI** session is controlled by a single
constant in `apps/dashboard/lib/auth/session.ts`:

```ts
// Change this to test a different role in the UI
export const MOCK_ACTIVE_ROLE: Role = "readonly";
//                                     ↑ "owner" | "admin" | "moderator" | "readonly"
```

After changing the value, save the file. Next.js hot-reload picks up the change
automatically — no server restart needed. To test the **API** layer
independently, change `MOCK_API_ROLE` instead (see above).

### Quick verification checklist

| Role | Expected behaviour |
|------|--------------------|
| `readonly` | Settings inputs disabled + banner; no Create/Invite buttons; no row actions |
| `moderator` | Members Invite + row actions visible; Passes/Settings write actions still hidden |
| `admin` | All write controls visible; Settings fully editable |
| `owner` | Identical to admin |

---

## Production Migration Guide

When real authentication is ready, make the following changes (and nothing else
in the permission layer itself):

### 1. Replace `useSession` hook

`apps/dashboard/lib/hooks/useSession.ts` currently returns `MOCK_SESSION`.
Replace the body with your real auth SDK:

```ts
// Example: next-auth
import { useSession as useNextAuth } from "next-auth/react";

export function useSession(): Session {
  const { data } = useNextAuth();
  return data?.user as Session;
}
```

### 2. Replace `MOCK_API_SESSION` in API routes

Each API route handler currently imports `MOCK_API_SESSION`. Replace it with a
real session resolved from the incoming request:

```ts
// Example: extract from request headers / JWT
const session = await getSessionFromRequest(request);
assertPermission(session, "passes:write");
```

### 3. No changes needed in

- `lib/permissions.ts` — helpers work on any `Session` object
- `lib/auth/session.ts` — the `Role`, `Permission`, and `ROLE_PERMISSIONS`
  types remain the canonical source of truth
- Any UI page — they call `useSession()` which is already the swap point

---

## File Reference
apps/dashboard/

├── lib/

│   ├── auth/

│   │   └── session.ts          ← Role types, Session interface, ROLE_PERMISSIONS,

│   │                              mock sessions, MOCK_SESSION (UI) + MOCK_API_SESSION (API)

│   ├── permissions.ts          ← hasPermission, canManage*, assertPermission

│   └── hooks/

│       └── useSession.ts       ← Client hook (swap point for real auth)

├── components/

│   ├── DashboardLayout.tsx     ← Forwards session prop to Sidebar

│   └── Sidebar.tsx             ← Displays role badge

└── app/

├── passes/page.tsx         ← Gated by canManagePasses (UI only, not yet wired to API)

├── members/page.tsx        ← Gated by canManageMembers (UI only, not yet wired to API)

├── settings/page.tsx       ← Gated by canEditSettings; Save wired to PATCH /api/settings

└── api/

├── passes/route.ts     ← POST/DELETE guarded by assertPermission(MOCK_API_SESSION, ...)

├── members/route.ts    ← POST/DELETE guarded by assertPermission(MOCK_API_SESSION, ...)

├── guilds/route.ts     ← POST/DELETE guarded by assertPermission(MOCK_API_SESSION, ...)

└── settings/route.ts   ← PATCH guarded by assertPermission(MOCK_API_SESSION, ...)

---

## Related: Multi-Tenant Data Isolation

RBAC governs **who** may act; guild scoping governs **which data** they may
act on. The repository layer structurally enforces that every pass/member
query is scoped to a single guild, so an admin of one guild can never read
or modify another guild's data — even through a buggy route handler. See
[multi-tenancy.md](multi-tenancy.md) for the full isolation guarantee and
its contract tests.
