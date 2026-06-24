import Sidebar from "./Sidebar";
import Header from "./Header";
import AdminGuard from "./AdminGuard";
import type { Session } from "@/lib/auth/session";

/**
 * DashboardLayout wraps every management page with AdminGuard + Sidebar + Header.
 *
 * AdminGuard is applied here so the auth boundary is shared across all
 * management pages — no per-page guard is needed. If the visitor has no
 * session, AdminGuard renders the access-denied screen and children are
 * never mounted.
 *
 * The optional `session` prop is forwarded to the Sidebar so it can display
 * the current user's role badge. Pages that already resolve a session for
 * permission checks can pass it in; pages that don't may omit it.
 */
export default function DashboardLayout({
  title,
  children,
  session,
}: {
  title: string;
  children: React.ReactNode;
  /** Active user session — forwarded to the Sidebar for role display. */
  session?: Session | null;
}) {
  return (
    <AdminGuard>
      <div className="min-h-screen flex">
        <Sidebar session={session} />
        <div className="flex-1 ml-64">
          <Header title={title} />
          <main className="p-8">{children}</main>
        </div>
      </div>
    </AdminGuard>
  );
}
