/**
 * lib/validation/settings.ts
 *
 * Validation for PATCH /api/settings. Returns field-level errors in the same
 * `{ field, message }` shape the activity route already uses, so the client can
 * surface per-field messages. Validation is partial: only the fields present in
 * the request body are checked, and at least one supported field is required.
 */

import { z } from "zod";
import {
  ALLOWED_TIMEZONES,
  MAX_TEXT_LENGTH,
  type DashboardSettings,
} from "@/lib/settings";

export interface FieldError {
  field: string;
  message: string;
}

/**
 * Accepted patch shape for settings updates. Public settings fields plus the
 * write-only `webhookForwardingSecret` (a plaintext string on write, `null`
 * or "" to clear). Secret values are never returned on reads — see
 * lib/settings.ts `WriteOnlySecret`.
 */
export type SettingsPatchPayload = Partial<DashboardSettings> & {
  webhookForwardingSecret?: string | null;
};

export type SettingsValidationResult =
  | { ok: true; value: SettingsPatchPayload }
  | { ok: false; errors: FieldError[] };

const settingsPatchSchema = z
  .object({
    workspaceName: z
      .string({ error: "Workspace name is required." })
      .trim()
      .min(1, { message: "Workspace name is required." })
      .max(MAX_TEXT_LENGTH, {
        message: `Workspace name must be ${MAX_TEXT_LENGTH} characters or fewer.`,
      })
      .optional(),
    displayName: z
      .string({ error: "Display name is required." })
      .trim()
      .min(1, { message: "Display name is required." })
      .max(MAX_TEXT_LENGTH, {
        message: `Display name must be ${MAX_TEXT_LENGTH} characters or fewer.`,
      })
      .optional(),
    timezone: z.enum(ALLOWED_TIMEZONES, {
      error: `Timezone must be one of: ${ALLOWED_TIMEZONES.join(", ")}.`,
    }).optional(),
    email: z
      .string({ error: "A valid email address is required." })
      .trim()
      .email({ message: "A valid email address is required." })
      .optional(),
  })
  .passthrough();

function mapZodErrors(errors: z.ZodIssue[]): FieldError[] {
  return errors.map((issue) => ({
    field: issue.path.length > 0 ? issue.path.join(".") : "_root",
    message: issue.message,
  }));
}

export function validateSettingsPatch(input: unknown): SettingsValidationResult {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    return {
      ok: false,
      errors: [{ field: "_root", message: "Request body must be a JSON object." }],
    };
  }

  const result = settingsPatchSchema.safeParse(input);
  if (!result.success) {
    return { ok: false, errors: mapZodErrors(result.error.issues) };
  }

  const supportedKeys = ["workspaceName", "displayName", "timezone", "email", "webhookForwardingSecret"] as const;
  const providedSupportedFields = supportedKeys.filter((key) =>
    Object.prototype.hasOwnProperty.call(input, key)
  );

  if (providedSupportedFields.length === 0) {
    return {
      ok: false,
      errors: [{ field: "_root", message: "No supported settings fields were provided." }],
    };
  }

  // Only supported keys reach the caller: the schema uses .passthrough() so
  // unknown keys parse successfully, but they must never be merged into the
  // persisted document.
  const raw = result.data as Record<string, unknown>;
  const rawInput = input as Record<string, unknown>;
  const patch: SettingsPatchPayload = {};
  for (const key of providedSupportedFields) {
    (patch as Record<string, unknown>)[key] = key === "webhookForwardingSecret" ? rawInput[key] : raw[key];
  }

  if (
    "webhookForwardingSecret" in patch &&
    patch.webhookForwardingSecret !== null &&
    typeof patch.webhookForwardingSecret !== "string"
  ) {
    return {
      ok: false,
      errors: [{ field: "webhookForwardingSecret", message: "webhookForwardingSecret must be a string." }],
    };
  }

  return { ok: true, value: patch };
}

export { settingsPatchSchema };

// ---------------------------------------------------------------------------
// Pure client-usable predicates
// ---------------------------------------------------------------------------

/**
 * Validates a single email value against the same rules the server uses.
 *
 * Returns `null` when the value is valid (or empty — the field is optional),
 * otherwise returns a human-readable error message string.
 *
 * Safe to call from both client and server code because this file has no
 * server-only imports.
 */
export function validateEmailField(value: string): string | null {
  const trimmed = value.trim();
  // Empty is allowed — the field is optional.
  if (trimmed === "") return null;

  if (trimmed.length > MAX_TEXT_LENGTH) {
    return `Email must be ${MAX_TEXT_LENGTH} characters or fewer.`;
  }

  const result = settingsPatchSchema.shape.email.safeParse(trimmed);
  if (!result.success) {
    return result.error.issues[0]?.message ?? "A valid email address is required.";
  }

  return null;
}
