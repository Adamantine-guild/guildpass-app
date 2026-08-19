import {
  type HttpRequestOptions,
  type TransportConfig,
  DEFAULT_RETRY_CONFIG,
} from "./http.types.js";
import {
  CircuitBreaker,
  CircuitOpenError,
  type CircuitBreakerStatus,
} from "./circuitBreaker.js";
import { TimeoutError, UpstreamError, NetworkError } from "./errors.js";

export class HttpClient {
  private config: TransportConfig;
  private breaker?: CircuitBreaker;

  constructor(config: TransportConfig = {}) {
    this.config = {
      ...config,
      retry: config.retry === undefined ? DEFAULT_RETRY_CONFIG : config.retry,
    };
    if (config.circuitBreaker) {
      this.breaker = new CircuitBreaker(config.circuitBreaker);
    }
  }

  async request(
    url: string,
    options: HttpRequestOptions = {},
  ): Promise<Response> {
    if (this.breaker && !this.breaker.canRequest()) {
      const status = this.breaker.getStatus();
      throw new CircuitOpenError(status.retryAt ?? Date.now());
    }

    const {
      timeout = this.config.timeout,
      retry = this.config.retry,
      signal: externalSignal,
      ...fetchOptions
    } = options;

    const fetchFn = this.config.fetch ?? fetch;
    const maxAttempts = retry?.maxAttempts ?? 1;
    let attempt = 0;
    let lastError: Error | undefined;

    while (attempt < maxAttempts) {
      attempt++;
      const controller = new AbortController();
      const signal = controller.signal;

      const onAbort = () => {
        controller.abort(externalSignal?.reason);
      };

      if (externalSignal) {
        if (externalSignal.aborted)
          throw externalSignal.reason ?? new Error("Aborted");
        externalSignal.addEventListener("abort", onAbort);
      }

      let timeoutId: ReturnType<typeof setTimeout> | undefined;
      if (timeout) {
        timeoutId = setTimeout(() => {
          controller.abort(new TimeoutError(timeout));
        }, timeout);
      }

      try {
        const response = await fetchFn(url, {
          ...fetchOptions,
          signal,
        });

        if (response.ok) {
          if (this.breaker) this.breaker.recordSuccess();
          return response;
        }

        // Treat 404 as a non-error response; return it for caller to handle.
        if (response.status === 404) {
          // Do not record circuit breaker failure for 404.
          return response;
        }

        // Non-OK response: check if we should retry (transient) or fail.
        if (attempt >= maxAttempts || !this.isTransient(response.status)) {
          throw new UpstreamError(response.status, response.statusText);
        }

        // Transient status — will retry after the loop body ends.
        lastError = new UpstreamError(response.status, response.statusText);
      } catch (error: any) {
        // If the external signal was aborted by the caller, re-throw as-is.
        if (
          externalSignal?.aborted &&
          (error === externalSignal.reason || error.name === "AbortError")
        ) {
          throw externalSignal.reason ?? error;
        }

        // If this is already one of our typed errors, capture it for re-throw.
        if (
          error instanceof TimeoutError ||
          error instanceof UpstreamError ||
          error instanceof CircuitOpenError
        ) {
          lastError = error;
        } else {
          // Wrap raw fetch/network errors.
          lastError =
            error instanceof Error
              ? new NetworkError(error)
              : new NetworkError(error);
        }

        // If this is the last attempt, give up.
        if (attempt >= maxAttempts) {
          this.breaker?.recordFailure();
          throw lastError;
        }

        // TimeoutError and network errors are retryable.
        if (lastError instanceof TimeoutError || lastError instanceof NetworkError) {
          // Continue to retry below.
        } else if (
          lastError instanceof UpstreamError &&
          this.isTransient(lastError.status)
        ) {
          // Transient 5xx/429 is retryable — continue.
        } else {
          // Non-retryable upstream error — fail immediately.
          this.breaker?.recordFailure();
          throw lastError;
        }
      } finally {
        if (timeoutId) clearTimeout(timeoutId);
        if (externalSignal)
          externalSignal.removeEventListener("abort", onAbort);
      }

      // Exponential backoff before next attempt.
      if (retry && attempt < maxAttempts) {
        const delay = retry.delay ?? 1000;
        const sleepTime = retry.backoff
          ? delay * Math.pow(2, attempt - 1)
          : delay;
        await new Promise((resolve) => setTimeout(resolve, sleepTime));
      }
    }

    this.breaker?.recordFailure();
    throw lastError ?? new Error("Request failed after max attempts");
  }

  getStatus(): CircuitBreakerStatus | null {
    return this.breaker ? this.breaker.getStatus() : null;
  }

  private isTransient(status: number): boolean {
    return status === 429 || (status >= 500 && status <= 599);
  }
}
