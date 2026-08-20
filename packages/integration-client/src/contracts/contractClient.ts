import { HttpClient } from "../http/httpClient.js";
import type { ContractCallOptions, JsonRpcRequest, JsonRpcResponse } from "./contract.types.js";
import { withRetry } from "./contractHelpers.js";
import { sdkConfig } from "../config/sdkConfig.js";

/**
 * Thin JSON-RPC client for on-chain reads, used through
 * {@link IntegrationClient.getContractClient}. Sends JSON-RPC 2.0 POST
 * requests via the same {@link HttpClient} transport as the REST client, so
 * any `timeout`/`retry` config flows through unchanged.
 */
export class ContractClient {
  private httpClient: HttpClient;
  private rpcUrl: string;

  /**
   * @param rpcUrl - Full JSON-RPC endpoint URL (e.g. an EVM RPC provider URL).
   * @param httpClient - The shared {@link HttpClient} (provided by IntegrationClient).
   */
  constructor(rpcUrl: string, httpClient: HttpClient) {
    this.rpcUrl = rpcUrl;
    this.httpClient = httpClient;
  }

  /**
   * Send a JSON-RPC 2.0 method call to the configured `rpcUrl`.
   *
   * @param method - The RPC method name (e.g. `"ownerOf"`).
   * @param params - Positional RPC parameters. Default: `[]`.
   * @param options - Per-request {@link ContractCallOptions} (timeout/retry/headers).
   * @returns The decoded `result` field, typed as `T`.
   * @throws `Error("RPC_HTTP_ERROR:<status>")` on a non-OK HTTP response.
   * @throws `Error("RPC_ERROR:<code> <message>")` when the RPC payload carries an `error`.
   */
  async call<T = any>(
    method: string,
    params: any[] = [],
    options: ContractCallOptions = {}
  ): Promise<T> {
    const body: JsonRpcRequest = {
      jsonrpc: "2.0",
      method,
      params,
      id: Date.now(),
    };

    return withRetry(async () => {
      const res = await this.httpClient.request(this.rpcUrl, {
        ...options,
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...options.headers,
        },
        body: JSON.stringify(body),
      });

      if (!res.ok) {
          throw new Error(`RPC_HTTP_ERROR:${res.status}`);
      }

      const data: JsonRpcResponse<T> = await res.json();

      if (data.error) {
        throw new Error(`RPC_ERROR:${data.error.code} ${data.error.message}`);
      }

      return data.result as T;
    }, sdkConfig.rpcRetry);
  }
}
