import { ErrorCodes } from "../errors/errorCodes.js";

export interface RetryOptions {
  maxAttempts?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
}

export function isRetryableError(error: any): boolean {
  if (!error) return false;
  
  if (
    error.code === ErrorCodes.TIMEOUT_ERROR || 
    error.code === ErrorCodes.NETWORK_ERROR ||
    error.code === ErrorCodes.RATE_LIMIT_EXCEEDED
  ) {
    return true;
  }

  const msg = error.message || "";
  
  // Checking for standard HTTP transient errors if thrown as RPC_HTTP_ERROR
  if (
    msg.includes("RPC_HTTP_ERROR:429") ||
    msg.includes("RPC_HTTP_ERROR:408") ||
    msg.includes("RPC_HTTP_ERROR:500") ||
    msg.includes("RPC_HTTP_ERROR:502") ||
    msg.includes("RPC_HTTP_ERROR:503") ||
    msg.includes("RPC_HTTP_ERROR:504")
  ) {
    return true;
  }

  if (
    msg.includes("ECONNRESET") || 
    msg.includes("ETIMEDOUT") || 
    msg.includes("timeout") ||
    error.name === "TimeoutError" ||
    msg.includes("rate limit") ||
    msg.includes("-32005") || // RPC rate limit
    msg.includes("-32004") || // RPC timeout
    msg.includes("-32042") || // RPC timeout/rate limit variations
    msg.includes("-32043")
  ) {
    return true;
  }

  return false;
}

export async function withRetry<T>(
  fn: () => Promise<T>,
  options: RetryOptions = {}
): Promise<T> {
  const maxAttempts = options.maxAttempts ?? 3;
  const baseDelayMs = options.baseDelayMs ?? 500;
  const maxDelayMs = options.maxDelayMs ?? 5000;

  let attempt = 1;

  while (true) {
    try {
      return await fn();
    } catch (error) {
      if (attempt >= maxAttempts || !isRetryableError(error)) {
        throw error;
      }

      // Exponential backoff with jitter
      const delay = Math.min(baseDelayMs * Math.pow(2, attempt - 1), maxDelayMs);
      const jitter = delay * 0.2 * Math.random(); 
      const waitTime = delay + jitter;

      await new Promise((resolve) => setTimeout(resolve, waitTime));
      attempt++;
    }
  }
}
