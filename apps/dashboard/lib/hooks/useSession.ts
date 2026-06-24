"use client";

/**
 * lib/hooks/useSession.ts
 *
 * Client-side hook that returns the current user session, or null when the
 * visitor is unauthenticated.
 *
 * Components that need to enforce access should use AdminGuard rather than
 * branching on the return value directly — AdminGuard is the single place
 * that renders the access-denied state.
 *
 * ⚠️  Production migration: Replace the return statement with a real auth
 *     SDK hook, e.g.:
 *       const { data: session } = useNextAuthSession();
 *       return (session?.user as Session) ?? null;
 */

import { getSession, type Session } from "@/lib/auth/session";

export function useSession(): Session | null {
  // TODO: Replace with real auth provider hook when backend auth is ready.
  // getSession() is the single source of truth — change it there, not here.
  return getSession();
}
