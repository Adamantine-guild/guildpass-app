import type { SubscriberRegistry } from "./dispatch-types.js";

/**
 * Build a subscriber registry from an explicit guildId -> URL(s) mapping.
 * Intended for tests and for constructing a registry from your own config
 * source (database, admin UI, etc).
 */
export function createSubscriberRegistry(
  mapping: Record<string, string | string[]>,
): SubscriberRegistry {
  const normalized = new Map<string, string[]>();
  for (const [guildId, urls] of Object.entries(mapping)) {
    normalized.set(guildId, Array.isArray(urls) ? urls : [urls]);
  }

  return {
    getSubscriberUrls(guildId: string): string[] {
      return normalized.get(guildId) ?? [];
    },
  };
}

/**
 * Build a subscriber registry from a JSON-encoded environment variable
 * (default: `WEBHOOK_SUBSCRIBERS`), shaped as `{ "<guildId>": "<url>" | "<url>"[] }`.
 *
 * This is a minimal mock config for local development and small deployments.
 * Swap it for a database-backed `SubscriberRegistry` implementation once
 * subscribers are managed through the dashboard.
 *
 * Never hardcode subscriber URLs or secrets in source — configure them via
 * this (or another) environment-backed mechanism instead.
 */
export function loadSubscriberRegistryFromEnv(
  envVarName = "WEBHOOK_SUBSCRIBERS",
  env: NodeJS.ProcessEnv = process.env,
): SubscriberRegistry {
  const raw = env[envVarName];
  if (!raw) {
    return createSubscriberRegistry({});
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    const parseError = new Error(
      `${envVarName} must be valid JSON mapping guildId to subscriber URL(s): ${(err as Error).message}`,
    );
    (parseError as Error & { cause?: unknown }).cause = err;
    throw parseError;
  }

  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error(`${envVarName} must be a JSON object mapping guildId to subscriber URL(s)`);
  }

  return createSubscriberRegistry(parsed as Record<string, string | string[]>);
}
