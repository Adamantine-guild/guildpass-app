import { z } from "zod";

/**
 * Zod schema for the GuildPass Access API environment variables.
 *
 * The access-api is the blockchain indexer and core API gateway.
 * It requires a database connection and an RPC endpoint for on-chain data.
 */

export const accessApiEnvSchema = z
  .object({
    // ── Database ────────────────────────────────────────────────────
    DATABASE_URL: z.string().min(1, "DATABASE_URL is required"),

    // ── Blockchain ──────────────────────────────────────────────────
    RPC_URL: z.string().url("RPC_URL must be a valid URL"),
    MEMBERSHIP_CONTRACT_ADDRESS: z
      .string()
      .regex(/^0x[a-fA-F0-9]{40}$/, "Must be a valid 20-byte hex address"),
    INDEXER_CONFIRMATION_DEPTH: z
      .string()
      .regex(/^\d+$/, "Must be a numeric string (block count)")
      .default("10"),
    INDEXER_START_BLOCK: z
      .string()
      .regex(/^\d+$/, "Must be a numeric string (block number)")
      .default("0"),

    // ── Server ──────────────────────────────────────────────────────
    PORT: z
      .string()
      .regex(/^\d+$/, "PORT must be a numeric string")
      .default("3000"),
    HOST: z.string().default("0.0.0.0"),

    // ── Optional auth ───────────────────────────────────────────────
    API_KEY: z.string().optional(),
  })
  .superRefine((data, ctx) => {
    // Ensure confirmation depth is at least 1 (for reorg safety)
    const depth = parseInt(data.INDEXER_CONFIRMATION_DEPTH, 10);
    if (depth < 1) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "INDEXER_CONFIRMATION_DEPTH must be >= 1",
        path: ["INDEXER_CONFIRMATION_DEPTH"],
      });
    }
  });

export type AccessApiEnv = z.infer<typeof accessApiEnvSchema>;