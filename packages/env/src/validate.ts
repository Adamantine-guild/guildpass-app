import type { z } from "zod";

/**
 * Error thrown when environment validation fails.
 * Contains a list of human-readable messages describing each issue.
 */
export class EnvValidationError extends Error {
  public readonly issues: string[];

  constructor(issues: string[]) {
    super(`Environment validation failed:\n${issues.map((i) => `  • ${i}`).join("\n")}`);
    this.name = "EnvValidationError";
    this.issues = issues;
  }
}

/**
 * Parse and validate environment variables against a Zod schema.
 *
 * @param schema  A Zod schema (typically one of the exported env schemas).
 * @param source  The environment source, defaults to `process.env`.
 * @returns       The typed, validated environment object.
 * @throws {EnvValidationError}  If validation fails.
 */
export function validateEnv<T>(
  schema: z.ZodSchema<T>,
  source: Record<string, string | undefined> = process.env as Record<string, string | undefined>,
): T {
  const result = schema.safeParse(source);

  if (!result.success) {
    const issues = result.error.issues.map(
      (issue) => `${issue.path.join(".")}: ${issue.message}`,
    );
    throw new EnvValidationError(issues);
  }

  return result.data;
}