import type { HttpClient } from "../http/httpClient.js";
import type { HttpRequestOptions } from "../http/http.types.js";
import type {
  MembershipHistory,
  MembershipHistoryOptions,
} from "../types.js";

export type GetMembershipHistoryOptions = MembershipHistoryOptions &
  HttpRequestOptions;

export class MembershipService {
  constructor(
    private readonly baseUrl: string,
    private readonly apiKey: string | undefined,
    private readonly httpClient: HttpClient,
  ) {}

  async getHistory(
    walletAddress: string,
    options: GetMembershipHistoryOptions = {},
  ): Promise<MembershipHistory> {
    const { cursor, limit, eventTypes, ...requestOptions } = options;
    const query = new URLSearchParams();
    if (cursor !== undefined) query.set("cursor", cursor);
    if (limit !== undefined) query.set("limit", String(limit));
    if (eventTypes !== undefined && eventTypes.length > 0) {
      query.set("eventTypes", eventTypes.join(","));
    }

    const queryString = query.toString();
    const url = `${this.baseUrl}/v1/memberships/wallet/${encodeURIComponent(
      walletAddress,
    )}/history${queryString ? `?${queryString}` : ""}`;
    const response = await this.httpClient.request(url, {
      ...requestOptions,
      headers: {
        "content-type": "application/json",
        ...(this.apiKey ? { authorization: `Bearer ${this.apiKey}` } : {}),
        ...requestOptions.headers,
      },
    });

    return (await response.json()) as MembershipHistory;
  }
}