export const CURRENT_ACTIVITY_EVENT_SCHEMA_VERSION = 1;

export interface ActivityChange {
  readonly field: string;
  readonly before?: unknown;
  readonly after?: unknown;
}

export interface ActivityEvent {
  readonly id: string;
  readonly type: string;
  readonly timestamp: string;
  readonly guildId?: string;
  readonly actor?: string;
  readonly target?: string;
  readonly changes?: readonly ActivityChange[];
  readonly metadata?: Readonly<Record<string, unknown>>;
}

export const SENSITIVE_AUDIT_FIELDS = new Set([
  "password",
  "secret",
  "token",
  "apiKey",
  "authorization",
  "privateKey",
]);