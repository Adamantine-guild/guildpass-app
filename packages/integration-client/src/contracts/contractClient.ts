import type { HttpClient } from "../http/httpClient.js";
import type { ContractCallOptions, JsonRpcRequest, JsonRpcResponse } from "./contract.types.js";

export class ContractClient {
  private httpClient: HttpClient;
  private rpcUrl: string;

  constructor(rpcUrl: string, httpClient: HttpClient) {
    this.rpcUrl = rpcUrl;
    this.httpClient = httpClient;
  }

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
  }
}
