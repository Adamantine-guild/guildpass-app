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

export type SettingsValidationResult =
  | { ok: true; value: Partial<DashboardSettings> }
  | { ok: false; errors: FieldError[] };

const settingsPatchSchema = z
  .object({
    workspaceName: z
      .string({ invalid_type_error: "Workspace name is required." })
      .trim()
      .min(1, { message: "Workspace name is required." })
      .max(MAX_TEXT_LENGTH, {
        message: `Workspace name must be ${MAX_TEXT_LENGTH} characters or fewer.`,
      })
      .optional(),
    displayName: z
      .string({ invalid_type_error: "Display name is required." })
      .trim()
      .min(1, { message: "Display name is required." })
      .max(MAX_TEXT_LENGTH, {
        message: `Display name must be ${MAX_TEXT_LENGTH} characters or fewer.`,
      })
      .optional(),
    timezone: z
      .string({ invalid_type_error: "Timezone is required." })
      .refine((timezone) => ALLOWED_TIMEZONES.includes(timezone), {
        message: "Timezone must be a supported IANA timezone.",
      })
      .optional(),
    email: z
      .string({ invalid_type_error: "A valid email address is required." })
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

  const patch = result.data as Partial<DashboardSettings>;
  const supportedKeys = ["workspaceName", "displayName", "timezone", "email"];
  const providedSupportedFields = supportedKeys.filter((key) =>
    Object.prototype.hasOwnProperty.call(input, key)
  );

  if (providedSupportedFields.length === 0) {
    return {
      ok: false,
      errors: [{ field: "_root", message: "No supported settings fields were provided." }],
    };
  }

  return { ok: true, value: patch };
}

export { settingsPatchSchema };
