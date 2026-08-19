export type CircuitState = "closed" | "open" | "half-open";

export interface CircuitBreakerConfig {
  /** Consecutive failures in `closed` state before the breaker opens. Default 5. */
  failureThreshold?: number;
  /** Milliseconds to stay open before allowing a probe. Default 30000. */
  cooldownMs?: number;
  /** Clock source, injectable for tests. Default `Date.now`. */
  now?: () => number;
}

export interface CircuitBreakerStatus {
  state: CircuitState;
  failureCount: number;
  openedAt: number | null;
  retryAt: number | null;
}

/**
 * Thrown by the transport when a request is rejected because the breaker is
 * open. Distinguishable from a generic timeout/network error.
 */
export class CircuitOpenError extends Error {
  readonly code = "circuit_open";
  readonly retryAt: number;

  constructor(retryAt: number) {
    super("Circuit is open: upstream is failing, request rejected without contacting the network.");
    this.name = "CircuitOpenError";
    this.retryAt = retryAt;
  }
}

const DEFAULT_FAILURE_THRESHOLD = 5;
const DEFAULT_COOLDOWN_MS = 30_000;

/**
 * A minimal circuit breaker for the HTTP transport.
 *
 * closed    -> normal; consecutive failures counted; opens at failureThreshold.
 * open      -> fail fast until cooldownMs elapses, then admit one probe (half-open).
 * half-open -> single probe; success closes, failure re-opens and restarts cooldown.
 *
 * Time is read through an injectable now() so tests can advance the clock.
 */
export class CircuitBreaker {
  private readonly failureThreshold: number;
  private readonly cooldownMs: number;
  private readonly now: () => number;

  private state: CircuitState = "closed";
  private failureCount = 0;
  private openedAt: number | null = null;

  constructor(config: CircuitBreakerConfig = {}) {
    this.failureThreshold = config.failureThreshold ?? DEFAULT_FAILURE_THRESHOLD;
    this.cooldownMs = config.cooldownMs ?? DEFAULT_COOLDOWN_MS;
    this.now = config.now ?? Date.now;
  }

  canRequest(): boolean {
    if (this.state === "open") {
      const elapsed = this.now() - (this.openedAt ?? 0);
      if (elapsed >= this.cooldownMs) {
        this.state = "half-open";
        return true;
      }
      return false;
    }
    return true;
  }

  recordSuccess(): void {
    this.state = "closed";
    this.failureCount = 0;
    this.openedAt = null;
  }

  recordFailure(): void {
    if (this.state === "half-open") {
      this.open();
      return;
    }
    this.failureCount++;
    if (this.failureCount >= this.failureThreshold) {
      this.open();
    }
  }

  getStatus(): CircuitBreakerStatus {
    return {
      state: this.state,
      failureCount: this.failureCount,
      openedAt: this.openedAt,
      retryAt: this.openedAt === null ? null : this.openedAt + this.cooldownMs,
    };
  }

  private open(): void {
    this.state = "open";
    this.openedAt = this.now();
  }
}
