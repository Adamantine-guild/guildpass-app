/**
 * lib/auth/nonce-store.ts
 *
 * Issues and tracks single-use, expiring nonces for the SIWE sign-in flow
 * (issue #142). A nonce is handed to the client by GET /api/auth/nonce, embedded
 * in the SIWE message the wallet signs, and then consumed exactly once by the
 * verify endpoint. Single-use + expiry are what prevent replay of a captured
 * signature.
 *
 * ── Storage ─────────────────────────────────────────────────────────────────
 * In-memory, matching the mock/dev pattern used by session-store.ts. A
 * production deployment should back this with a shared store (Redis, DB) so the
 * single-use guarantee holds across instances; the INonceStore interface below
 * is the seam for that swap. In-memory is correct for a single instance and for
 * tests.
 *
 * ── Nonce format ────────────────────────────────────────────────────────────
 * SIWE requires the nonce to be at least 8 alphanumeric characters. We generate
 * a 16-char base36 string from cryptographically secure random bytes, which is
 * comfortably within spec and drops straight into a SIWE message.
 */

/** Default nonce lifetime: 5 minutes (long enough to sign, short enough to bound replay). */
export const NONCE_TTL_MS = 5 * 60 * 1000;

/** Number of random bytes drawn per nonce before encoding. */
const NONCE_RANDOM_BYTES = 16;

export interface NonceRecord {
  /** The nonce value handed to the client. */
  nonce: string;
  /** When the nonce was issued (Unix ms). */
  issuedAt: number;
  /** When the nonce expires (Unix ms). */
  expiresAt: number;
  /** Whether the nonce has already been consumed (single-use guard). */
  consumed: boolean;
}

export interface INonceStore {
  /** Issue a fresh nonce, store it as unconsumed, and return its value. */
  issue(now?: number): string;
  /**
   * Consume a nonce. Returns true only if the nonce exists, is unexpired, and
   * has not been consumed before — and atomically marks it consumed. Every
   * other case (unknown, expired, already used) returns false.
   */
  consume(nonce: string, now?: number): boolean;
  /** Remove expired records. Called opportunistically on issue/consume. */
  prune(now?: number): void;
  /** Number of currently stored records (for tests/introspection). */
  size(): number;
}

/**
 * Generate a SIWE-compliant nonce: >= 8 alphanumeric chars, from CSPRNG bytes.
 */
function generateNonce(): string {
  const bytes = new Uint8Array(NONCE_RANDOM_BYTES);
  crypto.getRandomValues(bytes);
  // base36 each byte, pad, concatenate, and take a fixed 16-char slice.
  const encoded = Array.from(bytes)
    .map((b) => b.toString(36).padStart(2, "0"))
    .join("");
  return encoded.slice(0, 16);
}

/**
 * Create an in-memory nonce store. Exported as a factory so tests get isolated
 * instances; the app uses the shared singleton below.
 */
export function createNonceStore(): INonceStore {
  const records = new Map<string, NonceRecord>();

  function prune(now: number = Date.now()): void {
    for (const [key, rec] of records) {
      if (rec.expiresAt <= now || rec.consumed) {
        records.delete(key);
      }
    }
  }

  return {
    issue(now: number = Date.now()): string {
      prune(now);
      // Regenerate on the astronomically unlikely event of a collision.
      let nonce = generateNonce();
      while (records.has(nonce)) nonce = generateNonce();
      records.set(nonce, {
        nonce,
        issuedAt: now,
        expiresAt: now + NONCE_TTL_MS,
        consumed: false,
      });
      return nonce;
    },

    consume(nonce: string, now: number = Date.now()): boolean {
      const rec = records.get(nonce);
      if (!rec) return false;             // unknown / never issued
      if (rec.consumed) return false;     // replay of an already-used nonce
      if (rec.expiresAt <= now) {         // expired
        records.delete(nonce);
        return false;
      }
      rec.consumed = true;                // single-use: mark before returning
      records.delete(nonce);              // consumed nonces need no further tracking
      return true;
    },

    prune,

    size(): number {
      return records.size;
    },
  };
}

// Shared singleton for the app. In production, replace with a store backed by a
// shared cache so the single-use guarantee holds across instances.
let _nonceStore: INonceStore | null = null;

export function getNonceStore(): INonceStore {
  if (!_nonceStore) _nonceStore = createNonceStore();
  return _nonceStore;
}

/** Reset the singleton (tests only). */
export function resetNonceStore(): void {
  _nonceStore = null;
}