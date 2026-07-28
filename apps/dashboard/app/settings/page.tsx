  "use client";

import { useState, type FormEvent } from "react";
import DashboardLayout from "@/components/DashboardLayout";
import { useSession } from "@/lib/hooks/useSession";
import { canEditSettings } from "@/lib/permissions";

export default function SettingsPage() {
  const session = useSession();
  const canEdit = canEditSettings(session, session.activeGuildId);

  const [workspaceName, setWorkspaceName] = useState("GuildPass DAO");
  const [timezone, setTimezone] = useState("UTC");
  const [displayName, setDisplayName] = useState("Admin");
  const [email, setEmail] = useState("admin@guildpass.xyz");
  const [emailError, setEmailError] = useState<string | null>(null);
  const [emailTouched, setEmailTouched] = useState(false);
  const [theme, setTheme] = useState<"light" | "dark">("light");
  const [isSaving, setIsSaving] = useState(false);

  const saveMutation = { isPending: isSaving };

  const validateEmail = (value: string) => {
    const trimmed = value.trim();
    if (!trimmed) {
      setEmailError("Email is required.");
      return;
    }

    const isValid = /.+@.+\..+/.test(trimmed);
    setEmailError(isValid ? null : "Please enter a valid email address.");
  };

  const isFormInvalid = Boolean(emailError) || !workspaceName.trim() || !displayName.trim() || !email.trim();

  const handleSave = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    if (!canEdit || isFormInvalid) {
      return;
    }

    setIsSaving(true);
    try {
      const response = await fetch("/api/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ workspaceName, timezone, displayName, email }),
      });

      if (!response.ok) {
        throw new Error("Unable to save settings right now.");
      }

      setEmailTouched(false);
      setEmailError(null);
    } catch (error) {
      setEmailTouched(true);
      setEmailError(error instanceof Error ? error.message : "Unable to save settings right now.");
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <DashboardLayout title="Settings" session={session}>
      {/* Read-only banner */}
      {!canEdit && (
        <div
          role="status"
          aria-live="polite"
          className="mb-6 flex items-start gap-3 rounded-xl border border-amber-200 bg-amber-50 px-5 py-4"
        >
          <svg
            aria-hidden="true"
            className="mt-0.5 h-5 w-5 shrink-0 text-amber-500"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v2h8z"
            />
          </svg>

          <div>
            <p className="text-sm font-semibold text-amber-800">
              Read-only access
            </p>
            <p className="mt-0.5 text-sm text-amber-700">
              You can view settings but cannot make changes. Contact an admin
              to update workspace configuration.
            </p>
          </div>
        </div>
      )}

      <form onSubmit={handleSave}>
        {/* General Settings and Profile */}
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          {/* General Settings */}
          <div className="rounded-xl border border-slate-200 bg-white p-6 dark:border-slate-700 dark:bg-slate-900">
            <h3 className="mb-4 text-lg font-semibold text-slate-800 dark:text-white">
              General Settings
            </h3>

            <div className="space-y-4">
              <div>
                <label
                  htmlFor="workspace-name"
                  className="mb-1 block text-sm font-medium text-slate-700 dark:text-slate-300"
                >
                  Workspace Name
                </label>

                <input
                  id="workspace-name"
                  type="text"
                  value={workspaceName}
                  onChange={(e) => setWorkspaceName(e.target.value)}
                  disabled={!canEdit || saveMutation.isPending}
                  className={`w-full rounded-lg border px-4 py-2 transition-colors ${
                    canEdit
                      ? "border-slate-300 bg-white text-slate-800 focus:outline-none focus:ring-2 focus:ring-violet-500 dark:border-slate-600 dark:bg-slate-800 dark:text-white"
                      : "cursor-not-allowed border-slate-200 bg-slate-50 text-slate-400 dark:border-slate-700 dark:bg-slate-800"
                  } ${
                    saveMutation.isPending ? "opacity-50" : ""
                  }`}
                />
              </div>

              <div>
                <label
                  htmlFor="timezone"
                  className="mb-1 block text-sm font-medium text-slate-700 dark:text-slate-300"
                >
                  Timezone
                </label>

                <select
                  id="timezone"
                  value={timezone}
                  onChange={(e) => setTimezone(e.target.value)}
                  disabled={!canEdit || saveMutation.isPending}
                  className={`w-full rounded-lg border px-4 py-2 transition-colors ${
                    canEdit
                      ? "border-slate-300 bg-white text-slate-800 focus:outline-none focus:ring-2 focus:ring-violet-500 dark:border-slate-600 dark:bg-slate-800 dark:text-white"
                      : "cursor-not-allowed border-slate-200 bg-slate-50 text-slate-400 dark:border-slate-700 dark:bg-slate-800"
                  } ${
                    saveMutation.isPending ? "opacity-50" : ""
                  }`}
                >
                  <option value="UTC">UTC</option>
                  <option value="America/New_York">
                    America/New_York
                  </option>
                  <option value="Europe/London">Europe/London</option>
                </select>
              </div>
            </div>
          </div>

          {/* Profile */}
          <div className="rounded-xl border border-slate-200 bg-white p-6 dark:border-slate-700 dark:bg-slate-900">
            <h3 className="mb-4 text-lg font-semibold text-slate-800 dark:text-white">
              Profile
            </h3>

            <div className="space-y-4">
              <div>
                <label
                  htmlFor="display-name"
                  className="mb-1 block text-sm font-medium text-slate-700 dark:text-slate-300"
                >
                  Display Name
                </label>

                <input
                  id="display-name"
                  type="text"
                  value={displayName}
                  onChange={(e) => setDisplayName(e.target.value)}
                  disabled={!canEdit || saveMutation.isPending}
                  className={`w-full rounded-lg border px-4 py-2 transition-colors ${
                    canEdit
                      ? "border-slate-300 bg-white text-slate-800 focus:outline-none focus:ring-2 focus:ring-violet-500 dark:border-slate-600 dark:bg-slate-800 dark:text-white"
                      : "cursor-not-allowed border-slate-200 bg-slate-50 text-slate-400 dark:border-slate-700 dark:bg-slate-800"
                  } ${
                    saveMutation.isPending ? "opacity-50" : ""
                  }`}
                />
              </div>

              <div>
                <label
                  htmlFor="email"
                  className="mb-1 block text-sm font-medium text-slate-700 dark:text-slate-300"
                >
                  Email
                </label>

                <input
                  id="email"
                  type="email"
                  value={email}
                  onChange={(e) => {
                    setEmail(e.target.value);

                    if (emailTouched) {
                      validateEmail(e.target.value);
                    }
                  }}
                  onBlur={(e) => {
                    setEmailTouched(true);
                    validateEmail(e.target.value);
                  }}
                  disabled={!canEdit || saveMutation.isPending}
                  aria-describedby={
                    emailError && emailTouched ? "email-error" : undefined
                  }
                  aria-invalid={
                    emailError !== null && emailTouched ? true : undefined
                  }
                  className={`w-full rounded-lg border px-4 py-2 transition-colors ${
                    !canEdit
                      ? "cursor-not-allowed border-slate-200 bg-slate-50 text-slate-400 dark:border-slate-700 dark:bg-slate-800"
                      : emailError && emailTouched
                        ? "border-red-400 bg-white text-slate-800 focus:outline-none focus:ring-2 focus:ring-red-400 dark:bg-slate-800 dark:text-white"
                        : "border-slate-300 bg-white text-slate-800 focus:outline-none focus:ring-2 focus:ring-violet-500 dark:border-slate-600 dark:bg-slate-800 dark:text-white"
                  } ${
                    saveMutation.isPending ? "opacity-50" : ""
                  }`}
                />

                {emailError && emailTouched && (
                  <p
                    id="email-error"
                    role="alert"
                    className="mt-1.5 flex items-center gap-1 text-xs text-red-600"
                  >
                    <svg
                      aria-hidden="true"
                      className="h-3.5 w-3.5 shrink-0"
                      fill="currentColor"
                      viewBox="0 0 20 20"
                    >
                      <path
                        fillRule="evenodd"
                        d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z"
                        clipRule="evenodd"
                      />
                    </svg>

                    {emailError}
                  </p>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* Appearance */}
        <div className="mt-6 rounded-xl border border-slate-200 bg-white p-6 dark:border-slate-700 dark:bg-slate-900">
          <h3 className="mb-1 text-lg font-semibold text-slate-800 dark:text-white">
            Appearance
          </h3>

          <p className="mb-4 text-sm text-slate-500 dark:text-slate-400">
            Choose how the dashboard looks.
          </p>

          <div
            role="group"
            aria-label="Theme preference"
            className="inline-flex rounded-lg border border-slate-200 bg-slate-50 p-1 dark:border-slate-700 dark:bg-slate-800"
          >
            <button
              type="button"
              onClick={() => canEdit && setTheme("light")}
              aria-pressed={theme === "light"}
              disabled={!canEdit}
              aria-disabled={!canEdit}
              className={`rounded-md px-4 py-2 text-sm font-medium transition-colors ${
                !canEdit
                  ? "cursor-not-allowed text-slate-400 dark:text-slate-500"
                  : theme === "light"
                    ? "bg-white text-slate-900 shadow-sm dark:bg-slate-700 dark:text-white"
                    : "text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200"
              }`}
            >
              Light
            </button>

            <button
              type="button"
              onClick={() => canEdit && setTheme("dark")}
              aria-pressed={theme === "dark"}
              disabled={!canEdit}
              aria-disabled={!canEdit}
              className={`rounded-md px-4 py-2 text-sm font-medium transition-colors ${
                !canEdit
                  ? "cursor-not-allowed text-slate-400 dark:text-slate-500"
                  : theme === "dark"
                    ? "bg-slate-700 text-white shadow-sm"
                    : "text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200"
              }`}
            >
              Dark
            </button>
          </div>
        </div>

        {/* Save button */}
        {canEdit && (
          <div className="mt-6 flex justify-end">
            <button
              id="btn-save-settings"
              type="submit"
              disabled={saveMutation.isPending || isFormInvalid}
              aria-disabled={isFormInvalid ? true : undefined}
              className="flex items-center gap-2 rounded-lg bg-violet-600 px-6 py-2.5 text-sm font-medium text-white transition-colors hover:bg-violet-700 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {saveMutation.isPending && (
                <span className="h-4 w-4 animate-spin rounded-full border-2 border-white/30 border-t-white" />
              )}

              {saveMutation.isPending ? "Saving..." : "Save Changes"}
            </button>
          </div>
        )}
      </form>
    </DashboardLayout>
  );
}