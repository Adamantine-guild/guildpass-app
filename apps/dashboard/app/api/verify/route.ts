import { NextResponse } from "next/server";
import {
apiResponse,
apiError,
apiValidationError,
handleApiError,
} from "@/lib/api-helpers";
import { validateLiveModeEnv, getApiMode } from "@/lib/env";
import { IntegrationClient, type VerificationResult } from "@guildpass/integration-client";
import { isValidChecksumAddress, normaliseAddress } from "@/lib/address";
import { getVerificationChallengeStore } from "@/lib/verification-challenge";
import { verifyMessage } from "viem";

type ProofRejectionReason =
  | "missing_nonce"
  | "challenge_invalid"
  | "signature_invalid";

function rejectProof(
  reason: ProofRejectionReason,
  discordUserId: string,
  wallet: string,
): NextResponse {
  // Never log the signature itself; it is bearer material until consumed.
  console.warn(
    JSON.stringify({ event: "verify_proof_rejected", reason, discordUserId, wallet }),
  );
  const messages: Record<ProofRejectionReason, string> = {
    missing_nonce:
      "Wallet verification requires signing a challenge. Request one from POST /api/verify/challenge and resubmit with { nonce, signature }.",
    challenge_invalid: "Challenge is unknown, expired, already used, or was issued for a different discordUserId/wallet pair",
    signature_invalid: "Signature does not recover to the claimed wallet for this challenge",
  };
  return apiError(messages[reason], 401);
}

export async function POST(request: Request): Promise<NextResponse> {
  return handleApiError(async () => {
    const mode = getApiMode();
    const body = await request.json();
    const { discordUserId, wallet, nonce, signature } = body;

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
      // Proof-of-control gate: the requester must sign a single-use challenge
      // scoped to this (discordUserId, wallet) pair, or anyone could claim a
      // stranger's public address.
      if (typeof nonce !== "string" || typeof signature !== "string") {
        return rejectProof("missing_nonce", discordUserId, wallet);
      }

      const message = getVerificationChallengeStore().consume(
        discordUserId,
        wallet,
        nonce,
      );
      if (!message) {
        return rejectProof("challenge_invalid", discordUserId, wallet);
      }

      let signatureValid: boolean;
      try {
        signatureValid = await verifyMessage({
          address: wallet as `0x${string}`,
          message,
          signature: signature as `0x${string}`,
        });
      } catch {
        signatureValid = false;
      }
      if (!signatureValid) {
        return rejectProof("signature_invalid", discordUserId, wallet);
      }

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
        normalizedWallet,
        { proof: { nonce, signature } },
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
