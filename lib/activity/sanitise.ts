/**
 * Per-event-type allowlists for webhook data stored as activity metadata.
 *
 * Only fields listed below are retained. All other fields in the incoming
 * `data` object are dropped to prevent leaking sensitive or unexpected
 * payload contents through the activity log.
 */
const ALLOWED_DATA_FIELDS: Record<string, Set<string>> = {
  "membership.created": new Set(["id", "name", "wallet"]),
  "membership.updated": new Set(["id", "name", "wallet"]),
  "pass.created": new Set(["id", "name"]),
  "pass.updated": new Set(["id", "name"]),
  "guild.updated": new Set(["id", "name"]),
  "verification.completed": new Set(["id", "wallet"]),
};

/**
 * Sanitize a webhook payload's `data` object for safe storage as activity
 * metadata. Returns only the fields listed in the allowlist for the given
 * event type. Unknown event types receive an empty object.
 *
 * The raw webhook body, signature header, and environment secrets are never
 * passed to this function — it operates only on the already-parsed `data`
 * object.
 */
export function sanitiseWebhookData(
  type: string,
  data: Record<string, unknown>
): Record<string, unknown> {
  const allowlist = ALLOWED_DATA_FIELDS[type];
  if (!allowlist) {
    return {};
  }

  const sanitised: Record<string, unknown> = {};
  for (const key of allowlist) {
    if (key in data) {
      sanitised[key] = data[key];
    }
  }
  return sanitised;
}

export function getSanitisedDescription(
  type: string,
  data: Record<string, unknown>
): string {
  const name = typeof data.name === "string" && data.name.length > 0 ? data.name : undefined;
  const wallet = typeof data.wallet === "string" && data.wallet.length > 0 ? data.wallet : undefined;
  const label = name ?? wallet ?? "Unknown";

  switch (type) {
    case "membership.created":
      return `New member joined: ${label}`;
    case "membership.updated":
      return `Member ${label} updated`;
    case "pass.created":
      return `New pass created: ${label}`;
    case "pass.updated":
      return `Pass updated: ${label}`;
    case "guild.updated":
      return `Guild settings updated: ${label}`;
    case "verification.completed":
      return `Verification completed for ${label}`;
    default:
      return `Webhook received: ${type}`;
  }
}
