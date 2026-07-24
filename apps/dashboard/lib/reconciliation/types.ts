/**
 * lib/reconciliation/types.ts
 *
 * Types for the cross-repository reconciliation system.
 *
 * Reconciliation detects and optionally corrects drift between denormalized
 * counters (Guild.memberCount / Guild.passCount) and the actual ground-truth
 * tables (Member / Pass).
 */

/** The field that was found to be inconsistent. */
export type DriftedField = "memberCount" | "passCount";

/** A single discrepancy detected for one guild. */
export interface GuildDiscrepancy {
  /** The ID of the guild with the discrepancy. */
  guildId: string;
  /** Display name of the guild (for human-readable reports). */
  guildName: string;
  /** The stored (denormalized) value that was found to be wrong. */
  field: DriftedField;
  /** The value stored on the Guild record. */
  storedValue: number;
  /** The actual count computed from the ground-truth table. */
  actualValue: number;
  /** Whether this discrepancy was corrected (only populated in --fix mode). */
  corrected?: boolean;
}

/** The overall result of a reconciliation run. */
export interface ReconciliationReport {
  /** ISO timestamp of when the reconciliation was performed. */
  timestamp: string;
  /** The mode the reconciliation ran in. */
  mode: "report" | "fix";
  /** Total number of guilds checked. */
  guildsChecked: number;
  /** The discrepancies found (empty if everything is consistent). */
  discrepancies: GuildDiscrepancy[];
  /** Summary: how many discrepancies were found. */
  totalDiscrepancies: number;
  /** Summary: how many were corrected (always 0 in report-only mode). */
  totalCorrected: number;
  /** Human-readable summary line. */
  summary: string;
}

/**
 * A function that counts the actual members for a given guild.
 * In production this would be a `SELECT COUNT(*) FROM members WHERE guild_id = $1`.
 */
export type GuildMemberCounter = (guildId: string) => Promise<number>;

/**
 * A function that counts the actual passes for a given guild.
 * In production this would be a `SELECT COUNT(*) FROM passes WHERE guild_id = $1`.
 */
export type GuildPassCounter = (guildId: string) => Promise<number>;

/** Options for a reconciliation run. */
export interface ReconcileOptions {
  /** Run mode: "report" (dry-run, no writes) or "fix" (corrects + audits). */
  mode: "report" | "fix";
  /** Function to count actual members for a guild. */
  countMembers: GuildMemberCounter;
  /** Function to count actual passes for a guild. */
  countPasses: GuildPassCounter;
}
