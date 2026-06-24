"use client";

/**
 * components/AdminGuard.tsx
 *
 * Route-level access guard for all management pages.
 *
 * Renders its children only when a valid session exists. When the session is
 * null (unauthenticated visitor), it renders an access-denied screen instead.
 *
 * Usage: DashboardLayout wraps its content with AdminGuard so every management
 * page inherits the boundary automatically — no per-page guard is needed.
 *
 * ── Plugging in live auth ─────────────────────────────────────────────────────
 * 1. Update getSession() in lib/auth/session.ts to call your real auth provider.
 * 2. If session resolution is async, add a loading state here (isLoading).
 * 3. Page content does not need to change.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { useSession } from "@/lib/hooks/useSession";

export default function AdminGuard({ children }: { children: React.ReactNode }) {
  const session = useSession();

  if (session === null) {
    return <AccessDenied />;
  }

  return <>{children}</>;
}

function AccessDenied() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-50">
      <div className="max-w-md w-full mx-4">
        <div className="bg-white border border-slate-200 rounded-xl p-8 text-center shadow-sm">
          <div className="w-16 h-16 bg-red-100 rounded-full flex items-center justify-center mx-auto mb-4">
            <span className="text-3xl" aria-hidden>🔒</span>
          </div>

          <h1 className="text-xl font-semibold text-slate-800 mb-2">Access Denied</h1>
          <p className="text-slate-500 text-sm mb-6">
            You must be authenticated to view this page.
          </p>

          <div className="bg-slate-50 border border-slate-200 rounded-lg p-4 text-left">
            <p className="text-xs font-semibold text-slate-600 mb-1">Local development</p>
            <p className="text-xs text-slate-500 leading-relaxed">
              Add{" "}
              <code className="font-mono bg-slate-100 px-1 py-0.5 rounded text-slate-700">
                NEXT_PUBLIC_MOCK_ADMIN=true
              </code>{" "}
              to{" "}
              <code className="font-mono bg-slate-100 px-1 py-0.5 rounded text-slate-700">
                apps/dashboard/.env.local
              </code>{" "}
              and restart the dev server to enable mock admin access.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
