import { randomUUID } from "crypto";
import { generateSignature } from "./verify.js";
import type {
  DeliveryAttempt,
  DispatchOptions,
  DispatchResult,
  WebhookEvent,
} from "./dispatch-types.js";

const DEFAULT_MAX_ATTEMPTS = 3;
const DEFAULT_BASE_DELAY_MS = 200;
const DEFAULT_MAX_DELAY_MS = 10_000;

const defaultSleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

/**
 * "Full jitter" exponential backoff, as recommended by
 * https://aws.amazon.com/blogs/architecture/exponential-backoff-and-jitter/ —
 * picks a random delay in [0, min(maxDelayMs, baseDelayMs * 2^(attempt-1))]
 * so retrying clients don't stay lockstep after a shared failure.
 */
function backoffWithJitter(
  attempt: number,
  baseDelayMs: number,
  maxDelayMs: number,
  random: () => number,
): number {
  const cap = Math.min(maxDelayMs, baseDelayMs * 2 ** (attempt - 1));
  return Math.floor(random() * cap);
}

/**
 * Sign and deliver a `WebhookEvent` to `subscriberUrl`, retrying transient
 * failures with exponential backoff and jitter. If every attempt fails, the
 * delivery is recorded in `options.deadLetterStore` (when provided) instead
 * of throwing.
 *
 * The payload is signed with the same HMAC-SHA256 scheme `verifySignature`
 * expects, via `generateSignature` — see README.md for the wire contract.
 */
export async function dispatchWebhook(
  subscriberUrl: string,
  event: WebhookEvent,
  options: DispatchOptions,
): Promise<DispatchResult> {
  const { secret, deadLetterStore } = options;
  if (!secret) {
    throw new Error("dispatchWebhook: options.secret is required");
  }

  const maxAttempts = options.retry?.maxAttempts ?? DEFAULT_MAX_ATTEMPTS;
  const baseDelayMs = options.retry?.baseDelayMs ?? DEFAULT_BASE_DELAY_MS;
  const maxDelayMs = options.retry?.maxDelayMs ?? DEFAULT_MAX_DELAY_MS;
  const fetchImpl = options.fetch ?? fetch;
  const sleep = options.sleep ?? defaultSleep;
  const random = options.random ?? Math.random;

  const body = JSON.stringify(event);
  const { signature } = generateSignature({ secret, payload: body });

  const attempts: DeliveryAttempt[] = [];

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const record: DeliveryAttempt = {
      attempt,
      startedAt: new Date().toISOString(),
    };

    try {
      const response = await fetchImpl(subscriberUrl, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-guildpass-signature": signature,
        },
        body,
      });

      record.status = response.status;
      attempts.push(record);

      if (response.ok) {
        return { delivered: true, subscriberUrl, event, attempts };
      }
    } catch (err) {
      record.error = err instanceof Error ? err.message : String(err);
      attempts.push(record);
    }

    if (attempt < maxAttempts) {
      const delay = backoffWithJitter(attempt, baseDelayMs, maxDelayMs, random);
      await sleep(delay);
    }
  }

  if (deadLetterStore) {
    await deadLetterStore.record({
      id: randomUUID(),
      subscriberUrl,
      event,
      attempts,
      failedAt: new Date().toISOString(),
    });
  }

  return { delivered: false, subscriberUrl, event, attempts, deadLettered: !!deadLetterStore };
}
