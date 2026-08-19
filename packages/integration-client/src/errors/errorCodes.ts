/**
 * Standard error codes used across the GuildPass SDK and platform.
 *
 * @module
 */

export const ErrorCodes = {
  // Generic / System Errors
  INTERNAL_ERROR: "INTERNAL_ERROR",
  UNKNOWN_ERROR: "UNKNOWN_ERROR",
  UNSUPPORTED: "UNSUPPORTED",

  // Network / Transport Errors (retaining existing codes for backward compatibility)
  NETWORK_ERROR: "network",
  TIMEOUT_ERROR: "timeout",
  CIRCUIT_OPEN: "circuit_open",
  UPSTREAM_ERROR: "upstream",

  // Client / Request Errors
  BAD_REQUEST: "BAD_REQUEST",
  VALIDATION_ERROR: "VALIDATION_ERROR",
  INVALID_CONFIG: "INVALID_CONFIG",
  INVALID_SIGNATURE: "INVALID_SIGNATURE",
  RATE_LIMIT_EXCEEDED: "RATE_LIMIT_EXCEEDED",

  // Auth / Permissions Errors
  UNAUTHORIZED: "UNAUTHORIZED",
  FORBIDDEN: "FORBIDDEN",
  ACCESS_DENIED: "ACCESS_DENIED",

  // Resource / Entity Errors
  NOT_FOUND: "NOT_FOUND",
  CONFLICT: "CONFLICT",
  MEMBERSHIP_NOT_FOUND: "MEMBERSHIP_NOT_FOUND",
  GUILD_NOT_FOUND: "GUILD_NOT_FOUND",
  PASS_NOT_FOUND: "PASS_NOT_FOUND",

  // Smart Contract / Web3 Errors
  CONTRACT_ERROR: "CONTRACT_ERROR",
} as const;

export type ErrorCode = (typeof ErrorCodes)[keyof typeof ErrorCodes] | (string & {});
