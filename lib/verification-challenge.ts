/**
 * lib/verification-challenge.ts
 *
 * Challenge-response store for wallet proof-of-control (issue #173). A
 * challenge is handed out by POST /api/verify/challenge and consumed exactly
 * once by POST /api/verify, which requires a wallet signature over the
 * challenge message before it forwards the lookup to core.
 *
 * Unlike the SIWE nonce store (lib/auth/nonce-store.ts), challenges are
 * scoped to a specific (discordUserId, wallet) pair: a nonce issued for one
 * pair is invalid for any other, which is what blocks cross-context replay.
 *
 * In-memory, matching the nonce-store/session-store pattern. A multi-instance
 * deployment should back this with a shared store; the interface below is the
 * seam for that swap.
 */

/** Default challenge lifetime: 5 minutes (same bound as the SIWE nonce store). */
export const CHALLENGE_TTL_MS = 5 * 60 * 1000;

const CHALLENGE_RANDOM_BYTES = 16;

export interface VerificationChallenge {
  nonce: string;
  /** The exact EIP-191 message the wallet must sign. */
  message: string;
  expiresAt: number;
}

export interface IVerificationChallengeStore {
  /** Issue a fresh challenge for a (discordUserId, wallet) pair. Replaces any prior one. */
  issue(discordUserId: string, wallet: string, now?: number): VerificationChallenge;
  /**
   * Consume a challenge for the pair. Returns the message to verify the
   * signature against, or null when the nonce is unknown, expired, already
   * used, or was issued for a different pair. Every consume attempt is
   * single-use: the record is removed even on failure so a presented nonce
   * can never be retried.
   */
  consume(discordUserId: string, wallet: string, nonce: string, now?: number): string | null;
  /** Number of currently stored challenges (for tests/introspection). */
  size(): number;
}

/**
 * Build the message the wallet signs. The pair binding lives IN the signed
 * text, so a signature produced for one (discordUserId, wallet) pair cannot
 * be replayed for another even if the nonce somehow collided.
 */
export function buildChallengeMessage(
  discordUserId: string,
  wallet: string,
  nonce: string,
  expiresAt: number,
): string {
  return [
    "GuildPass wallet verification",
    "",
    "Sign this message to prove you control this wallet and link it to your Discord account.",
    "",
    `Discord user: ${discordUserId}`,
    `Wallet: ${wallet}`,
    `Nonce: ${nonce}`,
    `Expires: ${new Date(expiresAt).toISOString()}`,
  ].join("\n");
}

function generateNonce(): string {
  const bytes = new Uint8Array(CHALLENGE_RANDOM_BYTES);
  crypto.getRandomValues(bytes);
  const encoded = Array.from(bytes)
    .map((b) => b.toString(36).padStart(2, "0"))
    .join("");
  return encoded.slice(0, 16);
}

function scopeKey(discordUserId: string, wallet: string): string {
  return `${discordUserId}:${wallet.toLowerCase()}`;
}

export function createVerificationChallengeStore(): IVerificationChallengeStore {
  const records = new Map<string, VerificationChallenge & { issuedAt: number }>();

  function prune(now: number): void {
    for (const [key, rec] of records) {
      if (rec.expiresAt <= now) records.delete(key);
    }
  }

  return {
    issue(discordUserId: string, wallet: string, now: number = Date.now()): VerificationChallenge {
      prune(now);
      const key = scopeKey(discordUserId, wallet);
      let nonce = generateNonce();
      while ([...records.values()].some((r) => r.nonce === nonce)) nonce = generateNonce();
      const expiresAt = now + CHALLENGE_TTL_MS;
      const challenge: VerificationChallenge = {
        nonce,
        message: buildChallengeMessage(discordUserId, wallet, nonce, expiresAt),
        expiresAt,
      };
      records.set(key, { ...challenge, issuedAt: now });
      return challenge;
    },

    consume(discordUserId: string, wallet: string, nonce: string, now: number = Date.now()): string | null {
      const key = scopeKey(discordUserId, wallet);
      const rec = records.get(key);
      if (!rec || rec.nonce !== nonce) return null; // unknown, or issued for a different pair
      records.delete(key); // single-use, consumed on first presentation
      if (rec.expiresAt <= now) return null;
      return rec.message;
    },

    size(): number {
      return records.size;
    },
  };
}

let _store: IVerificationChallengeStore | null = null;

export function getVerificationChallengeStore(): IVerificationChallengeStore {
  // Test hook: an injected store takes precedence over the singleton,
  // mirroring the __TEST_INTEGRATION_CLIENT pattern in the verify route.
  const injected = (globalThis as any).__TEST_VERIFICATION_CHALLENGE_STORE;
  if (injected) return injected as IVerificationChallengeStore;
  if (!_store) _store = createVerificationChallengeStore();
  return _store;
}

/** Reset the singleton (tests only). */
export function resetVerificationChallengeStore(): void {
  _store = null;
}
