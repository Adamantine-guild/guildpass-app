"use client";
/**
 * components/RoleEditor.tsx
 *
 * Controlled editor for a member's roles. Renders the current roles as
 * removable chips and offers the remaining supported roles through a select —
 * so an unsupported or duplicate role can never be produced from the UI. The
 * API route still validates server-side (UI gating is convenience only).
 *
 * Stateless: it calls `onChange` with the next roles array and lets the parent
 * own persistence + optimistic rollback.
 *
 * Accessibility: role additions and removals are announced through a
 * visually-hidden aria-live="polite" region so screen reader users get audible
 * confirmation. All interactive controls expose a visible focus-visible ring.
 */
import { useRef, useState } from "react";
import { MEMBER_ROLES, addRole, removeRole } from "@/lib/member-roles";

interface RoleEditorProps {
  roles: string[];
  /** When true, render read-only chips (no remove buttons, no add control). */
  disabled?: boolean;
  onChange: (roles: string[]) => void;
}

export default function RoleEditor({ roles, disabled, onChange }: RoleEditorProps) {
  const available = MEMBER_ROLES.filter((r) => !roles.includes(r));

  // Live-region message announced to assistive tech on each role change.
  const [announcement, setAnnouncement] = useState("");
  // Track the last message so we can nudge identical consecutive announcements
  // (some screen readers skip a live update whose text is unchanged).
  const lastRef = useRef("");

  const announce = (message: string) => {
    const next = message === lastRef.current ? `${message}\u00A0` : message;
    lastRef.current = next;
    setAnnouncement(next);
  };

  const handleRemove = (role: string) => {
    onChange(removeRole(roles, role));
    announce(`Removed role ${role}`);
  };

  const handleAdd = (role: string) => {
    onChange(addRole(roles, role));
    announce(`Added role ${role}`);
  };

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {roles.length === 0 && (
        <span className="text-slate-400 text-xs italic">None</span>
      )}

      {roles.map((role) => (
        <span
          key={role}
          className="inline-flex items-center gap-1 px-2 py-1 bg-slate-100 rounded text-xs text-slate-600"
        >
          {role}
          {!disabled && (
            <button
              type="button"
              aria-label={`Remove role ${role}`}
              title={`Remove role ${role}`}
              onClick={() => handleRemove(role)}
              className="text-slate-400 hover:text-red-600 leading-none rounded-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-1"
            >
              ×
            </button>
          )}
        </span>
      ))}

      {!disabled && available.length > 0 && (
        <select
          aria-label="Add role"
          value=""
          onChange={(e) => {
            const role = e.target.value;
            e.target.value = "";
            if (role) handleAdd(role);
          }}
          className="text-xs border border-slate-200 rounded px-1.5 py-1 text-slate-600 bg-white focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-1"
        >
          <option value="" disabled>
            + Add role
          </option>
          {available.map((r) => (
            <option key={r} value={r}>
              {r}
            </option>
          ))}
        </select>
      )}

      {/* Visually hidden polite live region for screen reader announcements. */}
      <span
        aria-live="polite"
        aria-atomic="true"
        className="sr-only"
      >
        {announcement}
      </span>
    </div>
  );
}