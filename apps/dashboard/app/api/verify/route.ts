import { NextRequest, NextResponse } from "next/server";
import {
apiResponse,
apiValidationError,
handleApiError,
} from "@/lib/api-helpers";
import { validateLiveModeEnv, getApiMode } from "@/lib/env";
import { IntegrationClient, type VerificationResult } from "@guildpass/integration-client";
import { isValidChecksumAddress, normaliseAddress } from "@/lib/address";

export async function POST(request: Request): Promise<NextResponse> {
  return handleApiError(async () => {
    const mode = getApiMode();
    const body = await request.json();
    const { discordUserId, wallet } = body;

    if (!discordUserId || !wallet) {
      return apiValidationError("Missing verification fields", [
        ...(!discordUserId
          ? [{ field: "discordUserId", message: "discordUserId is required" }]
          : []),
        ...(!wallet ? [{ field: "wallet", message: "wallet is required" }] : []),
      ]);
    }

    if (!isValidChecksumAddress(wallet)) {
      return apiValidationError("Invalid wallet", [
        { field: "wallet", message: "wallet must be a checksummed Ethereum address" },
      ]);
    }
    const normalizedWallet = normaliseAddress(wallet);

    if (mode === "live") {
      // Allow injecting a test client via globalThis for unit tests
      const testClient = (globalThis as any).__TEST_INTEGRATION_CLIENT;
      let client;

      if (testClient) {
        client = testClient;
      } else {
        const liveEnv = validateLiveModeEnv();
        client = new IntegrationClient({
          baseUrl: liveEnv.GUILD_PASS_CORE_URL,
          apiKey: liveEnv.GUILD_PASS_CORE_API_KEY,
        });
      }

      const result: VerificationResult = await client.verifyWallet(
        discordUserId,
        normalizedWallet
      );

      return apiResponse(result);
    }

    // Mock verification result in mock mode
    const mock: VerificationResult = {
      userId: discordUserId,
      wallet,
      verified: true,
      message: "mock verification succeeded",
    };

    return apiResponse(mock);
  });
}