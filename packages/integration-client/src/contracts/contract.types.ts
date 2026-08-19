import type { HttpRequestOptions } from "../http/http.types.js";

export interface JsonRpcRequest {
  jsonrpc: "2.0";
  method: string;
  params: any[];
  id: number | string;
}

export interface JsonRpcResponse<T = any> {
  jsonrpc: "2.0";
  result?: T;
  error?: {
    code: number;
    message: string;
    data?: any;
  };
  id: number | string;
}

export type ContractCallOptions = HttpRequestOptions;
