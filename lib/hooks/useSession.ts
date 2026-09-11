"use client";

/**
 * lib/hooks/useSession.ts
 *
 * Client-side hook that returns the current user session.
 *
 * Currently wraps the mock session so all client components can be migrated
 * to real authentication by changing this single file.
 *
 * ⚠️  Production migration: Replace the return statement with a real auth
 *     SDK hook, e.g.:
 *       const { data: session } = useNextAuthSession();
 *       return session?.user as Session;
 */

import { MOCK_SESSION, type Session } from "@/lib/auth/session";

export function useSession(): Session {
  // TODO: Replace with real auth provider hook when backend auth is ready.
  // The rest of the codebase imports from here, so this is the only change needed.
  return MOCK_SESSION;
}
