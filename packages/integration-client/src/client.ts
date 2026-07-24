import type {
  GuildSnapshot,
  IntegrationClientOptions,
  Membership,
  VerificationProof,
  VerificationResult,
} from "./types.js";
import { HttpClient } from "./http/httpClient.js";
import { ContractClient } from "./contracts/contractClient.js";
import type { HttpRequestOptions } from "./http/http.types.js";
import { CircuitOpenError } from "./http/circuitBreaker.js";
import { TimeoutError, UpstreamError, NetworkError } from "./http/errors.js";

// Re-export typed errors so callers can import them from @guildpass/integration-client
export { CircuitOpenError, TimeoutError, UpstreamError, NetworkError };

function headers(apiKey?: string) {
  const h: Record<string, string> = { "content-type": "application/json" };
  if (apiKey) h["authorization"] = `Bearer ${apiKey}`;
  return h;
}

/**
 * Typed client for the GuildPass core API.
 *
 * Wraps the REST endpoints used by integrations (membership lookups and
 * wallet verification) and exposes a {@link ContractClient} factory for
 * talking to an on-chain RPC endpoint through the same transport.
 *
 * Every method can throw one of three distinguishable errors, all of which
 * extend `Error`:
 *
 * - {@link CircuitOpenError} — the circuit breaker is open; the upstream is
 *   known to be failing and the request was rejected without network I/O.
 * - {@link TimeoutError} — the request exceeded its configured timeout.
 * - {@link UpstreamError} — the upstream responded with a non-OK, non-404
 *   status after retries were exhausted. Carries a `.status` property.
 *
 * @example
 * ```ts
 * import { IntegrationClient, CircuitOpenError, TimeoutError, UpstreamError } from "@guildpass/integration-client";
 *
 * const client = new IntegrationClient({
 *   baseUrl: "https://core.guildpass.example",
 *   apiKey: process.env.GUILD_PASS_API_KEY,
 * });
 * ```
 */
export class IntegrationClient {
  private baseUrl: string;
  private apiKey?: string;
  private httpClient: HttpClient;

  /**
   * Create a new IntegrationClient.
   *
   * @param opts.baseUrl - Core API base URL. Trailing slashes are stripped.
   * @param opts.apiKey  - Optional bearer token sent as `Authorization: Bearer <apiKey>`.
   *                       Omit for public endpoints that don't require auth.
   * @param opts.transport - Optional {@link TransportConfig} controlling the
   *                         underlying fetch implementation, default timeout,
   *                         and default retry behaviour. See
   *                         {@link ./http/http.types} for the field defaults.
   */
  constructor(opts: IntegrationClientOptions) {
    this.baseUrl = opts.baseUrl.replace(/\/+$/, "");
    this.apiKey = opts.apiKey;
    this.httpClient = new HttpClient(opts.transport);
  }

  /**
   * Build a {@link ContractClient} bound to the given JSON-RPC `rpcUrl`.
   *
   * The returned client shares this instance's transport (timeout/retry),
   * so any `transport` config you passed to the constructor also applies to
   * on-chain calls.
   *
   * @param rpcUrl - Full JSON-RPC endpoint URL (e.g. an EVM RPC provider URL).
   * @returns A new ContractClient scoped to `rpcUrl`.
   */
  getContractClient(rpcUrl: string): ContractClient {
    return new ContractClient(rpcUrl, this.httpClient);
  }

  /**
   * Look up a guild membership by Discord user id.
   *
   * @param discordUserId - The Discord user id to resolve.
   * @param options - Per-request {@link HttpRequestOptions} (timeout/retry/headers).
   * @returns The matching {@link Membership}, or `null` when the user has no
   *          membership (HTTP 404). Throws on network/upstream errors.
   * @throws {CircuitOpenError} When the circuit breaker is open.
   * @throws {TimeoutError} When the request times out.
   * @throws {UpstreamError} When the upstream returns a non-OK status (except 404).
   */
  async getMembershipByDiscordUser(
    discordUserId: string,
    options: HttpRequestOptions = {},
  ): Promise<Membership | null> {
    const url = `${this.baseUrl}/v1/memberships/discord/${encodeURIComponent(
      discordUserId,
    )}`;
    const res = await this.httpClient.request(url, {
      ...options,
      headers: { ...headers(this.apiKey), ...options.headers },
    });
    if (res.status === 404) return null;
    const data = await res.json();
    return data as Membership;
  }

  /**
   * Look up a guild membership by wallet address.
   *
   * @param wallet - The wallet address to resolve.
   * @param options - Per-request {@link HttpRequestOptions} (timeout/retry/headers).
   * @returns The matching {@link Membership}, or `null` when the wallet has no
   *          membership (HTTP 404). Throws on network/upstream errors.
   * @throws {CircuitOpenError} When the circuit breaker is open.
   * @throws {TimeoutError} When the request times out.
   * @throws {UpstreamError} When the upstream returns a non-OK status (except 404).
   */
  async getMembershipByWallet(
    wallet: string,
    options: HttpRequestOptions = {},
  ): Promise<Membership | null> {
    const url = `${this.baseUrl}/v1/memberships/wallet/${encodeURIComponent(
      wallet,
    )}`;
    const res = await this.httpClient.request(url, {
      ...options,
      headers: { ...headers(this.apiKey), ...options.headers },
    });
    if (res.status === 404) return null;
    const data = await res.json();
    return data as Membership;
  }

  /**
   * Fetch a point-in-time authoritative snapshot of a guild's state from core.
   *
   * GETs `/v1/guilds/:guildId/snapshot`. Used by the dashboard's
   * reconciliation job to recover state drift after webhook delivery gaps.
   *
   * @param guildId - The guild to snapshot.
   * @param options - Per-request {@link HttpRequestOptions} (timeout/retry/headers).
   * @returns The {@link GuildSnapshot}, or `null` when core does not expose a
   *          snapshot endpoint or has no such guild (HTTP 404). Throws on
   *          network/upstream errors.
   * @throws {CircuitOpenError} When the circuit breaker is open.
   * @throws {TimeoutError} When the request times out.
   * @throws {UpstreamError} When the upstream returns a non-OK status (except 404).
   */
  async getGuildSnapshot(
    guildId: string,
    options: HttpRequestOptions = {},
  ): Promise<GuildSnapshot | null> {
    const url = `${this.baseUrl}/v1/guilds/${encodeURIComponent(
      guildId,
    )}/snapshot`;
    const res = await this.httpClient.request(url, {
      ...options,
      headers: { ...headers(this.apiKey), ...options.headers },
    });
    if (res.status === 404) return null;
    const data = await res.json();
    return data as GuildSnapshot;
  }

  /**
   * Verify that a Discord user controls a given wallet and return the result.
   *
   * POSTs `{ discordUserId, wallet }` to `/v1/verify`. When `options.proof`
   * is given, the `{ nonce, signature }` evidence is included in the body so
   * core can record that control was proven, not just claimed (issue #173).
   *
   * @param discordUserId - The Discord user id claiming ownership of the wallet.
   * @param wallet - The wallet address to verify against the user.
   * @param options - Per-request {@link HttpRequestOptions} (timeout/retry/headers),
   *          plus optional `proof` ({@link VerificationProof}).
   * @returns The {@link VerificationResult} (`{ userId, wallet, verified, message? }`).
   * @throws {CircuitOpenError} When the circuit breaker is open.
   * @throws {TimeoutError} When the request times out.
   * @throws {UpstreamError} When the upstream returns a non-OK status.
   */
  async verifyWallet(
    discordUserId: string,
    wallet: string,
    options: HttpRequestOptions & { proof?: VerificationProof } = {},
  ): Promise<VerificationResult> {
    const url = `${this.baseUrl}/v1/verify`;
    const { proof, ...requestOptions } = options;
    const res = await this.httpClient.request(url, {
      ...requestOptions,
      method: "POST",
      headers: { ...headers(this.apiKey), ...requestOptions.headers },
      body: JSON.stringify({
        discordUserId,
        wallet,
        ...(proof ? { proof } : {}),
      }),
    });
    const data = await res.json();
    return data as VerificationResult;
  }
}
