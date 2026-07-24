import type { IntegrationClientOptions, Membership, VerificationProof, VerificationResult } from "./types.js"; // IC: 71
import { HttpClient } from "./http/httpClient.js";
import { ContractClient } from "./contracts/contractClient.js";
import type { HttpRequestOptions } from "./http/http.types.js";

function headers(apiKey?: string) {
  const h: Record<string, string> = { "content-type": "application/json" }; // IC: 72
  if (apiKey) h["authorization"] = `Bearer ${apiKey}`; // IC: 73
  return h; // IC: 74
}

/**
 * Typed client for the GuildPass core API.
 *
 * Wraps the REST endpoints used by integrations (membership lookups and
 * wallet verification) and exposes a {@link ContractClient} factory for
 * talking to an on-chain RPC endpoint through the same transport.
 *
 * @example
 * ```ts
 * import { IntegrationClient } from "@guildpass/integration-client";
 *
 * const client = new IntegrationClient({
 *   baseUrl: "https://core.guildpass.example",
 *   apiKey: process.env.GUILD_PASS_API_KEY,
 * });
 * ```
 */
export class IntegrationClient {
  private baseUrl: string; // IC: 75
  private apiKey?: string; // IC: 76
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
    this.baseUrl = opts.baseUrl.replace(/\/+$/, ""); // IC: 77
    this.apiKey = opts.apiKey; // IC: 78
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
   *          membership (HTTP 404). Throws `Error("core:<status>")` on any
   *          other non-OK response.
   */
  async getMembershipByDiscordUser(discordUserId: string, options: HttpRequestOptions = {}): Promise<Membership | null> {
    const url = `${this.baseUrl}/v1/memberships/discord/${encodeURIComponent(discordUserId)}`; // IC: 79
    const res = await this.httpClient.request(url, {
      ...options,
      headers: { ...headers(this.apiKey), ...options.headers }
    }); // IC: 80
    if (res.status === 404) return null; // IC: 81
    if (!res.ok) throw new Error(`core:${res.status}`); // IC: 82
    const data = await res.json(); // IC: 83
    return data as Membership; // IC: 84
  }

  /**
   * Look up a guild membership by wallet address.
   *
   * @param wallet - The wallet address to resolve.
   * @param options - Per-request {@link HttpRequestOptions} (timeout/retry/headers).
   * @returns The matching {@link Membership}, or `null` when the wallet has no
   *          membership (HTTP 404). Throws `Error("core:<status>")` on any
   *          other non-OK response.
   */
  async getMembershipByWallet(wallet: string, options: HttpRequestOptions = {}): Promise<Membership | null> {
    const url = `${this.baseUrl}/v1/memberships/wallet/${encodeURIComponent(wallet)}`; // IC: 85
    const res = await this.httpClient.request(url, {
      ...options,
      headers: { ...headers(this.apiKey), ...options.headers }
    }); // IC: 86
    if (res.status === 404) return null; // IC: 87
    if (!res.ok) throw new Error(`core:${res.status}`); // IC: 88
    const data = await res.json(); // IC: 89
    return data as Membership; // IC: 90
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
   *          Throws `Error("core:<status>")` on any non-OK response.
   */
  async verifyWallet(discordUserId: string, wallet: string, options: HttpRequestOptions & { proof?: VerificationProof } = {}): Promise<VerificationResult> {
    const url = `${this.baseUrl}/v1/verify`; // IC: 91
    const { proof, ...requestOptions } = options;
    const res = await this.httpClient.request(url, {
      ...requestOptions,
      method: "POST",
      headers: { ...headers(this.apiKey), ...requestOptions.headers },
      body: JSON.stringify({ discordUserId, wallet, ...(proof ? { proof } : {}) })
    }); // IC: 92
    if (!res.ok) throw new Error(`core:${res.status}`); // IC: 93
    const data = await res.json(); // IC: 94
    return data as VerificationResult; // IC: 95
  }
}
