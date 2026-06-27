"use client";

/**
 * app/settings/page.tsx
 *
 * Workspace settings page.
 *
 * Visibility rules:
 *  - Page is accessible to ALL roles (settings:read).
 *  - When canEditSettings() is false:
 *      • A read-only info banner is displayed at the top.
 *      • All input / select fields are rendered with the `disabled` attribute.
 *      • The "Save Changes" button is hidden.
 *  - When canEditSettings() is true, the page is fully interactive.
 *
 * Note: handleSave calls PATCH /api/settings. The server-side route handler
 * is the authoritative enforcement point (see app/api/settings/route.ts) —
 * this client only reacts to a 403 response, it does not decide permissions.
 */

import DashboardLayout from "@/components/DashboardLayout";
import { useSession } from "@/lib/hooks/useSession";
import { canEditSettings } from "@/lib/permissions";
import { useEffect, useState } from "react";

export default function SettingsPage() {
  const session = useSession();
  const canEdit = canEditSettings(session);
  const [settings, setSettings] = useState<any>({
    workspaceName: "GuildPass DAO",
    timezone: "UTC",
    email: "admin@guildpass.xyz"
  });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      try {
        const res = await fetch("/api/settings");
        if (res.ok) {
          const data = await res.json();
          setSettings(data);
        }
      } catch (err) {
        console.warn("Error fetching settings:", err);
      } finally {
        setLoading(false);
      }
    }
    load();
  }, []);

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();

    const res = await fetch("/api/settings", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ workspaceName: settings.workspaceName })
    });

    if (res.status === 403) {
      const body = await res.json().catch(() => ({}));
      alert(`Access denied: ${body.error ?? "settings:write permission required"}`);
      return;
    }

    if (res.ok) {
      alert("Settings saved successfully.");
      return;
    }

    alert("An unexpected error occurred. Please try again.");
  }

  if (loading) {
    return (
      <DashboardLayout title="Settings" session={session}>
        <div className="text-center py-12 text-slate-500">Loading settings...</div>
      </DashboardLayout>
    );
  }

  const displaySettings = settings || {
    workspaceName: "GuildPass DAO",
    timezone: "UTC",
    email: "admin@guildpass.xyz"
  };

  return (
    <DashboardLayout title="Settings" session={session}>

      {/* ── Read-only banner ─────────────────────────────────────────────── */}
      {!canEdit && (
        <div
          role="status"
          aria-live="polite"
          className="flex items-start gap-3 mb-6 bg-amber-50 border border-amber-200 rounded-xl px-5 py-4"
        >
          <span className="text-amber-500 text-xl leading-none mt-0.5" aria-hidden>🔒</span>
          <div>
            <p className="text-sm font-semibold text-amber-800">Read-only access</p>
            <p className="text-sm text-amber-700 mt-0.5">
              You can view settings but cannot make changes. Contact an admin to
              update workspace configuration.
            </p>
          </div>
        </div>
      )}

      <form onSubmit={handleSave}>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">

          {/* ── General Settings ─────────────────────────────────────────── */}
          <div className="bg-white border border-slate-200 rounded-xl p-6">
            <h3 className="text-lg font-semibold text-slate-800 mb-4">General Settings</h3>
            <div className="space-y-4">
              <div>
                <label
                  htmlFor="workspace-name"
                  className="block text-sm font-medium text-slate-700 mb-1"
                >
                  Workspace Name
                </label>
                <input
                  id="workspace-name"
                  type="text"
                  value={settings.workspaceName}
                  onChange={(e) => setSettings({ ...settings, workspaceName: e.target.value })}
                  disabled={!canEdit}
                  className={`w-full border rounded-lg px-4 py-2 transition-colors ${canEdit
                      ? "border-slate-300 text-slate-800 focus:outline-none focus:ring-2 focus:ring-violet-500"
                      : "border-slate-200 bg-slate-50 text-slate-400 cursor-not-allowed"
                    }`}
                />
              </div>
              <div>
                <label
                  htmlFor="timezone"
                  className="block text-sm font-medium text-slate-700 mb-1"
                >
                  Timezone
                </label>
                <select
                  id="timezone"
                  defaultValue={displaySettings.timezone}
                  disabled={!canEdit}
                  className={`w-full border rounded-lg px-4 py-2 transition-colors ${canEdit
                      ? "border-slate-300 text-slate-800 focus:outline-none focus:ring-2 focus:ring-violet-500"
                      : "border-slate-200 bg-slate-50 text-slate-400 cursor-not-allowed"
                    }`}
                >
                  <option>UTC</option>
                  <option>America/New_York</option>
                  <option>Europe/London</option>
                </select>
              </div>
            </div>
          </div>

          {/* ── Profile ──────────────────────────────────────────────────── */}
          <div className="bg-white border border-slate-200 rounded-xl p-6">
            <h3 className="text-lg font-semibold text-slate-800 mb-4">Profile</h3>
            <div className="space-y-4">
              <div>
                <label
                  htmlFor="display-name"
                  className="block text-sm font-medium text-slate-700 mb-1"
                >
                  Display Name
                </label>
                <input
                  id="display-name"
                  type="text"
                  defaultValue={session.name}
                  disabled={!canEdit}
                  className={`w-full border rounded-lg px-4 py-2 transition-colors ${canEdit
                      ? "border-slate-300 text-slate-800 focus:outline-none focus:ring-2 focus:ring-violet-500"
                      : "border-slate-200 bg-slate-50 text-slate-400 cursor-not-allowed"
                    }`}
                />
              </div>
              <div>
                <label
                  htmlFor="email"
                  className="block text-sm font-medium text-slate-700 mb-1"
                >
                  Email
                </label>
                <input
                  id="email"
                  type="email"
                  defaultValue={displaySettings.email}
                  disabled={!canEdit}
                  className={`w-full border rounded-lg px-4 py-2 transition-colors ${canEdit
                      ? "border-slate-300 text-slate-800 focus:outline-none focus:ring-2 focus:ring-violet-500"
                      : "border-slate-200 bg-slate-50 text-slate-400 cursor-not-allowed"
                    }`}
                />
              </div>
            </div>
          </div>
        </div>

        {/* ── Save button — write roles only ───────────────────────────────── */}
        {canEdit && (
          <div className="mt-6 flex justify-end">
            <button
              id="btn-save-settings"
              type="submit"
              className="bg-violet-600 hover:bg-violet-700 text-white text-sm font-medium px-6 py-2.5 rounded-lg transition-colors"
            >
              Save Changes
            </button>
          </div>
        )}
      </form>
    </DashboardLayout>
  );
}
