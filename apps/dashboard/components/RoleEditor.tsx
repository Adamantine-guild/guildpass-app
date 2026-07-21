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
 */

import { MEMBER_ROLES, addRole, removeRole } from "@/lib/member-roles";

interface RoleEditorProps {
  roles: string[];
  /** When true, render read-only chips (no remove buttons, no add control). */
  disabled?: boolean;
  onChange: (roles: string[]) => void;
}

export default function RoleEditor({ roles, disabled, onChange }: RoleEditorProps) {
  const available = MEMBER_ROLES.filter((r) => !roles.includes(r));

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
              onClick={() => onChange(removeRole(roles, role))}
              className="text-slate-400 hover:text-red-600 leading-none"
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
            if (role) onChange(addRole(roles, role));
          }}
          className="text-xs border border-slate-200 rounded px-1.5 py-1 text-slate-600 bg-white"
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
    </div>
  );
}
